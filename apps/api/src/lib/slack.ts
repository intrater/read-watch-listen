// Slack integration for the digest approval flow (U6): request-signature
// verification, a thin Web API client (chat.postMessage / chat.update /
// views.open), and the Block Kit payloads. Injectable fetch for tests; the live
// round-trip is verified once SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET exist.

import { createHmac, timingSafeEqual } from "node:crypto";

const SLACK_API = "https://slack.com/api";

/** Non-ok Slack response (HTTP error or `{ok:false}`) or transport failure. */
export class SlackError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SlackError";
    this.status = status;
  }
  get retryable(): boolean {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

// --- Request signature verification ---

export interface SignatureInput {
  signingSecret: string | undefined;
  timestamp: string | null;
  signature: string | null;
  body: string;
  /** Now in seconds; injectable for tests. */
  nowSec?: number;
}

/**
 * Verify a Slack request signature (v0 = HMAC-SHA256 of `v0:ts:body`). Rejects
 * stale timestamps (>5 min) to blunt replay, and compares in constant time.
 * Fails closed when the signing secret or headers are absent.
 */
export function verifySlackSignature(input: SignatureInput): boolean {
  const { signingSecret, timestamp, signature, body } = input;
  if (!signingSecret || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;

  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Web API client ---

export interface PostMessageInput {
  channel: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
}
export interface PostMessageResult {
  ts: string;
  channel: string;
}

export interface SlackClient {
  postMessage(input: PostMessageInput): Promise<PostMessageResult>;
  updateMessage(input: { channel: string; ts: string; text: string; blocks?: unknown[] }): Promise<void>;
  openView(input: { triggerId: string; view: unknown }): Promise<void>;
}

export interface SlackClientConfig {
  token?: string;
  fetchImpl?: typeof fetch;
}

export function createSlackClient(config: SlackClientConfig = {}): SlackClient {
  const doFetch = config.fetchImpl ?? fetch;

  async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const token = config.token ?? process.env.SLACK_BOT_TOKEN;
    if (!token) throw new SlackError("SLACK_BOT_TOKEN is not set");

    let res: Response;
    try {
      res = await doFetch(`${SLACK_API}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
    } catch (cause) {
      throw new SlackError(`Slack request failed: ${(cause as Error).message}`);
    }
    if (!res.ok) throw new SlackError(`Slack ${method} -> ${res.status}`, res.status);

    const data = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!data.ok) throw new SlackError(`Slack ${method} not ok: ${data.error ?? "unknown"}`);
    return data;
  }

  return {
    async postMessage(input) {
      const data = await call<{ ts: string; channel: string }>("chat.postMessage", {
        channel: input.channel,
        text: input.text,
        blocks: input.blocks,
        thread_ts: input.threadTs,
      });
      return { ts: data.ts, channel: data.channel };
    },
    async updateMessage(input) {
      await call("chat.update", {
        channel: input.channel,
        ts: input.ts,
        text: input.text,
        blocks: input.blocks,
      });
    },
    async openView(input) {
      await call("views.open", { trigger_id: input.triggerId, view: input.view });
    },
  };
}

// --- Block Kit payloads ---

export const ACTION_SHIP = "ship_digest";
export const ACTION_EDIT = "edit_digest";
export const ACTION_SKIP = "skip_digest";
export const EDIT_SUBMIT_CALLBACK = "edit_digest_submit";
export const EDIT_INPUT_BLOCK = "digest_body_block";
export const EDIT_INPUT_ACTION = "digest_body_input";

/** The draft DM with Ship / Edit / Skip controls. `value` carries the digest id. */
export function buildApprovalBlocks(digest: { id: number; slug: string; itemCount: number; bodyMd: string }): unknown[] {
  const id = String(digest.id);
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*📋 Daily digest draft — ${digest.slug}* · ${digest.itemCount} item(s)` },
    },
    { type: "section", text: { type: "mrkdwn", text: truncateForSlack(digest.bodyMd) } },
    {
      type: "actions",
      block_id: "digest_actions",
      elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "Ship" }, action_id: ACTION_SHIP, value: id },
        { type: "button", text: { type: "plain_text", text: "Edit" }, action_id: ACTION_EDIT, value: id },
        { type: "button", style: "danger", text: { type: "plain_text", text: "Skip" }, action_id: ACTION_SKIP, value: id },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: "Auto-ships in 30 min if no response." }] },
  ];
}

export type TerminalKind = "shipped" | "auto_shipped" | "skipped";

/** Terminal DM state — buttons removed so it can't be re-actioned. */
export function buildTerminalBlocks(kind: TerminalKind, opts: { slug: string; itemCount: number; at?: string }): unknown[] {
  const at = opts.at ?? hhmm();
  const text =
    kind === "shipped"
      ? `✅ *Shipped ${at}* · ${opts.slug} · ${opts.itemCount} item(s)`
      : kind === "auto_shipped"
        ? `🚀 *Auto-shipped ${at}* (30-min window elapsed) · ${opts.slug} · ${opts.itemCount} item(s)`
        : `🗙 *Skipped* · ${opts.slug} · ${opts.itemCount} item(s) held for the next digest`;
  return [{ type: "section", text: { type: "mrkdwn", text } }];
}

/** The Edit modal — a single markdown input pre-filled with the draft body. */
export function buildEditModal(digestId: number, bodyMd: string): unknown {
  return {
    type: "modal",
    callback_id: EDIT_SUBMIT_CALLBACK,
    private_metadata: String(digestId),
    title: { type: "plain_text", text: "Edit digest" },
    submit: { type: "plain_text", text: "Ship" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: EDIT_INPUT_BLOCK,
        label: { type: "plain_text", text: "Digest (markdown)" },
        element: {
          type: "plain_text_input",
          action_id: EDIT_INPUT_ACTION,
          multiline: true,
          initial_value: bodyMd.slice(0, 3000),
          max_length: 3000,
        },
      },
    ],
  };
}

// Slack section text caps at 3000 chars.
function truncateForSlack(s: string): string {
  return s.length > 2900 ? `${s.slice(0, 2900)}\n…` : s;
}

function hhmm(d = new Date()): string {
  return d.toISOString().slice(11, 16);
}
