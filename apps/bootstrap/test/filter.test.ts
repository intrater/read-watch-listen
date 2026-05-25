import { describe, it, expect, vi } from "vitest";
import {
  createRelevanceJudge,
  judgeItems,
  passesThreshold,
  RELEVANCE_THRESHOLD,
  type Judgment,
  type RelevanceJudge,
  type ScoreCache,
} from "../src/filter.js";
import type { ParsedItem } from "../src/parse.js";

const item = (over: Partial<ParsedItem> = {}): ParsedItem => ({
  tweetId: "1",
  url: "https://example.com/a",
  isExternal: true,
  tweetText: "a tweet about agents",
  author: "alice",
  capturedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const jsonRes = (obj: unknown) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });

describe("createRelevanceJudge", () => {
  it("parses the structured judgment and trims the why note", async () => {
    const createMessage = vi.fn(async (_body: unknown) =>
      jsonRes({ relevant: true, confidence: 0.82, primary_topic: "agents", why_note: "  A sharp take.  " }),
    );
    const j = await createRelevanceJudge({ createMessage }).judge(item());
    expect(j).toEqual({ relevant: true, confidence: 0.82, primaryTopic: "agents", whyDraft: "A sharp take." });
  });

  it("clamps confidence to 0–1 and coerces a missing/invalid relevance to false", async () => {
    const createMessage = vi.fn(async () => jsonRes({ confidence: 1.7, primary_topic: "x", why_note: "" }));
    const j = await createRelevanceJudge({ createMessage }).judge(item());
    expect(j.relevant).toBe(false);
    expect(j.confidence).toBe(1);
  });

  it("wraps the untrusted tweet in a delimited block and requests structured output", async () => {
    const createMessage = vi.fn(async (_body: unknown) =>
      jsonRes({ relevant: false, confidence: 0, primary_topic: "", why_note: "" }),
    );
    await createRelevanceJudge({ createMessage }).judge(item({ tweetText: "INJECT_ME" }));
    const body = createMessage.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
      output_config: { format: { type: string } };
    };
    expect(body.messages[0]!.content).toContain("<bookmark>");
    expect(body.messages[0]!.content).toContain("INJECT_ME");
    expect(body.output_config.format.type).toBe("json_schema");
  });

  it("throws on non-JSON output", async () => {
    const createMessage = vi.fn(async () => ({ content: [{ type: "text", text: "nope" }] }));
    await expect(createRelevanceJudge({ createMessage }).judge(item())).rejects.toThrow();
  });
});

describe("passesThreshold", () => {
  const j = (over: Partial<Judgment>): Judgment => ({ relevant: true, confidence: 0.9, primaryTopic: "x", whyDraft: "", ...over });
  it("requires relevant AND confidence >= threshold", () => {
    expect(passesThreshold(j({ confidence: RELEVANCE_THRESHOLD }))).toBe(true);
    expect(passesThreshold(j({ confidence: 0.59 }))).toBe(false);
    expect(passesThreshold(j({ relevant: false, confidence: 0.99 }))).toBe(false);
  });
});

describe("judgeItems", () => {
  function memCache(): ScoreCache & { store: Map<string, Judgment> } {
    const store = new Map<string, Judgment>();
    return { store, get: (id) => store.get(id), set: (id, v) => void store.set(id, v) };
  }

  it("judges uncached items, caches results, and reuses the cache on re-run", async () => {
    const items = [item({ tweetId: "a" }), item({ tweetId: "b" })];
    const judge: RelevanceJudge = {
      judge: vi.fn(async (it) => ({ relevant: true, confidence: 0.7, primaryTopic: "t", whyDraft: `note ${it.tweetId}` })),
    };
    const cache = memCache();

    const first = await judgeItems(items, judge, cache);
    expect(first.size).toBe(2);
    expect(judge.judge).toHaveBeenCalledTimes(2);
    expect(cache.store.size).toBe(2);

    // Second run: everything cached → no further LLM calls (no double-billing).
    const second = await judgeItems(items, judge, cache);
    expect(judge.judge).toHaveBeenCalledTimes(2);
    expect(second.get("a")!.whyDraft).toBe("note a");
  });

  it("reports fromCache=false only for fresh judgments", async () => {
    const cache = memCache();
    cache.set("a", { relevant: true, confidence: 0.9, primaryTopic: "t", whyDraft: "cached" });
    const judge: RelevanceJudge = { judge: vi.fn(async () => ({ relevant: true, confidence: 0.8, primaryTopic: "t", whyDraft: "fresh" })) };
    const seen: Array<[string, boolean]> = [];
    await judgeItems([item({ tweetId: "a" }), item({ tweetId: "b" })], judge, cache, (it, _j, fromCache) =>
      seen.push([it.tweetId, fromCache]),
    );
    expect(seen).toEqual([["a", true], ["b", false]]);
  });
});
