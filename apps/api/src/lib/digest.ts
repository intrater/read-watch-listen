// Daily digest orchestrator (U5). The cron pacemaker: sync Shiori → pull new
// items from the Postgres spine → compose in John's voice → persist a draft +
// its item links. Stops at "draft persisted"; U6 adds the Slack approval DM and
// U7 the fan-out.

import { query, withTransaction } from "./db.js";
import { syncFromShiori } from "./shiori-sync.js";
import { loadVoice, type Voice } from "./voice.js";
import {
  createDigestComposer,
  type DigestComposer,
  type DigestComposeItem,
} from "./digest-llm.js";
import type { RwlMedium } from "../types.js";

export interface CaptureRow {
  id: number;
  url: string;
  title: string | null;
  note: string | null;
  rwl_tag: RwlMedium;
  consume_minutes: number | null;
}

export interface ComposeDeps {
  composer?: DigestComposer;
  voice?: Voice;
  /** Run the Shiori→Postgres sync first. Default true; tests pass false. */
  sync?: boolean;
  /** Override the item source (tests). Defaults to "new since last daily". */
  loadItems?: () => Promise<CaptureRow[]>;
  /** Override the digest slug (tests, for isolation). Defaults to today's date. */
  slug?: string;
}

export type ComposeOutcome =
  | { status: "composed"; digestId: number; slug: string; itemCount: number }
  | { status: "skipped"; reason: "no_items" }
  | { status: "exists"; digestId: number; slug: string }
  | { status: "failed"; reason: "compose_error" };

function dailySlug(date = new Date()): string {
  return `daily-${date.toISOString().slice(0, 10)}`; // daily-YYYY-MM-DD
}

/** Items entering the system since the last daily digest was composed. We key on
 *  created_at (when the row landed in Postgres), not captured_at — a backfilled
 *  Shiori-sync item has an old captured_at but should still count as new. */
async function newItemsSinceLastDaily(): Promise<CaptureRow[]> {
  const cursor = await query<{ since: string | null }>(
    "SELECT MAX(composed_at)::text AS since FROM digests WHERE kind = 'daily'",
  );
  const since = cursor.rows[0]?.since ?? "epoch";
  const res = await query<CaptureRow>(
    `SELECT id, url, title, note, rwl_tag, consume_minutes
       FROM captures
      WHERE created_at > $1::timestamptz
        AND bootstrap = false
        AND shiori_status = 'synced'
      ORDER BY rwl_tag, created_at`,
    [since],
  );
  return res.rows;
}

function toComposeItem(r: CaptureRow): DigestComposeItem {
  return {
    url: r.url,
    title: r.title,
    note: r.note,
    rwlTag: r.rwl_tag,
    consumeMinutes: r.consume_minutes,
  };
}

export async function composeDailyDigest(deps: ComposeDeps = {}): Promise<ComposeOutcome> {
  // Idempotent: one daily digest per slug (date). A same-day re-run returns the
  // existing one rather than composing a duplicate (cron retries are safe).
  const slug = deps.slug ?? dailySlug();
  const existing = await query<{ id: number }>("SELECT id FROM digests WHERE slug = $1", [slug]);
  if (existing.rows[0]) {
    return { status: "exists", digestId: existing.rows[0].id, slug };
  }

  if (deps.sync !== false) {
    try {
      await syncFromShiori();
    } catch (e) {
      // Sync is best-effort; compose from whatever is already in the spine.
      console.warn("Shiori sync failed; composing from existing items:", (e as Error).message);
    }
  }

  const rows = await (deps.loadItems ?? newItemsSinceLastDaily)();
  if (rows.length === 0) {
    return { status: "skipped", reason: "no_items" }; // AE2: no draft row, no fan-out
  }

  const composer = deps.composer ?? createDigestComposer();
  const voice = deps.voice ?? loadVoice();
  const items = rows.map(toComposeItem);

  // Cheap cluster pass for a connective theme (≥3 items); best-effort.
  const theme = items.length >= 3 ? await composer.clusterItems(items) : null;

  // Compose, with a single retry (the composer throws on LLM failure / empty body).
  let body: string;
  try {
    body = await composeWithRetry(composer, voice, items, theme);
  } catch (e) {
    console.error("digest composition failed after retry; no draft created:", (e as Error).message);
    return { status: "failed", reason: "compose_error" };
  }

  const digestId = await withTransaction(async (q) => {
    const inserted = await q<{ id: number }>(
      `INSERT INTO digests (kind, status, slug, body_md, composed_at)
       VALUES ('daily', 'draft', $1, $2, now())
       RETURNING id`,
      [slug, body],
    );
    const id = inserted.rows[0]!.id;
    for (let i = 0; i < rows.length; i++) {
      await q(
        "INSERT INTO digest_items (digest_id, capture_id, position) VALUES ($1, $2, $3)",
        [id, rows[i]!.id, i],
      );
    }
    return id;
  });

  return { status: "composed", digestId, slug, itemCount: rows.length };
}

async function composeWithRetry(
  composer: DigestComposer,
  voice: Voice,
  items: DigestComposeItem[],
  theme: string | null,
): Promise<string> {
  try {
    return await composer.composeDigest({ voice, items, theme });
  } catch {
    return composer.composeDigest({ voice, items, theme }); // one retry, then propagate
  }
}
