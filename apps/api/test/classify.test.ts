import { describe, it, expect } from "vitest";
import { classifyByPattern, estimateConsumeMinutes } from "../src/lib/classify.js";
import { timeBucketFor } from "../src/types.js";

describe("classifyByPattern", () => {
  it("classifies known video hosts as watch (confident, no LLM)", () => {
    expect(classifyByPattern("https://www.youtube.com/watch?v=abc")).toEqual({ tag: "watch", confident: true });
    expect(classifyByPattern("https://youtu.be/abc")).toEqual({ tag: "watch", confident: true });
    expect(classifyByPattern("https://m.youtube.com/watch?v=abc")).toMatchObject({ tag: "watch" });
    expect(classifyByPattern("https://vimeo.com/12345")).toMatchObject({ tag: "watch" });
  });

  it("classifies known audio hosts as listen (confident)", () => {
    expect(classifyByPattern("https://open.spotify.com/episode/xyz")).toEqual({ tag: "listen", confident: true });
    expect(classifyByPattern("https://podcasts.apple.com/us/podcast/x/id1")).toMatchObject({ tag: "listen" });
    expect(classifyByPattern("https://overcast.fm/+abc")).toMatchObject({ tag: "listen" });
  });

  it("defaults an unknown host to read, flagged not-confident", () => {
    expect(classifyByPattern("https://example.com/some-article")).toEqual({ tag: "read", confident: false });
  });

  it("uses og:type as a confident secondary signal", () => {
    expect(classifyByPattern("https://news.site/x", "video.other")).toEqual({ tag: "watch", confident: true });
    expect(classifyByPattern("https://news.site/x", "music.song")).toEqual({ tag: "listen", confident: true });
    expect(classifyByPattern("https://news.site/x", "article")).toEqual({ tag: "read", confident: false });
  });

  it("falls back to read on an unparseable URL", () => {
    expect(classifyByPattern("not a url")).toEqual({ tag: "read", confident: false });
  });
});

describe("estimateConsumeMinutes", () => {
  it("reads: ~225 wpm → minutes (1,800 words → 8 min)", () => {
    expect(estimateConsumeMinutes({ tag: "read", wordCount: 1800 })).toBe(8);
  });

  it("watch: duration → minutes (3-min clip → 3 min, a Quick bucket)", () => {
    const min = estimateConsumeMinutes({ tag: "watch", durationSeconds: 180 });
    expect(min).toBe(3);
    expect(timeBucketFor(min)).toBe("quick");
  });

  it("listen: duration → minutes (50-min episode → 50 min, a Deep bucket)", () => {
    const min = estimateConsumeMinutes({ tag: "listen", durationSeconds: 3000 });
    expect(min).toBe(50);
    expect(timeBucketFor(min)).toBe("deep");
  });

  it("returns null when the needed signal is missing (badge omitted, not a failure)", () => {
    expect(estimateConsumeMinutes({ tag: "read" })).toBeNull();
    expect(estimateConsumeMinutes({ tag: "watch", durationSeconds: null })).toBeNull();
  });

  it("buckets a mid-length read as medium (8 min)", () => {
    expect(timeBucketFor(estimateConsumeMinutes({ tag: "read", wordCount: 1800 }))).toBe("medium");
  });
});
