// Small key/value state on top of the kv_state table — the home for the dropped
// Cloudflare KV's ephemeral state (pending drafts, idempotency markers, and the
// digest sync high-water mark). Values are JSONB; expires_at gives TTL semantics
// (reads treat an expired row as absent).

import { query } from "./db.js";

export async function getKvState<T = unknown>(key: string): Promise<T | null> {
  const res = await query<{ value: T }>(
    "SELECT value FROM kv_state WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())",
    [key],
  );
  return res.rows[0]?.value ?? null;
}

/** Upsert a value. `ttlMs` sets expires_at; omit for a non-expiring entry. */
export async function setKvState(key: string, value: unknown, ttlMs?: number): Promise<void> {
  const expiresAt = ttlMs != null ? new Date(Date.now() + ttlMs).toISOString() : null;
  await query(
    `INSERT INTO kv_state (key, value, expires_at)
     VALUES ($1, $2::jsonb, $3::timestamptz)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
    [key, JSON.stringify(value), expiresAt],
  );
}
