// Parse a twitter-web-exporter JSON export into normalized items.
//
// The exporter mirrors X's API objects and the schema varies by export mode, so
// this is deliberately defensive: it reads the raw v1.1 tweet object, the
// GraphQL `legacy`-wrapped object, and the flattened export shape. For each
// bookmark we want the outbound link (the thing actually worth curating) or, if
// the tweet has none, the tweet permalink itself; plus the tweet text and its
// original date (which becomes the synthetic captured_at — per the plan,
// bootstrap items reflect when John actually saw them).

export interface ParsedItem {
  /** Stable id for caching/dedupe (the tweet id). */
  tweetId: string;
  /** Outbound expanded URL, or the tweet permalink when there is none. */
  url: string;
  /** True when `url` is an outbound link; false when it's the tweet itself. */
  isExternal: boolean;
  tweetText: string;
  author: string | null;
  /** ISO-8601 original tweet date → synthetic captured_at. */
  capturedAt: string;
}

type Json = Record<string, unknown>;

function asRecord(v: unknown): Json | null {
  return typeof v === "object" && v !== null ? (v as Json) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Find the array of tweet records regardless of envelope shape. */
function recordsOf(raw: unknown): Json[] {
  if (Array.isArray(raw)) return raw.filter((r): r is Json => asRecord(r) !== null);
  const obj = asRecord(raw);
  if (obj) {
    for (const key of ["tweets", "data", "bookmarks", "results"]) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as unknown[]).filter((r): r is Json => asRecord(r) !== null);
      }
    }
  }
  return [];
}

/** The fields we read live either on the record or in a nested `legacy` block. */
function legacyOf(rec: Json): Json {
  const legacy = asRecord(rec.legacy);
  return legacy ?? rec;
}

function tweetIdOf(rec: Json, legacy: Json): string | null {
  return (
    str(rec.id_str) ??
    str(legacy.id_str) ??
    str(rec.rest_id) ??
    (typeof rec.id === "number" || typeof rec.id === "string" ? String(rec.id) : null) ??
    (typeof legacy.id === "number" || typeof legacy.id === "string" ? String(legacy.id) : null)
  );
}

function textOf(legacy: Json, rec: Json): string {
  return str(legacy.full_text) ?? str(legacy.text) ?? str(rec.full_text) ?? str(rec.text) ?? "";
}

function authorOf(rec: Json, legacy: Json): string | null {
  // Flattened exports often hoist screen_name to the top level.
  const flat = str(rec.screen_name) ?? str(legacy.screen_name) ?? str(rec.username);
  if (flat) return flat;
  // Raw v1.1: user.screen_name. GraphQL: core.user_results.result.legacy.screen_name.
  const user = asRecord(rec.user);
  if (user) return str(user.screen_name);
  const core = asRecord(rec.core);
  const userResults = core && asRecord(core.user_results);
  const result = userResults && asRecord(userResults.result);
  const userLegacy = result && asRecord(result.legacy);
  return userLegacy ? str(userLegacy.screen_name) : null;
}

function dateOf(legacy: Json, rec: Json): string {
  const raw = str(legacy.created_at) ?? str(rec.created_at) ?? str(rec.bookmarked_at);
  if (raw) {
    const d = new Date(raw); // handles both "Wed Oct 10 20:19:24 +0000 2018" and ISO
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/** First non-twitter outbound URL from the tweet's url entities. */
function outboundUrlOf(legacy: Json, rec: Json): string | null {
  const sources = [asRecord(legacy.entities), asRecord(rec.entities), rec];
  for (const src of sources) {
    if (!src) continue;
    const urls = (src as Json).urls;
    if (!Array.isArray(urls)) continue;
    for (const u of urls) {
      const rec2 = asRecord(u);
      const expanded = rec2 && (str(rec2.expanded_url) ?? str(rec2.url));
      if (expanded && !/^https?:\/\/(t\.co|twitter\.com|x\.com|mobile\.twitter\.com)\b/i.test(expanded)) {
        return expanded;
      }
    }
  }
  return null;
}

function permalinkOf(author: string | null, tweetId: string): string {
  return `https://x.com/${author ?? "i"}/status/${tweetId}`;
}

/**
 * Normalize an export into items. Records without a resolvable id are dropped
 * (we need a stable cache key); everything else yields exactly one item, using
 * the outbound link when present and the tweet permalink otherwise.
 */
export function parseBookmarks(raw: unknown): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seen = new Set<string>();

  for (const rec of recordsOf(raw)) {
    const legacy = legacyOf(rec);
    const tweetId = tweetIdOf(rec, legacy);
    if (!tweetId || seen.has(tweetId)) continue;
    seen.add(tweetId);

    const author = authorOf(rec, legacy);
    const outbound = outboundUrlOf(legacy, rec);
    items.push({
      tweetId,
      url: outbound ?? permalinkOf(author, tweetId),
      isExternal: outbound !== null,
      tweetText: textOf(legacy, rec),
      author,
      capturedAt: dateOf(legacy, rec),
    });
  }

  return items;
}
