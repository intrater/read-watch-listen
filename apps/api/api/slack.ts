// POST /api/slack — Slack interactivity webhook (U6). Verifies the request
// signature, asserts the actor is John, dedupes, then routes Ship / Edit / Skip
// and the Edit-modal submission. ACKs within Slack's 3s budget; the Edit modal's
// views.open is called synchronously (the trigger_id expires fast), everything
// else runs in waitUntil.

import { waitUntil } from "@vercel/functions";
import { getKvState, setKvState } from "../src/lib/kv.js";
import { verifySlackSignature, createSlackClient, buildEditModal, EDIT_INPUT_BLOCK } from "../src/lib/slack.js";
import {
  routeInteraction,
  interactionIdemKey,
  shipDigest,
  skipDigest,
  editAndApprove,
  finishShip,
  finalizeDM,
  type SlackInteractionPayload,
} from "../src/lib/approval.js";

const ack = (): Response => new Response("", { status: 200 });

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();

  if (
    !verifySlackSignature({
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      timestamp: req.headers.get("x-slack-request-timestamp"),
      signature: req.headers.get("x-slack-signature"),
      body: raw,
    })
  ) {
    return new Response("invalid signature", { status: 401 });
  }

  // Interactivity payloads arrive form-encoded as payload=<json>.
  const payloadRaw = new URLSearchParams(raw).get("payload");
  if (!payloadRaw) return ack();
  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(payloadRaw) as SlackInteractionPayload;
  } catch {
    return ack();
  }

  const johnUserId = process.env.JOHN_SLACK_USER_ID;
  const routed = routeInteraction(payload, johnUserId);

  if (routed.kind === "ignore") {
    if (routed.reason === "actor_mismatch") {
      console.warn("slack interaction from non-owner ignored:", payload.user?.id);
    }
    return ack();
  }

  // Dedupe button clicks (Slack retries; double-taps). Edit-submit is naturally
  // idempotent via the CAS, so we only gate block_actions.
  const idemKey = interactionIdemKey(payload);
  if (idemKey) {
    if (await getKvState(idemKey)) return ack();
    await setKvState(idemKey, { at: Date.now() }, 60 * 60 * 1000);
  }

  switch (routed.kind) {
    case "edit_open": {
      // Synchronous — the trigger_id expires within ~3s.
      const cached = await getKvState<{ bodyMd: string }>(`pending_draft:${routed.digestId}`);
      try {
        await createSlackClient().openView({
          triggerId: routed.triggerId,
          view: buildEditModal(routed.digestId, cached?.bodyMd ?? ""),
        });
      } catch (e) {
        console.error("views.open failed:", e);
      }
      // Cancelling the modal leaves the original (still-actionable) DM in place
      // and the 30-min timer running, so we intentionally don't mutate the DM here.
      return ack();
    }
    case "ship":
      waitUntil(shipDigest(routed.digestId, "shipped").catch((e) => console.error("ship failed:", e)));
      return ack();
    case "skip":
      waitUntil(
        (async () => {
          if (await skipDigest(routed.digestId)) await finalizeDM(routed.digestId, "skipped");
        })().catch((e) => console.error("skip failed:", e)),
      );
      return ack();
    case "edit_submit":
      waitUntil(
        (async () => {
          if (await editAndApprove(routed.digestId, routed.body)) {
            await finishShip(routed.digestId, "shipped");
          }
        })().catch((e) => console.error("edit-submit failed:", e)),
      );
      return ack(); // empty 200 closes the modal
    case "edit_invalid":
      // Keep the modal open with an inline error.
      return Response.json({
        response_action: "errors",
        errors: { [EDIT_INPUT_BLOCK]: "The digest can't be empty." },
      });
  }
}
