// Lightweight page-metadata fetch for capture enrichment (U4). Pulls the
// canonical title/description, og:type, a rough word count, and any declared
// media duration — enough for the LLM "why" draft, R/W/L classification, and the
// consume-time estimate. Best-effort: returns null when the page can't be safely
// or usefully fetched; the caller proceeds without metadata.
//
// SSRF: this is where the U2-deferred redirect revalidation lands. U2's capture
// guard only checked the literal submitted URL; here we actually fetch it, so we
// follow redirects manually and re-run validateFetchTarget on every hop (a 30x
// to 169.254.169.254 is the classic bypass). DNS-rebinding is still out of scope
// (we don't resolve hostnames) — acceptable for a daily-cadence, low-volume tool.

import { validateFetchTarget } from "./url.js";

export interface PageMetadata {
  finalUrl: string;
  title: string | null;
  description: string | null;
  ogType: string | null;
  wordCount: number | null;
  durationSeconds: number | null;
}

export interface FetchMetadataDeps {
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Max redirect hops to follow (each revalidated). Default 3. */
  maxRedirects?: number;
  /** Max HTML bytes to parse. Default 512 KiB. */
  maxBytes?: number;
  /** Per-request timeout. Default 5000 ms. */
  timeoutMs?: number;
}

const EMPTY = (finalUrl: string): PageMetadata => ({
  finalUrl,
  title: null,
  description: null,
  ogType: null,
  wordCount: null,
  durationSeconds: null,
});

export async function fetchPageMetadata(
  rawUrl: string,
  deps: FetchMetadataDeps = {},
): Promise<PageMetadata | null> {
  const doFetch = deps.fetchImpl ?? fetch;
  const maxRedirects = deps.maxRedirects ?? 3;
  const maxBytes = deps.maxBytes ?? 512 * 1024;
  const timeoutMs = deps.timeoutMs ?? 5000;

  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    // Revalidate the target on every hop — the redirect chain is attacker-influenced.
    if (!validateFetchTarget(current).ok) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "RWL-bot/1.0 (+https://rwl.johnintrater.com)",
          accept: "text/html,application/xhtml+xml,*/*",
        },
      });
    } catch {
      return null; // network error / timeout — best-effort
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc || hop >= maxRedirects) return null;
      try {
        current = new URL(loc, current).toString();
      } catch {
        return null;
      }
      continue;
    }

    if (!res.ok) return null;

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
      // Not parseable as HTML (PDF, image, JSON…). Report the resolved URL only;
      // classification still works from the URL/host.
      return EMPTY(current);
    }

    // Guard against huge bodies before reading. content-length is a hint (bytes);
    // we re-cap on the decoded string too.
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared && declared > maxBytes * 8) return EMPTY(current);

    let html: string;
    try {
      html = await res.text();
    } catch {
      return EMPTY(current);
    }
    if (html.length > maxBytes * 4) html = html.slice(0, maxBytes * 4);
    return parseHtml(current, html);
  }
}

// --- HTML parsing (regex-based; no DOM dependency) ---

function parseHtml(finalUrl: string, html: string): PageMetadata {
  const metas = parseMetaTags(html);
  const title = (metaVal(metas, "og:title") ?? titleTag(html))?.trim() || null;
  const description =
    (metaVal(metas, "og:description") ?? metaVal(metas, "description"))?.trim() || null;
  const ogType = metaVal(metas, "og:type")?.trim().toLowerCase() || null;
  return {
    finalUrl,
    title,
    description,
    ogType,
    wordCount: countWords(html),
    durationSeconds: parseDuration(metas),
  };
}

/** Map of meta `property`/`name` (lowercased) → first `content` seen. */
function parseMetaTags(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const key = attr(tag, "property") ?? attr(tag, "name");
    const content = attr(tag, "content");
    if (key && content != null) {
      const k = key.toLowerCase();
      if (!map.has(k)) map.set(k, content);
    }
  }
  return map;
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
}

function metaVal(metas: Map<string, string>, key: string): string | null {
  return metas.get(key.toLowerCase()) ?? null;
}

function titleTag(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]!) : null;
}

// og:video:duration / video:duration / music:duration / og:audio:duration —
// declared in whole seconds by most providers.
const DURATION_KEYS = [
  "og:video:duration",
  "video:duration",
  "music:duration",
  "og:audio:duration",
];

function parseDuration(metas: Map<string, string>): number | null {
  for (const key of DURATION_KEYS) {
    const v = metas.get(key);
    if (v) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function countWords(html: string): number | null {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const words = decodeEntities(text).split(/\s+/).filter(Boolean);
  return words.length > 0 ? words.length : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
