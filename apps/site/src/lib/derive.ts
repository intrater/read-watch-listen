// Auto-derive the two RWL navigation axes (medium + time-to-consume) and recover
// real bookmark dates, since Shiori's backfill stamped created_at = import time.

export type Medium = "read" | "watch" | "listen";
export type TimeBucket = "quick" | "medium" | "deep";

/** Twitter Snowflake epoch (ms). tweet_ms = (id >> 22) + epoch. */
const TWITTER_EPOCH = 1288834974657n;

/**
 * Recover the original post time (ms) by decoding the tweet id from an x.com /
 * twitter.com status URL. Returns null for non-tweet URLs. BigInt keeps the
 * 19-digit ids exact.
 */
export function tweetDateMs(url: string | null): number | null {
  if (!url) return null;
  const m = /(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d+)/.exec(url);
  if (!m) return null;
  try {
    return Number((BigInt(m[1]!) >> 22n) + TWITTER_EPOCH);
  } catch {
    return null;
  }
}

/** Best-effort medium from any URL/title/summary text. Defaults to read. */
export function deriveMedium(blob: string): Medium {
  const t = blob.toLowerCase();
  if (/youtube\.com|youtu\.be|vimeo\.com|loom\.com|\.mp4|\bwatch the\b|video:/.test(t)) return "watch";
  if (/podcast|spotify\.com\/episode|soundcloud\.com|overcast\.fm|\/podcast|\.mp3|listen to\b/.test(t))
    return "listen";
  return "read";
}

/** Reading time bucket from a word count (~200 wpm). Null words -> quick. */
export function deriveTime(words: number | null): TimeBucket {
  if (words == null || words <= 0) return "quick";
  const minutes = words / 200;
  if (minutes < 5) return "quick";
  if (minutes < 20) return "medium";
  return "deep";
}

export function wordCount(text: string | null): number | null {
  if (!text) return null;
  const n = text.trim().split(/\s+/).filter(Boolean).length;
  return n > 0 ? n : null;
}
