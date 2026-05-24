import { describe, it, expect } from "vitest";
import { normalizeUrl, validateFetchTarget, InvalidUrlError } from "../src/lib/url.js";

describe("normalizeUrl", () => {
  it("strips utm_* and fbclid tracking params", () => {
    expect(normalizeUrl("https://example.com/post?utm_source=x&utm_medium=email&fbclid=abc")).toBe(
      "https://example.com/post",
    );
  });

  it("lowercases the host and trims a trailing slash", () => {
    expect(normalizeUrl("https://EXAMPLE.com/post/")).toBe("https://example.com/post");
  });

  it("treats utm-tagged and trailing-slash variants as the same dedupe key", () => {
    expect(normalizeUrl("https://example.com/post?utm_source=x")).toBe(
      normalizeUrl("https://EXAMPLE.com/post/"),
    );
  });

  it("keeps meaningful query params but sorts them for stability", () => {
    expect(normalizeUrl("https://example.com/search?b=2&a=1")).toBe(
      "https://example.com/search?a=1&b=2",
    );
  });

  it("preserves a meaningful param while dropping a tracking one", () => {
    expect(normalizeUrl("https://example.com/watch?v=abc123&utm_source=t")).toBe(
      "https://example.com/watch?v=abc123",
    );
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://example.com/post#section-2")).toBe("https://example.com/post");
  });

  it("strips URL credentials (never persisted, and they shouldn't fork the key)", () => {
    expect(normalizeUrl("https://user:pass@example.com/x")).toBe("https://example.com/x");
  });

  it("drops default ports", () => {
    expect(normalizeUrl("https://example.com:443/post")).toBe("https://example.com/post");
  });

  it("keeps the root path slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("throws InvalidUrlError on garbage input", () => {
    expect(() => normalizeUrl("not a url")).toThrow(InvalidUrlError);
  });
});

describe("validateFetchTarget", () => {
  it("accepts a normal https URL", () => {
    expect(validateFetchTarget("https://example.com/post").ok).toBe(true);
  });

  it("accepts http", () => {
    expect(validateFetchTarget("http://example.com").ok).toBe(true);
  });

  it.each([
    ["file:///etc/passwd", "scheme"],
    ["ftp://example.com", "scheme"],
    ["javascript:alert(1)", "scheme"],
  ])("rejects non-http(s) scheme %s", (url) => {
    expect(validateFetchTarget(url).ok).toBe(false);
  });

  it.each([
    "http://localhost/admin",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://192.168.0.1/",
    "http://172.16.5.4/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
    "http://[::1]/",
    "http://0.0.0.0/",
    // IPv4-mapped / NAT64 IPv6 — the parser canonicalizes these to hex, so the
    // embedded private/loopback/metadata IPv4 must still be caught.
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:169.254.169.254]/", // cloud metadata via mapped IPv6
    "http://[64:ff9b::7f00:1]/", // NAT64 -> 127.0.0.1
  ])("rejects private/loopback/link-local target %s", (url) => {
    expect(validateFetchTarget(url).ok).toBe(false);
  });

  it("allows a public 172.x address outside the private /12", () => {
    expect(validateFetchTarget("http://172.15.0.1/").ok).toBe(true);
    expect(validateFetchTarget("http://172.32.0.1/").ok).toBe(true);
  });

  it("allows a public IPv4-mapped IPv6 address", () => {
    expect(validateFetchTarget("http://[::ffff:8.8.8.8]/").ok).toBe(true);
  });

  it("normalizes octal/decimal/short IPv4 encodings back to dotted form and rejects them", () => {
    // The WHATWG parser canonicalizes these to 127.0.0.1, which the v4 guard catches.
    expect(validateFetchTarget("http://2130706433/").ok).toBe(false); // decimal
    expect(validateFetchTarget("http://0x7f.0.0.1/").ok).toBe(false); // hex octet
    expect(validateFetchTarget("http://127.1/").ok).toBe(false); // short form
  });

  it("rejects unparseable input", () => {
    expect(validateFetchTarget("not a url").ok).toBe(false);
  });
});
