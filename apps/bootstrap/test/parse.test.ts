import { describe, it, expect } from "vitest";
import { parseBookmarks } from "../src/parse.js";

describe("parseBookmarks", () => {
  it("parses the raw v1.1 tweet shape and extracts the outbound URL", () => {
    const raw = [
      {
        id_str: "1001",
        full_text: "Great piece on agents https://t.co/abc",
        created_at: "Wed Oct 10 20:19:24 +0000 2018",
        user: { screen_name: "alice" },
        entities: {
          urls: [{ url: "https://t.co/abc", expanded_url: "https://example.com/agents" }],
        },
      },
    ];
    const [item] = parseBookmarks(raw);
    expect(item).toMatchObject({
      tweetId: "1001",
      url: "https://example.com/agents",
      isExternal: true,
      author: "alice",
    });
    expect(item!.capturedAt).toBe("2018-10-10T20:19:24.000Z");
  });

  it("parses the GraphQL legacy-wrapped shape", () => {
    const raw = {
      tweets: [
        {
          rest_id: "2002",
          legacy: {
            full_text: "AI policy thread",
            created_at: "Tue Mar 01 12:00:00 +0000 2022",
            entities: { urls: [{ expanded_url: "https://policy.example/ai" }] },
          },
          core: { user_results: { result: { legacy: { screen_name: "bob" } } } },
        },
      ],
    };
    const [item] = parseBookmarks(raw);
    expect(item).toMatchObject({ tweetId: "2002", url: "https://policy.example/ai", author: "bob" });
  });

  it("falls back to the tweet permalink when there is no outbound link", () => {
    const raw = [{ id_str: "3003", full_text: "a thought", screen_name: "carol", created_at: "2024-01-01T00:00:00Z" }];
    const [item] = parseBookmarks(raw);
    expect(item).toMatchObject({
      tweetId: "3003",
      url: "https://x.com/carol/status/3003",
      isExternal: false,
    });
  });

  it("ignores self-referential t.co/twitter URLs as outbound", () => {
    const raw = [
      {
        id_str: "4004",
        full_text: "quote tweet",
        entities: { urls: [{ expanded_url: "https://twitter.com/x/status/9" }] },
      },
    ];
    expect(parseBookmarks(raw)[0]!.isExternal).toBe(false);
  });

  it("dedupes by tweet id and drops records without one", () => {
    const raw = [
      { id_str: "5005", full_text: "one" },
      { id_str: "5005", full_text: "dup" },
      { full_text: "no id" },
    ];
    const items = parseBookmarks(raw);
    expect(items).toHaveLength(1);
    expect(items[0]!.tweetId).toBe("5005");
  });
});
