// Import approved bookmarks into Shiori + Postgres. Per the U2 implementation
// note, the bootstrap importer calls handleCapture DIRECTLY rather than POSTing
// to /api/capture — the HTTP route derives `source` from the bearer token and
// ignores body fields, so it can't set `bootstrap: true`, `title`, or the
// synthetic `captured_at`. handleCapture takes all three.
//
// bootstrap=true keeps these items off the first daily digest (U5 filters them)
// while still showing them on the public site; captured_at is the original tweet
// date so the archive reflects when John actually saw them.

import { handleCapture } from "@rwl/api/src/lib/capture.js";
import type { CaptureInput, CaptureResult } from "@rwl/api/src/lib/capture.js";
import type { ParsedItem } from "./parse.js";

export type CaptureFn = (input: CaptureInput) => Promise<CaptureResult>;

export interface ApprovedItem {
  item: ParsedItem;
  note: string;
}

export interface IngestResult {
  succeeded: string[]; // tweetIds
  failed: Array<{ tweetId: string; error: string }>;
}

export interface IngestDeps {
  /** Injectable for tests. Defaults to the real handleCapture. */
  capture?: CaptureFn;
  /** Called after each successful import — used to mark the item ingested
   *  on disk so a re-run retries only the failures. */
  onSuccess?: (tweetId: string, result: CaptureResult) => void;
}

export async function ingestApproved(
  approved: ApprovedItem[],
  deps: IngestDeps = {},
): Promise<IngestResult> {
  const capture: CaptureFn = deps.capture ?? ((input) => handleCapture(input));
  const succeeded: string[] = [];
  const failed: Array<{ tweetId: string; error: string }> = [];

  for (const { item, note } of approved) {
    try {
      const result = await capture({
        url: item.url,
        note: note.trim() || null,
        source: "bootstrap",
        bootstrap: true,
        // For a tweet-as-source there's no page for Shiori to title-extract, so
        // seed the tweet text; for an outbound link, let Shiori extract.
        title: item.isExternal ? null : item.tweetText.slice(0, 200) || null,
        capturedAt: item.capturedAt,
      });
      succeeded.push(item.tweetId);
      deps.onSuccess?.(item.tweetId, result);
    } catch (e) {
      failed.push({ tweetId: item.tweetId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { succeeded, failed };
}
