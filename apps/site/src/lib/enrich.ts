// Build-time og:image puller. Many bookmarks are tweets that link out to a real
// article; the tweet itself has no media, but the linked article has an og:image.
// We fetch those once and cache to disk so dev reloads and rebuilds stay fast.
// Best-effort: any failure (timeout, no tag, non-HTML) yields null and the card
// falls back to a typographic plate.

import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const CACHE_PATH = fileURLToPath(new URL("../../.cache/og-images.json", import.meta.url));
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CONCURRENCY = 8;
const TIMEOUT_MS = 7000;

type Cache = Record<string, string | null>;
let cache: Cache | null = null;

function loadCache(): Cache {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Cache;
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache(): void {
  if (!cache) return;
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cache));
  } catch {
    /* cache is an optimization; ignore write failures */
  }
}

function metaContent(html: string, prop: string): string | null {
  const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i").exec(html);
  if (!tag) return null;
  const c = /content=["']([^"']+)["']/i.exec(tag[0]);
  return c ? c[1]! : null;
}

async function fetchOgImage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    const html = (await res.text()).slice(0, 250_000);
    const found =
      metaContent(html, "og:image") ??
      metaContent(html, "twitter:image") ??
      metaContent(html, "twitter:image:src");
    if (!found) return null;
    return new URL(found, res.url || url).toString();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve og:images for a set of article URLs, cached and concurrency-limited. */
export async function resolveImages(urls: string[]): Promise<Map<string, string>> {
  const c = loadCache();
  const todo = [...new Set(urls)].filter((u) => !(u in c));

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < todo.length) {
      const u = todo[cursor++]!;
      c[u] = await fetchOgImage(u);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  if (todo.length) saveCache();

  const out = new Map<string, string>();
  for (const u of urls) {
    const v = c[u];
    if (v) out.set(u, v);
  }
  return out;
}

const URL_RE = /https?:\/\/[^\s)>"']+/g;

/** First outbound (non-tweet) link in the text, trimmed of trailing punctuation. */
export function outboundLink(...parts: (string | null)[]): string | null {
  const blob = parts.filter(Boolean).join(" ");
  for (const u of blob.match(URL_RE) ?? []) {
    if (!/(twitter\.com|x\.com)\/[^/]+\/status/.test(u)) return u.replace(/[.,)\]]+$/, "");
  }
  return null;
}
