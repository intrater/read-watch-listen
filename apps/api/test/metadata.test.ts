import { describe, it, expect, vi } from "vitest";
import { fetchPageMetadata } from "../src/lib/metadata.js";

const htmlRes = (html: string, headers: Record<string, string> = {}) =>
  new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

const redirectRes = (location: string) =>
  new Response(null, { status: 302, headers: { location } });

describe("fetchPageMetadata", () => {
  it("extracts og:title/description/type and a word count", async () => {
    const fetchImpl = vi.fn(
      async () =>
        htmlRes(
          `<html><head>
             <title>Fallback Title</title>
             <meta property="og:title" content="Real Title">
             <meta name="description" content="A clear description">
             <meta property="og:type" content="article">
           </head><body><p>one two three four five</p></body></html>`,
        ),
    ) as unknown as typeof fetch;

    const meta = await fetchPageMetadata("https://example.com/a", { fetchImpl });
    expect(meta?.title).toBe("Real Title"); // og:title beats <title>
    expect(meta?.description).toBe("A clear description");
    expect(meta?.ogType).toBe("article");
    expect(meta?.wordCount).toBeGreaterThan(0);
  });

  it("falls back to <title> when og:title is absent, decoding entities", async () => {
    const fetchImpl = vi.fn(async () => htmlRes("<title>Tom &amp; Jerry</title>")) as unknown as typeof fetch;
    const meta = await fetchPageMetadata("https://example.com/b", { fetchImpl });
    expect(meta?.title).toBe("Tom & Jerry");
  });

  it("reads a declared media duration", async () => {
    const fetchImpl = vi.fn(
      async () =>
        htmlRes(`<meta property="og:type" content="video.other"><meta property="og:video:duration" content="180">`),
    ) as unknown as typeof fetch;
    const meta = await fetchPageMetadata("https://example.com/v", { fetchImpl });
    expect(meta?.durationSeconds).toBe(180);
  });

  it("blocks a redirect that resolves to a private/SSRF target (re-validates each hop)", async () => {
    const fetchImpl = vi.fn(async () => redirectRes("http://169.254.169.254/latest/meta-data")) as unknown as typeof fetch;
    expect(await fetchPageMetadata("https://example.com/redir", { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never followed to the metadata endpoint
  });

  it("caps the redirect chain", async () => {
    const fetchImpl = vi.fn(async () => redirectRes("https://example.com/next")) as unknown as typeof fetch;
    expect(await fetchPageMetadata("https://example.com/start", { fetchImpl, maxRedirects: 2 })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 hops, then bail
  });

  it("does not fetch a disallowed scheme", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await fetchPageMetadata("ftp://example.com/x", { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns an empty record (not null) for non-HTML content", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("%PDF-1.7", { status: 200, headers: { "content-type": "application/pdf" } }),
    ) as unknown as typeof fetch;
    const meta = await fetchPageMetadata("https://example.com/doc.pdf", { fetchImpl });
    expect(meta).not.toBeNull();
    expect(meta?.title).toBeNull();
    expect(meta?.wordCount).toBeNull();
  });
});
