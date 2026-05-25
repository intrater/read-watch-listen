import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { handleCapture, validateCaptureInput, MAX_URL_LEN } from "../src/lib/capture.js";
import { enrichCapture } from "../src/lib/enrich.js";
import type { CaptureSource } from "../src/types.js";

// POST /api/capture — the single ingest endpoint shared by the iOS Shortcut,
// the Chrome extension, and the bootstrap importer. Persists the capture to
// Postgres first (durable), then forwards bookmark facts to Shiori.
//
// Auth: per-client bearer tokens (CAPTURE_TOKEN_IOS / CAPTURE_TOKEN_EXT) so
// either client can be revoked independently (rotation procedure in the U14
// runbook). Fails closed — if no token env var is set, every request is 401.

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Returns the matched client label, or null if the bearer token is absent/unknown. */
function authenticate(req: Request): CaptureSource | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const presented = match[1]!.trim();

  const candidates: Array<[string | undefined, CaptureSource]> = [
    [process.env.CAPTURE_TOKEN_IOS, "ios-shortcut"],
    [process.env.CAPTURE_TOKEN_EXT, "chrome-ext"],
  ];
  for (const [token, client] of candidates) {
    if (token && constantTimeEquals(presented, token)) return client;
  }
  return null;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

export async function POST(req: Request): Promise<Response> {
  const client = authenticate(req);
  if (!client) {
    return json(401, { error: "unauthorized" });
  }

  // Match the media-type token, not a substring — so a header like
  // `multipart/form-data; boundary=application/json` is correctly rejected.
  const mediaType = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    return json(400, { error: "content-type must be application/json" });
  }

  // Guard the body size before parsing (url<=2048 + note<=500 + envelope).
  const raw = await req.text();
  if (raw.length > MAX_URL_LEN + 4096) {
    return json(400, { error: "payload too large" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid JSON body" });
  }
  if (typeof payload !== "object" || payload === null) {
    return json(400, { error: "body must be a JSON object" });
  }

  const { url, note } = payload as Record<string, unknown>;
  // The authenticated bearer token is the source of truth for which client this
  // is — never the body's `source` field (which a holder of either token could
  // spoof). The body field, if sent, is ignored.

  const invalid = validateCaptureInput({ url, note, source: client });
  if (invalid) {
    return json(400, { error: invalid.message, code: invalid.code });
  }

  try {
    const result = await handleCapture({
      url: url as string,
      note: (note as string | undefined) ?? null,
      source: client,
    });

    // Best-effort async enrichment (LLM "why" note + R/W/L + consume-time).
    // Fired after the row is persisted; it never blocks or fails the capture
    // response. enrichCapture self-gates on llm_status='pending', so firing on
    // every capture (including dedupe updates) is safe. Skipped when no LLM key
    // is configured and under Vitest — the enrichment path is covered directly
    // by enrich.integration.test.ts.
    if (process.env.LLM_API_KEY && !process.env.VITEST) {
      waitUntil(enrichCapture(result.id));
    }

    return json(200, {
      status: result.status,
      id: result.id,
      shiori_status: result.shioriStatus,
    });
  } catch (err) {
    console.error("capture failed:", err);
    return json(500, { error: "capture failed" });
  }
}
