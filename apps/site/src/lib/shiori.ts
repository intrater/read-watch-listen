// Build-time reader for the RWL corpus. Shiori is the canonical store; the site
// pulls only the bookmarks John has tagged `rwl` (the curation gate) and renders
// them statically. Reads are free (no Shiori credits) and rate-limited at 60/min;
// a full build is a handful of calls.
//
// NOTE: shiori.sh sits behind Cloudflare that 403s (error 1010) default
// programmatic User-Agents (Node's bare fetch, Python urllib). We send a
// browser-like User-Agent so the build isn't blocked. Verified working.

const BASE = process.env.SHIORI_API_BASE ?? "https://www.shiori.sh";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** A bookmark as returned by GET /api/links (the fields the site renders). */
export interface ShioriLink {
  id: string;
  url: string;
  title: string | null;
  summary: string | null;
  domain: string | null;
  image_url: string | null;
  author: string | null;
  content: string | null;
  created_at: string | null;
  /** Article's own publication date when Shiori resolved a linked article. */
  publication_date: string | null;
}

/**
 * Fetch every Shiori link carrying `tag`, newest-first, following pagination.
 * Throws on a non-2xx or a missing token so the build fails fast rather than
 * shipping an empty site.
 */
export async function fetchTaggedLinks(tag = "rwl"): Promise<ShioriLink[]> {
  const token = process.env.SHIORI_TOKEN;
  if (!token) {
    throw new Error(
      "SHIORI_TOKEN is not set — the site build reads the RWL corpus from Shiori. " +
        "Provide it as a build env var (locally: pull from apps/api/.env.local).",
    );
  }

  const limit = 1000;
  let offset = 0;
  const out: ShioriLink[] = [];

  for (;;) {
    const url =
      `${BASE}/api/links?tag=${encodeURIComponent(tag)}` +
      `&limit=${limit}&offset=${offset}&sort=newest&include_content=true`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, "user-agent": UA, accept: "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Shiori GET /api/links -> ${res.status} ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as { links?: ShioriLink[]; data?: ShioriLink[] };
    const rows = Array.isArray(data) ? data : (data.links ?? data.data ?? []);
    out.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return out;
}
