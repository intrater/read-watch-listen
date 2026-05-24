// Capture core logic: validate -> persist to Postgres (the durable truth) ->
// forward bookmark facts to Shiori with bounded retry. Kept separate from the
// HTTP route (api/capture.ts) so it is testable without an HTTP server and
// reusable by the U13 bootstrap importer.

import { query } from "./db.js";
import { normalizeUrl, validateFetchTarget, InvalidUrlError } from "./url.js";
import { createShioriClient, ShioriError, type ShioriClient } from "./shiori.js";
import type { CaptureSource, ShioriStatus } from "../types.js";

export const MAX_URL_LEN = 2048;
export const MAX_NOTE_LEN = 500;
const VALID_SOURCES: readonly CaptureSource[] = ["ios-shortcut", "chrome-ext", "bootstrap"];

export interface CaptureInput {
  url: string;
  note?: string | null;
  source: CaptureSource;
  /** Bootstrap-only: cached title and original saved date. */
  title?: string | null;
  capturedAt?: string;
  bootstrap?: boolean;
}

export type CaptureErrorCode =
  | "invalid_url"
  | "url_too_long"
  | "note_too_long"
  | "blocked_target"
  | "invalid_source";

export interface CaptureValidationError {
  code: CaptureErrorCode;
  message: string;
}

export interface CaptureResult {
  status: "created" | "updated";
  id: number;
  normalizedUrl: string;
  shioriId: string | null;
  shioriStatus: ShioriStatus;
}

export interface CaptureDeps {
  shiori?: ShioriClient;
  /** Total Shiori attempts before giving up and marking the row pending. */
  maxAttempts?: number;
  /** Backoff between Shiori attempts. Tests pass 0. */
  retryDelayMs?: number;
}

/**
 * Pure, synchronous semantic validation. Shared by the route and the bootstrap
 * importer so every entry point rejects the same inputs. Returns null when ok.
 */
export function validateCaptureInput(input: {
  url?: unknown;
  note?: unknown;
  source?: unknown;
}): CaptureValidationError | null {
  if (typeof input.url !== "string" || input.url.trim() === "") {
    return { code: "invalid_url", message: "url is required" };
  }
  if (input.url.length > MAX_URL_LEN) {
    return { code: "url_too_long", message: `url exceeds ${MAX_URL_LEN} chars` };
  }
  if (input.note != null) {
    if (typeof input.note !== "string") {
      return { code: "note_too_long", message: "note must be a string" };
    }
    if (input.note.length > MAX_NOTE_LEN) {
      return { code: "note_too_long", message: `note exceeds ${MAX_NOTE_LEN} chars` };
    }
  }
  if (typeof input.source !== "string" || !VALID_SOURCES.includes(input.source as CaptureSource)) {
    return { code: "invalid_source", message: `source must be one of ${VALID_SOURCES.join(", ")}` };
  }
  const target = validateFetchTarget(input.url);
  if (!target.ok) {
    return { code: "blocked_target", message: target.reason ?? "blocked URL" };
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Persist a capture and forward it to Shiori.
 *
 * Order matters: the Postgres row is written first (the capture is never lost),
 * then the bookmark fact is pushed to Shiori. If Shiori is unreachable the row
 * keeps shiori_status='pending' and the request still succeeds — a later
 * reconcile (cron, U5+) syncs it. Re-capturing the same normalized URL updates
 * the existing row (and overwrites the note only when a new one is supplied)
 * rather than creating a duplicate.
 *
 * Caller is expected to have run validateCaptureInput first; we defensively
 * re-validate the URL shape and throw on a malformed URL.
 */
export async function handleCapture(
  input: CaptureInput,
  deps: CaptureDeps = {},
): Promise<CaptureResult> {
  const shiori = deps.shiori ?? createShioriClient();
  const maxAttempts = deps.maxAttempts ?? 3;
  const retryDelayMs = deps.retryDelayMs ?? 200;

  // Throws InvalidUrlError on a malformed URL; the route validates first, so
  // this is a defensive guard for direct callers (e.g. the bootstrap importer).
  const normalized = normalizeUrl(input.url);

  const note = input.note?.trim() ? input.note.trim() : null;
  const title = input.title?.trim() ? input.title.trim() : null;

  // Upsert on the normalized_url unique key. xmax = 0 distinguishes a fresh
  // INSERT from an ON CONFLICT UPDATE. COALESCE keeps the prior note/title when
  // the new capture omits them, and overwrites when a new value is supplied.
  const upsert = await query<{
    id: number;
    inserted: boolean;
    shiori_id: string | null;
    shiori_status: ShioriStatus;
  }>(
    `INSERT INTO captures (url, normalized_url, title, note, source, bootstrap, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
     ON CONFLICT (normalized_url) DO UPDATE
       SET note       = COALESCE(EXCLUDED.note, captures.note),
           title      = COALESCE(EXCLUDED.title, captures.title),
           updated_at = now()
     RETURNING id, (xmax = 0) AS inserted, shiori_id, shiori_status`,
    [input.url, normalized, title, note, input.source, input.bootstrap ?? false, input.capturedAt ?? null],
  );

  const row = upsert.rows[0]!;
  const status: CaptureResult["status"] = row.inserted ? "created" : "updated";

  let shioriId = row.shiori_id;
  let shioriStatus = row.shiori_status;

  // Forward to Shiori only when not already synced (fresh row, or a prior
  // attempt left it pending). An already-synced re-capture is a note edit only —
  // never create a second Shiori bookmark.
  if (!shioriId) {
    const sync = await forwardToShiori(shiori, row.id, input, maxAttempts, retryDelayMs);
    shioriStatus = sync.status;
    shioriId = sync.linkId;
  }

  return { status, id: row.id, normalizedUrl: normalized, shioriId, shioriStatus };
}

async function forwardToShiori(
  shiori: ShioriClient,
  captureId: number,
  input: CaptureInput,
  maxAttempts: number,
  retryDelayMs: number,
): Promise<{ status: ShioriStatus; linkId: string | null }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await shiori.createLink({
        url: input.url,
        title: input.title ?? undefined,
        created_at: input.bootstrap ? input.capturedAt : undefined,
      });
      await query(
        "UPDATE captures SET shiori_id = $1, shiori_status = 'synced', updated_at = now() WHERE id = $2",
        [result.linkId, captureId],
      );
      return { status: "synced", linkId: result.linkId };
    } catch (e) {
      lastError = e;
      const retryable = e instanceof ShioriError ? e.retryable : true;
      if (!retryable || attempt === maxAttempts) break;
      if (retryDelayMs > 0) await sleep(retryDelayMs * attempt);
    }
  }
  // Durable: the capture survives; a later reconcile (cron, U5+) retries the
  // sync. The pending status is the signal; surface the cause in logs.
  console.warn(
    `capture ${captureId}: Shiori sync failed after ${maxAttempts} attempt(s), left pending:`,
    lastError instanceof Error ? lastError.message : lastError,
  );
  await query(
    "UPDATE captures SET shiori_status = 'pending', updated_at = now() WHERE id = $1",
    [captureId],
  );
  return { status: "pending", linkId: null };
}
