import { describe, it, expect, vi } from "vitest";
import { ingestApproved, type ApprovedItem, type CaptureFn } from "../src/ingest.js";
import type { ParsedItem } from "../src/parse.js";

const item = (over: Partial<ParsedItem> = {}): ParsedItem => ({
  tweetId: "1",
  url: "https://example.com/a",
  isExternal: true,
  tweetText: "tweet text",
  author: "alice",
  capturedAt: "2020-05-01T00:00:00.000Z",
  ...over,
});

const ok: CaptureFn = async () => ({
  status: "created",
  id: 1,
  normalizedUrl: "https://example.com/a",
  shioriId: "lnk_1",
  shioriStatus: "synced",
});

describe("ingestApproved", () => {
  it("captures with bootstrap=true, source=bootstrap, and the original date as captured_at", async () => {
    const capture = vi.fn(ok);
    const approved: ApprovedItem[] = [{ item: item(), note: "why this" }];
    const res = await ingestApproved(approved, { capture });

    expect(res.succeeded).toEqual(["1"]);
    expect(res.failed).toHaveLength(0);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/a",
        note: "why this",
        source: "bootstrap",
        bootstrap: true,
        capturedAt: "2020-05-01T00:00:00.000Z",
      }),
    );
  });

  it("seeds the title from tweet text for a tweet-as-source, but leaves it null for an outbound link", async () => {
    const capture = vi.fn(ok);
    await ingestApproved(
      [
        { item: item({ tweetId: "ext", isExternal: true }), note: "n" },
        { item: item({ tweetId: "tw", isExternal: false, tweetText: "the whole thought" }), note: "n" },
      ],
      { capture },
    );
    expect(capture.mock.calls[0]![0].title).toBeNull();
    expect(capture.mock.calls[1]![0].title).toBe("the whole thought");
  });

  it("isolates failures: other items still import, failures are reported for retry", async () => {
    const capture = vi.fn<CaptureFn>(async (input) => {
      if (input.url.includes("boom")) throw new Error("shiori 500");
      return ok(input);
    });
    const res = await ingestApproved(
      [
        { item: item({ tweetId: "good", url: "https://example.com/good" }), note: "n" },
        { item: item({ tweetId: "bad", url: "https://example.com/boom" }), note: "n" },
      ],
      { capture },
    );
    expect(res.succeeded).toEqual(["good"]);
    expect(res.failed).toEqual([{ tweetId: "bad", error: "shiori 500" }]);
  });

  it("fires onSuccess per imported item (used to mark it ingested for resume)", async () => {
    const onSuccess = vi.fn();
    await ingestApproved([{ item: item({ tweetId: "x" }), note: "n" }], { capture: ok, onSuccess });
    expect(onSuccess).toHaveBeenCalledWith("x", expect.objectContaining({ status: "created" }));
  });

  it("collapses a whitespace-only note to null", async () => {
    const capture = vi.fn(ok);
    await ingestApproved([{ item: item(), note: "   " }], { capture });
    expect(capture.mock.calls[0]![0].note).toBeNull();
  });
});
