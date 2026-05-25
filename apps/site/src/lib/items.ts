// Maps raw Shiori links into the view model the templates render: pulls a real
// image (Shiori media, else the linked article's og:image), derives the medium +
// time axes, recovers the real bookmark date, and sorts newest-first.

import { fetchTaggedLinks } from "./shiori.js";
import { resolveImages, outboundLink } from "./enrich.js";
import {
  tweetDateMs,
  deriveMedium,
  deriveTime,
  wordCount,
  type Medium,
  type TimeBucket,
} from "./derive.js";

export interface Item {
  id: string;
  url: string;
  source: string;
  author: string | null;
  headline: string;
  image: string | null;
  medium: Medium;
  time: TimeBucket;
  dateMs: number;
  dateLabel: string;
}

function sourceLabel(domain: string | null): string {
  if (!domain) return "Link";
  if (/x\.com|twitter\.com/.test(domain)) return "X";
  return domain.replace(/^www\./, "");
}

function dateLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

export async function getItems(): Promise<Item[]> {
  const links = await fetchTaggedLinks();

  // For imageless items that link to an article, pull the article's og:image.
  const outbound = new Map<string, string>();
  for (const l of links) {
    if (l.image_url) continue;
    const link = outboundLink(l.content, l.summary, l.title);
    if (link) outbound.set(l.id, link);
  }
  const ogImages = await resolveImages([...outbound.values()]);

  const items: Item[] = links
    .filter((l) => l.url)
    .map((l) => {
      const dateMs =
        (l.publication_date ? Date.parse(l.publication_date) : 0) ||
        tweetDateMs(l.url) ||
        (l.created_at ? Date.parse(l.created_at) : Date.now());
      const out = outbound.get(l.id);
      const image = l.image_url || (out ? (ogImages.get(out) ?? null) : null);

      // When Shiori resolved a linked article (long content), its `title` is the
      // real headline. For pure tweets the clean AI `summary` reads best.
      const title = l.title?.trim() || null;
      const summary = l.summary?.trim() || null;
      const isArticle = (l.content?.length ?? 0) > 800;
      const headline = ((isArticle ? (title ?? summary) : (summary ?? title)) ?? l.url).replace(
        /\s+/g,
        " ",
      );
      const blob = [l.url, out, l.title, l.summary, l.domain].filter(Boolean).join(" ");
      return {
        id: l.id,
        url: l.url,
        source: sourceLabel(l.domain),
        author: l.author?.trim() || null,
        headline,
        image,
        medium: deriveMedium(blob),
        time: deriveTime(wordCount(l.content)),
        dateMs,
        dateLabel: dateLabel(dateMs),
      };
    });

  items.sort((a, b) => b.dateMs - a.dateMs);
  return items;
}
