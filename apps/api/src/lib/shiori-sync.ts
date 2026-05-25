// Shiori → Postgres sync (U5, added 2026-05-24). iOS captures go straight to
// Shiori (Shiori's own Shortcut, not our /api/capture — see U3's path change), so
// before composing a digest the cron pulls Shiori-only bookmarks into the
// `captures` spine. Chrome-extension captures already exist as Postgres rows, so
// the upsert just links their shiori_id if it was missing; it never clobbers an
// existing editorial field (note / rwl_tag).

import { query } from "./db.js";
import { getKvState, setKvState } from "./kv.js";
import { normalizeUrl, InvalidUrlError } from "./url.js";
import { classifyByPattern } from "./classify.js";
import { createShioriClient, type ShioriClient } from "./shiori.js";

const LAST_SYNC_KEY = "shiori:last_sync_at";

export interface SyncDeps {
  shiori?: ShioriClient;
  /** Max links to pull per run. */
  limit?: number;
}

export interface SyncResult {
  fetched: number;
  /** New Shiori-only rows inserted into the spine. */
  inserted: number;
  /** Existing rows whose shiori_id was (re)linked. */
  linked: number;
}

export async function syncFromShiori(deps: SyncDeps = {}): Promise<SyncResult> {
  const shiori = deps.shiori ?? createShioriClient();
  const limit = deps.limit ?? 500;

  // Capture the watermark before the call so items created mid-sync aren't skipped.
  const startedAt = new Date().toISOString();
  const since = (await getKvState<string>(LAST_SYNC_KEY)) ?? undefined;

  const links = await shiori.listLinks({ since, limit });
  let inserted = 0;
  let linked = 0;

  for (const link of links) {
    let normalized: string;
    try {
      normalized = normalizeUrl(link.url);
    } catch (e) {
      if (e instanceof InvalidUrlError) continue; // skip unparseable URLs
      throw e;
    }
    // Deterministic medium for sync'd items; note/consume-time stay empty and
    // llm_status defaults to 'pending' so a later enrichment pass can fill them.
    const tag = classifyByPattern(link.url).tag;
    const res = await query<{ inserted: boolean }>(
      `INSERT INTO captures (url, normalized_url, title, rwl_tag, source, shiori_id, shiori_status, captured_at)
       VALUES ($1, $2, $3, $4, 'shiori-sync', $5, 'synced', COALESCE($6::timestamptz, now()))
       ON CONFLICT (normalized_url) DO UPDATE
         SET shiori_id     = COALESCE(captures.shiori_id, EXCLUDED.shiori_id),
             shiori_status = 'synced',
             updated_at    = now()
       RETURNING (xmax = 0) AS inserted`,
      [link.url, normalized, link.title, tag, link.id, link.createdAt],
    );
    if (res.rows[0]?.inserted) inserted += 1;
    else linked += 1;
  }

  await setKvState(LAST_SYNC_KEY, startedAt);
  return { fetched: links.length, inserted, linked };
}
