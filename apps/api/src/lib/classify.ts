// Deterministic, pattern-first R/W/L classification + consume-time estimate (U4).
//
// The medium is auto-derived (per the navigation-model decision: medium + time,
// no topic taxonomy, no LLM where a rule suffices). Known video/audio hosts and
// the og:type hint resolve confidently here; everything else defaults to "read"
// and is flagged not-confident so the enrichment step can ask the LLM to resolve
// the ambiguous tail (lib/enrich.ts).

import type { RwlMedium } from "../types.js";

// Host suffixes that confidently imply a medium. Matched against the registrable
// host (any subdomain of these counts, e.g. m.youtube.com, music.youtube.com).
const WATCH_HOSTS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "twitch.tv",
  "tiktok.com",
  "loom.com",
];
const LISTEN_HOSTS = [
  "open.spotify.com",
  "podcasts.apple.com",
  "pca.st", // Pocket Casts
  "overcast.fm",
  "soundcloud.com",
  "anchor.fm",
  "pocketcasts.com",
];

function hostMatches(host: string, suffixes: string[]): boolean {
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`));
}

export interface PatternResult {
  tag: RwlMedium;
  /** True when a host or og:type rule resolved it; false for the "read" default. */
  confident: boolean;
}

/**
 * Classify by URL host, with an optional og:type hint as a secondary signal.
 * Returns the "read" default with confident=false when no rule fires, so the
 * caller can escalate to the LLM classifier.
 */
export function classifyByPattern(rawUrl: string, ogType?: string | null): PatternResult {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { tag: "read", confident: false };
  }

  if (hostMatches(host, WATCH_HOSTS)) return { tag: "watch", confident: true };
  if (hostMatches(host, LISTEN_HOSTS)) return { tag: "listen", confident: true };

  const t = ogType?.toLowerCase() ?? "";
  if (t.startsWith("video")) return { tag: "watch", confident: true };
  if (t.startsWith("music") || t.startsWith("audio")) return { tag: "listen", confident: true };

  return { tag: "read", confident: false };
}

const WORDS_PER_MINUTE = 225;

/**
 * Estimate minutes-to-consume. Reads use word count (~225 wpm); watch/listen
 * use media duration. Returns null when the needed signal is absent — the time
 * badge is simply omitted, not a failure.
 */
export function estimateConsumeMinutes(input: {
  tag: RwlMedium;
  wordCount?: number | null;
  durationSeconds?: number | null;
}): number | null {
  if (input.tag === "read") {
    if (input.wordCount && input.wordCount > 0) {
      return Math.max(1, Math.round(input.wordCount / WORDS_PER_MINUTE));
    }
    return null;
  }
  // watch | listen
  if (input.durationSeconds && input.durationSeconds > 0) {
    return Math.max(1, Math.round(input.durationSeconds / 60));
  }
  return null;
}
