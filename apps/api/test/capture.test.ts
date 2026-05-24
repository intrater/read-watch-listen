import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "../api/capture.js";
import { validateCaptureInput, MAX_NOTE_LEN, MAX_URL_LEN } from "../src/lib/capture.js";
import { createShioriClient, ShioriError } from "../src/lib/shiori.js";

const IOS_TOKEN = "tok_ios_secret_value";
const EXT_TOKEN = "tok_ext_secret_value";

function postReq(body: unknown, { token, contentType = "application/json" }: { token?: string; contentType?: string } = {}) {
  const headers: Record<string, string> = { "content-type": contentType };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("https://api.test/api/capture", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("validateCaptureInput", () => {
  it("accepts a well-formed capture", () => {
    expect(validateCaptureInput({ url: "https://example.com/x", note: "neat", source: "ios-shortcut" })).toBeNull();
  });

  it("rejects a missing url", () => {
    expect(validateCaptureInput({ source: "ios-shortcut" })?.code).toBe("invalid_url");
  });

  it("rejects a url over the length cap", () => {
    const url = "https://example.com/" + "a".repeat(MAX_URL_LEN);
    expect(validateCaptureInput({ url, source: "ios-shortcut" })?.code).toBe("url_too_long");
  });

  it("rejects a note over the length cap (no silent truncation)", () => {
    expect(
      validateCaptureInput({ url: "https://example.com", note: "x".repeat(MAX_NOTE_LEN + 1), source: "ios-shortcut" })?.code,
    ).toBe("note_too_long");
  });

  it("rejects an unknown source", () => {
    expect(validateCaptureInput({ url: "https://example.com", source: "telepathy" })?.code).toBe("invalid_source");
  });

  it("rejects an SSRF target", () => {
    expect(validateCaptureInput({ url: "http://169.254.169.254/", source: "ios-shortcut" })?.code).toBe("blocked_target");
  });
});

describe("POST /api/capture auth + validation (no DB)", () => {
  beforeEach(() => {
    process.env.CAPTURE_TOKEN_IOS = IOS_TOKEN;
    process.env.CAPTURE_TOKEN_EXT = EXT_TOKEN;
  });
  afterEach(() => {
    delete process.env.CAPTURE_TOKEN_IOS;
    delete process.env.CAPTURE_TOKEN_EXT;
  });

  it("401 when the bearer token is missing", async () => {
    const res = await POST(postReq({ url: "https://example.com", source: "ios-shortcut" }));
    expect(res.status).toBe(401);
  });

  it("401 when the bearer token is wrong", async () => {
    const res = await POST(postReq({ url: "https://example.com", source: "ios-shortcut" }, { token: "tok_wrong" }));
    expect(res.status).toBe(401);
  });

  it("accepts either per-client token (ext token authenticates)", async () => {
    // Reaches validation (and would hit the DB) — assert it got PAST auth by
    // sending an invalid URL so it stops at 400, not 401.
    const res = await POST(postReq({ url: "ftp://example.com", source: "chrome-ext" }, { token: EXT_TOKEN }));
    expect(res.status).toBe(400);
  });

  it("401 fails closed when no token env var is configured", async () => {
    delete process.env.CAPTURE_TOKEN_IOS;
    delete process.env.CAPTURE_TOKEN_EXT;
    const res = await POST(postReq({ url: "https://example.com", source: "ios-shortcut" }, { token: IOS_TOKEN }));
    expect(res.status).toBe(401);
  });

  it("400 on a non-JSON content-type", async () => {
    const res = await POST(postReq("url=https://example.com", { token: IOS_TOKEN, contentType: "text/plain" }));
    expect(res.status).toBe(400);
  });

  it("400 when content-type only contains application/json as a parameter substring", async () => {
    const res = await POST(
      postReq({ url: "https://example.com", source: "ios-shortcut" }, { token: IOS_TOKEN, contentType: "multipart/form-data; boundary=application/json" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("content-type") });
  });

  it("accepts application/json with a charset parameter (reaches validation)", async () => {
    // Passes the content-type gate, then stops at validation (bad scheme) → proves it got past.
    const res = await POST(
      postReq({ url: "ftp://example.com", source: "ios-shortcut" }, { token: IOS_TOKEN, contentType: "application/json; charset=utf-8" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "blocked_target" });
  });

  it("400 on a malformed JSON body", async () => {
    const res = await POST(postReq("{not json", { token: IOS_TOKEN }));
    expect(res.status).toBe(400);
  });

  it("400 with a code on an oversized note", async () => {
    const res = await POST(postReq({ url: "https://example.com", note: "x".repeat(MAX_NOTE_LEN + 1), source: "ios-shortcut" }, { token: IOS_TOKEN }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "note_too_long" });
  });

  it("400 on a private/SSRF URL", async () => {
    const res = await POST(postReq({ url: "http://localhost:8080/admin", source: "ios-shortcut" }, { token: IOS_TOKEN }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "blocked_target" });
  });
});

describe("shiori client (injected fetch)", () => {
  const okResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("posts to /api/links with bearer auth and returns the linkId", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return okResponse({ success: true, linkId: "lnk_123" });
    }) as typeof fetch;

    const client = createShioriClient({ token: "shk_test", fetchImpl });
    const res = await client.createLink({ url: "https://example.com/a", title: "A" });

    expect(res).toEqual({ linkId: "lnk_123", duplicate: false });
    expect(captured?.url).toBe("https://www.shiori.sh/api/links");
    expect((captured?.init.headers as Record<string, string>).authorization).toBe("Bearer shk_test");
    expect(JSON.parse(captured?.init.body as string)).toMatchObject({ url: "https://example.com/a", title: "A" });
  });

  it("flags a duplicate link", async () => {
    const fetchImpl = (async () => okResponse({ success: true, linkId: "lnk_9", duplicate: true })) as typeof fetch;
    const res = await createShioriClient({ token: "shk_test", fetchImpl }).createLink({ url: "https://example.com" });
    expect(res.duplicate).toBe(true);
  });

  it("throws a retryable ShioriError on a 500", async () => {
    const fetchImpl = (async () => okResponse({ error: "boom" }, 500)) as typeof fetch;
    const client = createShioriClient({ token: "shk_test", fetchImpl });
    await expect(client.createLink({ url: "https://example.com" })).rejects.toMatchObject({ status: 500 });
    try {
      await client.createLink({ url: "https://example.com" });
    } catch (e) {
      expect((e as ShioriError).retryable).toBe(true);
    }
  });

  it("throws when SHIORI_TOKEN is absent", async () => {
    delete process.env.SHIORI_TOKEN;
    const fetchImpl = (async () => okResponse({})) as typeof fetch;
    await expect(createShioriClient({ fetchImpl }).createLink({ url: "https://example.com" })).rejects.toBeInstanceOf(ShioriError);
  });
});
