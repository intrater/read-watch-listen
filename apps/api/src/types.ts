// Core RWL domain types. The Postgres schema in migrations/0001_initial.sql is
// the source of truth; these mirror it for the control-plane code.

/** Read / Watch / Listen — the consumption medium (auto-derived from URL type). */
export type RwlMedium = "read" | "watch" | "listen";

/** Time-to-consume bucket (auto-derived from word count / media duration). */
export type TimeBucket = "quick" | "medium" | "deep";

/** Lifecycle of the bookmark's sync to Shiori (the canonical bookmark store). */
export type ShioriStatus = "pending" | "synced" | "failed";

/** Lifecycle of the async LLM enrichment (the "why" note draft). */
export type LlmStatus = "pending" | "done" | "failed";

export type CaptureSource = "ios-shortcut" | "chrome-ext" | "bootstrap";

export type DigestKind = "daily" | "weekend";

export type DigestStatus =
  | "draft"
  | "pending"
  | "approved"
  | "skipped"
  | "shipped"
  | "shipped_partial";

/** Fan-out surfaces a published digest reaches. */
export type FanOutSurface = "slack_ch" | "email" | "site";

export type FanOutState = "queued" | "success" | "failed" | "skipped";

/**
 * A captured item. RWL owns the editorial fields (note, rwl_tag, consume_minutes);
 * bookmark facts (title beyond the cache, archive, thumbnail) live in Shiori and
 * are joined on shiori_id at build/compose time.
 */
export interface Capture {
  id: number;
  url: string;
  normalized_url: string;
  title: string | null;
  note: string | null;
  rwl_tag: RwlMedium;
  consume_minutes: number | null;
  source: CaptureSource;
  shiori_id: string | null;
  shiori_status: ShioriStatus;
  llm_status: LlmStatus;
  bootstrap: boolean;
  captured_at: string;
  created_at: string;
  updated_at: string;
}

export interface Digest {
  id: number;
  kind: DigestKind;
  status: DigestStatus;
  slug: string | null;
  body_md: string | null;
  body_json: unknown;
  composed_at: string;
  approved_at: string | null;
  auto_ship_at: string | null;
  slack_msg_ts: string | null;
  slack_channel_id: string | null;
}

export interface DigestItem {
  digest_id: number;
  capture_id: number;
  position: number;
  cluster_label: string | null;
}

export interface FanOutStatus {
  digest_id: number;
  surface: FanOutSurface;
  status: FanOutState;
  attempts: number;
  last_error: string | null;
  updated_at: string;
}

/** Time-bucket thresholds (minutes). Shared with apps/site's lib/filters. */
export const TIME_BUCKETS = {
  quick: { maxMinutes: 5 },
  medium: { maxMinutes: 20 },
  deep: { maxMinutes: Infinity },
} as const;

export function timeBucketFor(minutes: number | null): TimeBucket | null {
  if (minutes == null) return null;
  if (minutes < TIME_BUCKETS.quick.maxMinutes) return "quick";
  if (minutes < TIME_BUCKETS.medium.maxMinutes) return "medium";
  return "deep";
}
