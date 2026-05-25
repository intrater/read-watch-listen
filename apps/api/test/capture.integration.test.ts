import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getPool, query, closePool } from "../src/lib/db.js";
import { runMigrations } from "../src/lib/migrate.js";
import { handleCapture } from "../src/lib/capture.js";
import { ShioriError, type ShioriClient } from "../src/lib/shiori.js";
import { POST } from "../api/capture.js";

// Runs only when a real database is configured (locally, after pulling the
// Neon connection string into .env.local). Self-skips in CI where it is unset.
const describeDb =
  process.env.DATABASE_URL || process.env.POSTGRES_URL ? describe : describe.skip;

// Unique marker so this run's rows are isolated and cleanable.
const TAG = `it-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const u = (path: string) => `https://example.com/${TAG}/${path}`;

function stubShiori(impl?: ShioriClient["createLink"]) {
  const createLink = vi.fn(
    impl ?? (async () => ({ linkId: `lnk_${Math.random().toString(36).slice(2)}`, duplicate: false })),
  );
  const listLinks = vi.fn(async () => []);
  return { client: { createLink, listLinks } as ShioriClient, createLink };
}

describeDb("capture integration (requires DATABASE_URL)", () => {
  beforeAll(async () => {
    await runMigrations(getPool());
  });
  afterAll(async () => {
    await query("DELETE FROM captures WHERE url LIKE $1", [`https://example.com/${TAG}/%`]);
    await closePool();
  });

  it("creates a fresh capture and syncs it to Shiori", async () => {
    const { client, createLink } = stubShiori(async () => ({ linkId: "lnk_fresh", duplicate: false }));
    const res = await handleCapture(
      { url: u("fresh"), note: "why this caught my eye", source: "ios-shortcut" },
      { shiori: client, retryDelayMs: 0 },
    );

    expect(res.status).toBe("created");
    expect(res.shioriStatus).toBe("synced");
    expect(res.shioriId).toBe("lnk_fresh");
    expect(createLink).toHaveBeenCalledTimes(1);

    const row = await query("SELECT * FROM captures WHERE id = $1", [res.id]);
    // Payload fidelity: the original url is stored byte-for-byte, unmutated.
    expect(row.rows[0]!.url).toBe(u("fresh"));
    expect(row.rows[0]!.note).toBe("why this caught my eye");
    expect(row.rows[0]!.source).toBe("ios-shortcut");
    expect(row.rows[0]!.shiori_status).toBe("synced");
  });

  it("dedupes on the normalized URL: re-capture updates the note, no second Shiori bookmark", async () => {
    const { client, createLink } = stubShiori();

    const first = await handleCapture(
      { url: u("dedupe?utm_source=newsletter"), note: "first note", source: "ios-shortcut" },
      { shiori: client, retryDelayMs: 0 },
    );
    // Same resource, tracking param + trailing slash differ — must collide.
    const second = await handleCapture(
      { url: u("dedupe/"), note: "second note", source: "chrome-ext" },
      { shiori: client, retryDelayMs: 0 },
    );

    expect(first.status).toBe("created");
    expect(second.status).toBe("updated");
    expect(second.id).toBe(first.id);
    expect(createLink).toHaveBeenCalledTimes(1); // already synced → not re-created

    const rows = await query("SELECT note FROM captures WHERE normalized_url = $1", [first.normalizedUrl]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.note).toBe("second note"); // new note overwrote
  });

  it("keeps the prior note when a re-capture omits one", async () => {
    const { client } = stubShiori();
    const first = await handleCapture(
      { url: u("keepnote"), note: "keep me", source: "ios-shortcut" },
      { shiori: client, retryDelayMs: 0 },
    );
    await handleCapture({ url: u("keepnote"), source: "ios-shortcut" }, { shiori: client, retryDelayMs: 0 });

    const row = await query("SELECT note FROM captures WHERE id = $1", [first.id]);
    expect(row.rows[0]!.note).toBe("keep me");
  });

  it("persists the capture even when Shiori fails, marking it pending", async () => {
    const { client, createLink } = stubShiori(async () => {
      throw new ShioriError("upstream down", 500);
    });
    const res = await handleCapture(
      { url: u("shiori-down"), note: "still saved", source: "ios-shortcut" },
      { shiori: client, retryDelayMs: 0, maxAttempts: 2 },
    );

    expect(res.status).toBe("created");
    expect(res.shioriStatus).toBe("pending");
    expect(res.shioriId).toBeNull();
    expect(createLink).toHaveBeenCalledTimes(2); // retried, then gave up

    const row = await query("SELECT shiori_status, note FROM captures WHERE id = $1", [res.id]);
    expect(row.rows[0]!.shiori_status).toBe("pending");
    expect(row.rows[0]!.note).toBe("still saved"); // capture survived the failure
  });

  it("retries a pending capture on the next call and syncs it", async () => {
    // First attempt fails → pending. Second capture of the same URL retries Shiori.
    const failing = stubShiori(async () => {
      throw new ShioriError("down", 503);
    });
    const first = await handleCapture(
      { url: u("retry"), note: "n", source: "ios-shortcut" },
      { shiori: failing.client, retryDelayMs: 0, maxAttempts: 1 },
    );
    expect(first.shioriStatus).toBe("pending");

    const recovering = stubShiori(async () => ({ linkId: "lnk_recovered", duplicate: false }));
    const second = await handleCapture(
      { url: u("retry"), source: "ios-shortcut" },
      { shiori: recovering.client, retryDelayMs: 0 },
    );
    expect(second.status).toBe("updated");
    expect(second.shioriStatus).toBe("synced");
    expect(second.shioriId).toBe("lnk_recovered");
    expect(recovering.createLink).toHaveBeenCalledTimes(1);
  });

  it("derives source from the authenticated token, ignoring a spoofed body source", async () => {
    // No SHIORI_TOKEN in the test env → the forward fails fast and the row
    // lands pending, but the capture is still persisted with the token's source.
    process.env.CAPTURE_TOKEN_IOS = "tok_ios_integration";
    try {
      const req = new Request("https://api.test/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer tok_ios_integration" },
        body: JSON.stringify({ url: u("route-source"), note: "via route", source: "chrome-ext" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);

      const row = await query("SELECT source FROM captures WHERE url = $1", [u("route-source")]);
      expect(row.rows[0]!.source).toBe("ios-shortcut"); // token wins, not the body's "chrome-ext"
    } finally {
      delete process.env.CAPTURE_TOKEN_IOS;
    }
  });
});
