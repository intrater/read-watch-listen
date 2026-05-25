import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifySlackSignature,
  createSlackClient,
  SlackError,
  buildApprovalBlocks,
  buildTerminalBlocks,
  buildEditModal,
  ACTION_SHIP,
  ACTION_EDIT,
  ACTION_SKIP,
  EDIT_SUBMIT_CALLBACK,
} from "../src/lib/slack.js";

const SECRET = "test_signing_secret";
const sign = (ts: string, body: string) =>
  `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex")}`;

describe("verifySlackSignature", () => {
  const ts = "1700000000";
  const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";

  it("accepts a correct signature within the replay window", () => {
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: ts, signature: sign(ts, body), body, nowSec: 1700000000 }),
    ).toBe(true);
  });

  it("rejects a stale timestamp (>5 min) — replay protection", () => {
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: ts, signature: sign(ts, body), body, nowSec: 1700000000 + 301 }),
    ).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: ts, signature: sign(ts, body), body: `${body}X`, nowSec: 1700000000 }),
    ).toBe(false);
  });

  it("fails closed when the secret or headers are missing", () => {
    expect(verifySlackSignature({ signingSecret: undefined, timestamp: ts, signature: sign(ts, body), body })).toBe(false);
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: null, signature: sign(ts, body), body })).toBe(false);
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ts, signature: null, body })).toBe(false);
  });
});

describe("Block Kit builders", () => {
  it("approval blocks expose Ship/Edit/Skip buttons carrying the digest id", () => {
    const blocks = buildApprovalBlocks({ id: 42, slug: "daily-2026-05-24", itemCount: 3, bodyMd: "## Read\n- x" }) as Array<{
      type: string;
      elements?: Array<{ action_id: string; value: string }>;
    }>;
    const actions = blocks.find((b) => b.type === "actions");
    const ids = actions!.elements!.map((e) => e.action_id);
    expect(ids).toEqual([ACTION_SHIP, ACTION_EDIT, ACTION_SKIP]);
    expect(actions!.elements!.every((e) => e.value === "42")).toBe(true);
  });

  it("terminal blocks drop the action buttons", () => {
    const blocks = buildTerminalBlocks("shipped", { slug: "s", itemCount: 2, at: "14:00" }) as Array<{ type: string }>;
    expect(blocks.some((b) => b.type === "actions")).toBe(false);
    expect(JSON.stringify(blocks)).toContain("Shipped 14:00");
  });

  it("edit modal carries the digest id in private_metadata and pre-fills the body", () => {
    const view = buildEditModal(7, "BODY_TEXT") as {
      callback_id: string;
      private_metadata: string;
      blocks: Array<{ element: { initial_value: string } }>;
    };
    expect(view.callback_id).toBe(EDIT_SUBMIT_CALLBACK);
    expect(view.private_metadata).toBe("7");
    expect(view.blocks[0]!.element.initial_value).toBe("BODY_TEXT");
  });
});

describe("createSlackClient", () => {
  const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("postMessage returns ts + channel and sends bearer auth", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return okJson({ ok: true, ts: "1.23", channel: "D123" });
    }) as typeof fetch;
    const res = await createSlackClient({ token: "xoxb-1", fetchImpl }).postMessage({ channel: "U1", text: "hi" });
    expect(res).toEqual({ ts: "1.23", channel: "D123" });
    expect(captured?.url).toBe("https://slack.com/api/chat.postMessage");
    expect((captured?.init.headers as Record<string, string>).authorization).toBe("Bearer xoxb-1");
  });

  it("throws SlackError on an ok:false response", async () => {
    const fetchImpl = (async () => okJson({ ok: false, error: "channel_not_found" })) as typeof fetch;
    await expect(
      createSlackClient({ token: "xoxb-1", fetchImpl }).postMessage({ channel: "U1", text: "hi" }),
    ).rejects.toBeInstanceOf(SlackError);
  });

  it("throws when SLACK_BOT_TOKEN is absent", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const fetchImpl = (async () => okJson({ ok: true })) as typeof fetch;
    await expect(createSlackClient({ fetchImpl }).openView({ triggerId: "t", view: {} })).rejects.toBeInstanceOf(SlackError);
  });
});
