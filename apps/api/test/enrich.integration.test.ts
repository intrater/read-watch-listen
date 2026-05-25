import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getPool, query, closePool } from "../src/lib/db.js";
import { runMigrations } from "../src/lib/migrate.js";
import { enrichCapture } from "../src/lib/enrich.js";
import type { LlmClient } from "../src/lib/llm.js";
import type { PageMetadata } from "../src/lib/metadata.js";

// Runs only when a real database is configured (locally, after pulling the Neon
// connection string into .env.local). Self-skips in CI where it is unset.
const describeDb =
  process.env.DATABASE_URL || process.env.POSTGRES_URL ? describe : describe.skip;

const TAG = `enrich-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function insertCapture(url: string, note: string | null = null): Promise<number> {
  const r = await query<{ id: number }>(
    `INSERT INTO captures (url, normalized_url, note, source) VALUES ($1, $1, $2, 'ios-shortcut') RETURNING id`,
    [url, note],
  );
  return r.rows[0]!.id;
}

async function readRow(id: number) {
  const r = await query<{
    note: string | null;
    rwl_tag: string;
    consume_minutes: number | null;
    llm_status: string;
  }>("SELECT note, rwl_tag, consume_minutes, llm_status FROM captures WHERE id = $1", [id]);
  return r.rows[0]!;
}

function fakeLlm(over: Partial<LlmClient> = {}): LlmClient {
  return {
    draftWhyNote: vi.fn(async () => "A sharp, specific note."),
    classifyMedium: vi.fn(async () => "read" as const),
    ...over,
  };
}

const meta = (over: Partial<PageMetadata> = {}): PageMetadata => ({
  finalUrl: "https://example.com/resolved",
  title: "T",
  description: "D",
  ogType: null,
  wordCount: null,
  durationSeconds: null,
  ...over,
});
const noMeta = async () => null;

describeDb("enrichCapture integration (requires DATABASE_URL)", () => {
  beforeAll(async () => {
    await runMigrations(getPool());
  });
  afterAll(async () => {
    await query("DELETE FROM captures WHERE url LIKE $1", [`%${TAG}%`]);
    await closePool();
  });

  it("drafts a note, classifies, estimates consume-time, and marks done", async () => {
    const id = await insertCapture(`https://example.com/${TAG}/a`);
    await enrichCapture(id, {
      llm: fakeLlm(),
      fetchMetadata: async () => meta({ wordCount: 2250 }), // 2250/225 = 10 min
    });

    const row = await readRow(id);
    expect(row.note).toBe("A sharp, specific note.");
    expect(row.rwl_tag).toBe("read");
    expect(row.consume_minutes).toBe(10);
    expect(row.llm_status).toBe("done");
  });

  it("never overwrites a user-supplied note (and skips the draft call)", async () => {
    const id = await insertCapture(`https://example.com/${TAG}/b`, "user wrote this");
    const draftWhyNote = vi.fn(async () => "AI DRAFT");
    await enrichCapture(id, { llm: fakeLlm({ draftWhyNote }), fetchMetadata: noMeta });

    const row = await readRow(id);
    expect(row.note).toBe("user wrote this");
    expect(draftWhyNote).not.toHaveBeenCalled();
  });

  it("resolves an ambiguous medium via the LLM", async () => {
    const id = await insertCapture(`https://example.com/${TAG}/c`);
    const classifyMedium = vi.fn(async () => "watch" as const);
    await enrichCapture(id, { llm: fakeLlm({ classifyMedium }), fetchMetadata: noMeta });

    expect((await readRow(id)).rwl_tag).toBe("watch");
    expect(classifyMedium).toHaveBeenCalledTimes(1);
  });

  it("does not call the LLM classifier for a pattern-confident URL", async () => {
    const id = await insertCapture(`https://www.youtube.com/watch?v=${TAG}`);
    const classifyMedium = vi.fn(async () => "read" as const);
    await enrichCapture(id, { llm: fakeLlm({ classifyMedium }), fetchMetadata: noMeta });

    expect((await readRow(id)).rwl_tag).toBe("watch");
    expect(classifyMedium).not.toHaveBeenCalled();
  });

  it("marks llm_status=failed on LLM error, still writing deterministic fields", async () => {
    const id = await insertCapture(`https://example.com/${TAG}/e`);
    const llm = fakeLlm({
      classifyMedium: vi.fn(async () => {
        throw new Error("503");
      }),
      draftWhyNote: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    await enrichCapture(id, { llm, fetchMetadata: async () => meta({ wordCount: 450 }) });

    const row = await readRow(id);
    expect(row.llm_status).toBe("failed");
    expect(row.rwl_tag).toBe("read"); // deterministic default survives
    expect(row.consume_minutes).toBe(2); // 450/225 = 2
    expect(row.note).toBeNull();
  });

  it("is idempotent — skips a row that is no longer pending", async () => {
    const id = await insertCapture(`https://example.com/${TAG}/f`);
    await query("UPDATE captures SET llm_status = 'done' WHERE id = $1", [id]);
    const draftWhyNote = vi.fn(async () => "X");
    await enrichCapture(id, { llm: fakeLlm({ draftWhyNote }), fetchMetadata: noMeta });

    expect(draftWhyNote).not.toHaveBeenCalled();
    expect((await readRow(id)).note).toBeNull();
  });
});
