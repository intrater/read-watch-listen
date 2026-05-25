// Digest approval state machine (U6). Posts the Block Kit DM, handles the
// Ship/Edit/Skip interactions, and runs the durable 30-min auto-ship timer — all
// with idempotent, atomic transitions so the ship-click-vs-timer race and Slack
// retries resolve to exactly one fan-out.
//
// State: draft → (postApprovalDM) → pending → (approve|skip|auto-ship) → approved|skipped.
// Approval is a compare-and-swap shared by the click handler and the cron sweep.
// Fan-out (U7) is injected; until then it's a no-op.

import { query } from "./db.js";
import { setKvState } from "./kv.js";
import {
  createSlackClient,
  buildApprovalBlocks,
  buildTerminalBlocks,
  ACTION_SHIP,
  ACTION_EDIT,
  ACTION_SKIP,
  EDIT_SUBMIT_CALLBACK,
  EDIT_INPUT_BLOCK,
  EDIT_INPUT_ACTION,
  type SlackClient,
  type TerminalKind,
} from "./slack.js";

const AUTO_SHIP_MS = 30 * 60 * 1000;

export interface ApprovalDeps {
  slack?: SlackClient;
  johnUserId?: string;
  /** Fan-out to Slack channel / email / site. Injected by U7; no-op until then. */
  fanOut?: (digestId: number) => Promise<void>;
  /** Auto-ship window in ms (tests shorten it). */
  autoShipMs?: number;
}

const noopFanOut = async (digestId: number): Promise<void> => {
  console.info(`fan-out for digest ${digestId} deferred to U7`);
};

// --- DM lifecycle ---

/** Post the approval DM to John, then move the digest draft → pending with the
 *  message handle and the auto-ship deadline. Idempotent: a non-draft digest is
 *  left untouched (so a re-fire doesn't double-post). */
export async function postApprovalDM(digestId: number, deps: ApprovalDeps = {}): Promise<void> {
  const slack = deps.slack ?? createSlackClient();
  const johnUserId = deps.johnUserId ?? process.env.JOHN_SLACK_USER_ID;
  if (!johnUserId) throw new Error("JOHN_SLACK_USER_ID is not set");

  const row = (
    await query<{ slug: string; body_md: string; status: string; n: number }>(
      `SELECT d.slug, d.body_md, d.status,
              (SELECT count(*) FROM digest_items di WHERE di.digest_id = d.id)::int AS n
         FROM digests d WHERE d.id = $1`,
      [digestId],
    )
  ).rows[0];
  if (!row) throw new Error(`digest ${digestId} not found`);
  if (row.status !== "draft") return; // already advanced — don't double-post

  const blocks = buildApprovalBlocks({ id: digestId, slug: row.slug, itemCount: row.n, bodyMd: row.body_md });
  const posted = await slack.postMessage({
    channel: johnUserId,
    text: `Daily digest draft — ${row.slug}`,
    blocks,
  });

  const autoShipMs = deps.autoShipMs ?? AUTO_SHIP_MS;
  await query(
    `UPDATE digests
        SET status = 'pending', slack_msg_ts = $2, slack_channel_id = $3,
            auto_ship_at = $4::timestamptz
      WHERE id = $1 AND status = 'draft'`,
    [digestId, posted.ts, posted.channel, new Date(Date.now() + autoShipMs).toISOString()],
  );
  // Cache the body for the Edit modal (fast lookup within Slack's 3s trigger window).
  await setKvState(
    `pending_draft:${digestId}`,
    { bodyMd: row.body_md, slug: row.slug, itemCount: row.n },
    autoShipMs + 60 * 60 * 1000,
  );
}

/** Update the original DM to a terminal (button-less) state. Best-effort. */
export async function finalizeDM(digestId: number, kind: TerminalKind, deps: ApprovalDeps = {}): Promise<void> {
  const slack = deps.slack ?? createSlackClient();
  const row = (
    await query<{ slug: string; n: number; slack_msg_ts: string | null; slack_channel_id: string | null }>(
      `SELECT slug, slack_msg_ts, slack_channel_id,
              (SELECT count(*) FROM digest_items di WHERE di.digest_id = digests.id)::int AS n
         FROM digests WHERE id = $1`,
      [digestId],
    )
  ).rows[0];
  if (!row?.slack_msg_ts || !row.slack_channel_id) return;
  await slack.updateMessage({
    channel: row.slack_channel_id,
    ts: row.slack_msg_ts,
    text: kind,
    blocks: buildTerminalBlocks(kind, { slug: row.slug, itemCount: row.n }),
  });
}

// --- Atomic transitions (compare-and-swap on status='pending') ---

/** Approve iff currently pending. Returns true only for the one caller that
 *  flipped it — the click/timer race resolves here. */
export async function approveDigest(digestId: number): Promise<boolean> {
  const res = await query(
    "UPDATE digests SET status = 'approved', approved_at = now() WHERE id = $1 AND status = 'pending'",
    [digestId],
  );
  return res.rowCount === 1;
}

export async function skipDigest(digestId: number): Promise<boolean> {
  const res = await query(
    "UPDATE digests SET status = 'skipped' WHERE id = $1 AND status = 'pending'",
    [digestId],
  );
  return res.rowCount === 1;
}

/** Apply an edited body (only while pending), then approve atomically. */
export async function editAndApprove(digestId: number, body: string): Promise<boolean> {
  await query("UPDATE digests SET body_md = $2 WHERE id = $1 AND status = 'pending'", [digestId, body]);
  return approveDigest(digestId);
}

/** The post-approval tail: fan out, then move the DM to its terminal state.
 *  Call only after a successful CAS so it runs exactly once. */
export async function finishShip(
  digestId: number,
  kind: Extract<TerminalKind, "shipped" | "auto_shipped">,
  deps: ApprovalDeps = {},
): Promise<void> {
  await (deps.fanOut ?? noopFanOut)(digestId);
  await finalizeDM(digestId, kind, deps).catch((e) => console.warn("DM finalize failed:", e));
}

/** Approve + fan out, exactly once. Shared by the Ship click and the auto-ship cron. */
export async function shipDigest(
  digestId: number,
  kind: Extract<TerminalKind, "shipped" | "auto_shipped">,
  deps: ApprovalDeps = {},
): Promise<boolean> {
  const transitioned = await approveDigest(digestId);
  if (transitioned) await finishShip(digestId, kind, deps);
  return transitioned;
}

/** The per-minute sweep: ship every pending digest whose timer has elapsed. */
export async function autoShipDue(deps: ApprovalDeps = {}): Promise<{ shipped: number[] }> {
  const due = await query<{ id: number }>(
    "SELECT id FROM digests WHERE status = 'pending' AND auto_ship_at <= now()",
  );
  const shipped: number[] = [];
  for (const { id } of due.rows) {
    if (await shipDigest(id, "auto_shipped", deps)) shipped.push(id);
  }
  return { shipped };
}

// --- Interaction routing (pure; no DB/Slack — unit-testable) ---

export interface SlackInteractionPayload {
  type?: string;
  user?: { id?: string };
  trigger_id?: string;
  message?: { ts?: string };
  channel?: { id?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: { values?: Record<string, Record<string, { value?: string }>> };
  };
}

export type RoutedInteraction =
  | { kind: "ignore"; reason: string }
  | { kind: "ship"; digestId: number }
  | { kind: "skip"; digestId: number }
  | { kind: "edit_open"; digestId: number; triggerId: string }
  | { kind: "edit_submit"; digestId: number; body: string }
  | { kind: "edit_invalid" };

/** Decide what an interaction means. Enforces the actor assertion (only John can
 *  drive the flow) before anything else. */
export function routeInteraction(
  payload: SlackInteractionPayload,
  johnUserId: string | undefined,
): RoutedInteraction {
  if (!johnUserId || payload.user?.id !== johnUserId) {
    return { kind: "ignore", reason: "actor_mismatch" };
  }

  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    const digestId = Number(action?.value);
    if (!action || !Number.isFinite(digestId)) return { kind: "ignore", reason: "no_action" };
    switch (action.action_id) {
      case ACTION_SHIP:
        return { kind: "ship", digestId };
      case ACTION_SKIP:
        return { kind: "skip", digestId };
      case ACTION_EDIT:
        return payload.trigger_id
          ? { kind: "edit_open", digestId, triggerId: payload.trigger_id }
          : { kind: "ignore", reason: "no_trigger" };
      default:
        return { kind: "ignore", reason: "unknown_action" };
    }
  }

  if (payload.type === "view_submission" && payload.view?.callback_id === EDIT_SUBMIT_CALLBACK) {
    const digestId = Number(payload.view.private_metadata);
    const body = payload.view.state?.values?.[EDIT_INPUT_BLOCK]?.[EDIT_INPUT_ACTION]?.value ?? "";
    if (!Number.isFinite(digestId)) return { kind: "ignore", reason: "no_digest" };
    return body.trim() ? { kind: "edit_submit", digestId, body: body.trim() } : { kind: "edit_invalid" };
  }

  return { kind: "ignore", reason: "unhandled_type" };
}

/** Idempotency key for a block_actions interaction: (message_ts, action_id, user_id). */
export function interactionIdemKey(payload: SlackInteractionPayload): string | null {
  if (payload.type !== "block_actions") return null;
  const ts = payload.message?.ts;
  const actionId = payload.actions?.[0]?.action_id;
  const user = payload.user?.id;
  if (!ts || !actionId || !user) return null;
  return `idem:${ts}:${actionId}:${user}`;
}
