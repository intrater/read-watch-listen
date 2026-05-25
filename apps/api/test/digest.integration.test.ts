import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getPool, query, closePool } from "../src/lib/db.js";
import { runMigrations } from "../src/lib/migrate.js";
import { composeDailyDigest, type CaptureRow } from "../src/lib/digest.js";
import type { DigestComposer } from "../src/lib/digest-llm.js";
import type { Voice } from "../src/lib/voice.js";

const describeDb =
  process.env.DATABASE_URL || process.env.POSTGRES_URL ? describe : describe.skip;

const TAG = `digest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const voice: Voice = { card: "card", samples: ["s1"] };
const SIG = "Curated by John Intrater · Assembled by Claude";

function stubComposer(body = `## Read\n- item\n\n${SIG}`): DigestComposer & { compose: ReturnType<typeof vi.fn> } {
  const compose = vi.fn(async () => body);
  return { clusterItems: async () => null, composeDigest: compose, compose };
}

async function insertCapture(
  suffix: string,
  opts: { bootstrap?: boolean; shioriStatus?: string } = {},
): Promise<number> {
  const url = `https://example.com/${TAG}/${suffix}`;
  const r = await query<{ id: number }>(
    `INSERT INTO captures (url, normalized_url, title, note, rwl_tag, source, shiori_status, bootstrap)
     VALUES ($1, $1, 'T', 'why', 'read', 'chrome-ext', $2, $3) RETURNING id`,
    [url, opts.shioriStatus ?? "synced", opts.bootstrap ?? false],
  );
  return r.rows[0]!.id;
}

const rowFor = (id: number): CaptureRow => ({
  id,
  url: `https://example.com/${TAG}/${id}`,
  title: "T",
  note: "why",
  rwl_tag: "read",
  consume_minutes: 5,
});

describeDb("composeDailyDigest integration (requires DATABASE_URL)", () => {
  beforeAll(async () => {
    await runMigrations(getPool());
  });
  afterAll(async () => {
    await query("DELETE FROM digests WHERE slug LIKE $1", [`${TAG}%`]);
    await query("DELETE FROM captures WHERE url LIKE $1", [`%${TAG}%`]);
    await closePool();
  });

  it("composes a draft, persists body_md + ordered digest_items, and reports the count", async () => {
    const id1 = await insertCapture("a");
    const id2 = await insertCapture("b");
    const composer = stubComposer();

    const outcome = await composeDailyDigest({
      slug: `${TAG}-compose`,
      sync: false,
      voice,
      composer,
      loadItems: async () => [rowFor(id1), rowFor(id2)],
    });

    expect(outcome.status).toBe("composed");
    if (outcome.status !== "composed") throw new Error("unreachable");
    expect(outcome.itemCount).toBe(2);

    const row = await query<{ status: string; body_md: string; kind: string }>(
      "SELECT status, body_md, kind FROM digests WHERE id = $1",
      [outcome.digestId],
    );
    expect(row.rows[0]).toMatchObject({ status: "draft", kind: "daily" });
    expect(row.rows[0]!.body_md).toContain(SIG);

    const items = await query<{ capture_id: number; position: number }>(
      "SELECT capture_id, position FROM digest_items WHERE digest_id = $1 ORDER BY position",
      [outcome.digestId],
    );
    expect(items.rows.map((r) => r.capture_id)).toEqual([id1, id2]);
  });

  it("creates NO draft row when there are no new items (AE2)", async () => {
    const slug = `${TAG}-empty`;
    const composer = stubComposer();
    const outcome = await composeDailyDigest({ slug, sync: false, voice, composer, loadItems: async () => [] });

    expect(outcome.status).toBe("skipped");
    expect(composer.compose).not.toHaveBeenCalled();
    const row = await query("SELECT id FROM digests WHERE slug = $1", [slug]);
    expect(row.rowCount).toBe(0);
  });

  it("is idempotent — a same-slug re-run returns the existing digest without recomposing", async () => {
    const slug = `${TAG}-idem`;
    const id = await insertCapture("idem");
    const first = await composeDailyDigest({ slug, sync: false, voice, composer: stubComposer(), loadItems: async () => [rowFor(id)] });
    expect(first.status).toBe("composed");

    const again = stubComposer();
    const second = await composeDailyDigest({ slug, sync: false, voice, composer: again, loadItems: async () => [rowFor(id)] });
    expect(second.status).toBe("exists");
    expect(again.compose).not.toHaveBeenCalled();
  });

  it("the real item query excludes bootstrap and non-synced rows", async () => {
    const synced = await insertCapture("real-synced");
    const boot = await insertCapture("real-boot", { bootstrap: true });
    const pending = await insertCapture("real-pending", { shioriStatus: "pending" });

    // No loadItems override → exercises newItemsSinceLastDaily against the DB.
    const outcome = await composeDailyDigest({ slug: `${TAG}-real`, sync: false, voice, composer: stubComposer() });
    expect(outcome.status).toBe("composed");
    if (outcome.status !== "composed") throw new Error("unreachable");

    const items = await query<{ capture_id: number }>(
      "SELECT capture_id FROM digest_items WHERE digest_id = $1",
      [outcome.digestId],
    );
    const ids = items.rows.map((r) => r.capture_id);
    expect(ids).toContain(synced); // included
    expect(ids).not.toContain(boot); // bootstrap excluded
    expect(ids).not.toContain(pending); // non-synced excluded
  });
});
