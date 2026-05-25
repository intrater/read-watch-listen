// Capture enrichment orchestrator (U4). Runs after handleCapture persists the
// row (async, via the route's waitUntil). Per the store model, everything it
// writes stays in Postgres (the editorial overlay) — nothing is pushed back to
// Shiori; the site and digest read these fields from D1.
//
// Pipeline:
//   1. Fetch page metadata (best-effort).
//   2. Classify R/W/L — deterministic pattern first; LLM only for the ambiguous
//      tail.
//   3. Draft the "why" note — only if the user supplied none (user note always
//      wins).
//   4. Compute the consume-time estimate (deterministic, no LLM).
//   5. Persist. The whole thing is best-effort: it never throws, and on LLM
//      failure it marks llm_status='failed' for a later retry while still
//      writing the deterministic fields it did derive.

import { query } from "./db.js";
import { fetchPageMetadata } from "./metadata.js";
import { classifyByPattern, estimateConsumeMinutes } from "./classify.js";
import { createLlmClient, type LlmClient } from "./llm.js";
import type { LlmStatus, RwlMedium } from "../types.js";

export interface EnrichDeps {
  /** Injectable LLM client (tests). Defaults to createLlmClient(). */
  llm?: LlmClient;
  /** Injectable metadata fetcher (tests). Defaults to fetchPageMetadata. */
  fetchMetadata?: typeof fetchPageMetadata;
}

export async function enrichCapture(captureId: number, deps: EnrichDeps = {}): Promise<void> {
  try {
    const sel = await query<{ url: string; note: string | null; llm_status: LlmStatus }>(
      "SELECT url, note, llm_status FROM captures WHERE id = $1",
      [captureId],
    );
    const row = sel.rows[0];
    if (!row) return;
    // Idempotent: only enrich a pending row. A re-capture of an already-enriched
    // (or terminally-failed) URL is a no-op, so the async fire on every capture
    // is safe and cheap.
    if (row.llm_status !== "pending") return;

    const fetchMeta = deps.fetchMetadata ?? fetchPageMetadata;
    const meta = await fetchMeta(row.url).catch(() => null);

    // Lazily build the LLM client; if it can't be constructed (no key) treat the
    // LLM as unavailable rather than crashing the job.
    let llmClient: LlmClient | null = deps.llm ?? null;
    const getLlm = (): LlmClient | null => {
      if (llmClient) return llmClient;
      try {
        llmClient = createLlmClient();
        return llmClient;
      } catch {
        return null;
      }
    };

    // 1. Classify — deterministic first, LLM only for the ambiguous tail.
    const pattern = classifyByPattern(row.url, meta?.ogType ?? undefined);
    let tag: RwlMedium = pattern.tag;
    let llmFailed = false;
    if (!pattern.confident) {
      const client = getLlm();
      if (client) {
        try {
          tag = await client.classifyMedium({
            url: row.url,
            title: meta?.title,
            description: meta?.description,
          });
        } catch {
          llmFailed = true; // keep the deterministic "read" default
        }
      } else {
        llmFailed = true;
      }
    }

    // 2. Draft the note only when the user supplied none.
    let draftedNote: string | null = null;
    if (!row.note) {
      const client = getLlm();
      if (client) {
        try {
          const note = await client.draftWhyNote({
            url: row.url,
            title: meta?.title,
            description: meta?.description,
          });
          draftedNote = note.trim() || null;
        } catch {
          llmFailed = true;
        }
      } else {
        llmFailed = true;
      }
    }

    // 3. Consume-time (deterministic).
    const consumeMinutes = estimateConsumeMinutes({
      tag,
      wordCount: meta?.wordCount ?? null,
      durationSeconds: meta?.durationSeconds ?? null,
    });

    // If no LLM work was needed at all (pattern-confident + user note present),
    // there's nothing to fail and nothing to retry → done.
    const status: LlmStatus = llmFailed ? "failed" : "done";

    // 4. Persist. COALESCE(note, $draft) guarantees a user note is never
    // overwritten, even if it landed between our SELECT and this UPDATE.
    await query(
      `UPDATE captures
         SET rwl_tag         = $2,
             consume_minutes = COALESCE($3, consume_minutes),
             note            = COALESCE(note, $4),
             llm_status      = $5,
             updated_at      = now()
       WHERE id = $1`,
      [captureId, tag, consumeMinutes, draftedNote, status],
    );
  } catch (err) {
    // Best-effort: never throw out of the background job. Mark failed so a later
    // pass can retry; swallow secondary failures.
    console.warn(
      `enrichCapture(${captureId}) failed:`,
      err instanceof Error ? err.message : err,
    );
    try {
      await query(
        "UPDATE captures SET llm_status = 'failed', updated_at = now() WHERE id = $1 AND llm_status = 'pending'",
        [captureId],
      );
    } catch {
      /* swallow — nothing more we can do */
    }
  }
}
