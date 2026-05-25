import { describe, it, expect } from "vitest";
import { routeInteraction, interactionIdemKey, type SlackInteractionPayload } from "../src/lib/approval.js";
import { ACTION_SHIP, ACTION_EDIT, ACTION_SKIP, EDIT_SUBMIT_CALLBACK, EDIT_INPUT_BLOCK, EDIT_INPUT_ACTION } from "../src/lib/slack.js";

const JOHN = "U_JOHN";
const blockAction = (actionId: string, value = "5", extra: Partial<SlackInteractionPayload> = {}): SlackInteractionPayload => ({
  type: "block_actions",
  user: { id: JOHN },
  message: { ts: "111.222" },
  channel: { id: "D1" },
  trigger_id: "trg_1",
  actions: [{ action_id: actionId, value }],
  ...extra,
});

describe("routeInteraction", () => {
  it("ignores interactions from anyone but John (actor assertion)", () => {
    const fromOther = { ...blockAction(ACTION_SHIP), user: { id: "U_INTRUDER" } };
    expect(routeInteraction(fromOther, JOHN)).toEqual({ kind: "ignore", reason: "actor_mismatch" });
    // And when no owner is configured, nothing is actionable.
    expect(routeInteraction(blockAction(ACTION_SHIP), undefined).kind).toBe("ignore");
  });

  it("routes Ship and Skip with the digest id from the button value", () => {
    expect(routeInteraction(blockAction(ACTION_SHIP, "5"), JOHN)).toEqual({ kind: "ship", digestId: 5 });
    expect(routeInteraction(blockAction(ACTION_SKIP, "9"), JOHN)).toEqual({ kind: "skip", digestId: 9 });
  });

  it("routes Edit to a modal open only when a trigger_id is present", () => {
    expect(routeInteraction(blockAction(ACTION_EDIT, "7"), JOHN)).toEqual({ kind: "edit_open", digestId: 7, triggerId: "trg_1" });
    expect(routeInteraction(blockAction(ACTION_EDIT, "7", { trigger_id: undefined }), JOHN)).toEqual({
      kind: "ignore",
      reason: "no_trigger",
    });
  });

  it("routes a non-empty Edit submission to edit_submit (trimmed)", () => {
    const submit: SlackInteractionPayload = {
      type: "view_submission",
      user: { id: JOHN },
      view: {
        callback_id: EDIT_SUBMIT_CALLBACK,
        private_metadata: "12",
        state: { values: { [EDIT_INPUT_BLOCK]: { [EDIT_INPUT_ACTION]: { value: "  edited body  " } } } },
      },
    };
    expect(routeInteraction(submit, JOHN)).toEqual({ kind: "edit_submit", digestId: 12, body: "edited body" });
  });

  it("flags an empty Edit submission as invalid (keeps the modal open)", () => {
    const submit: SlackInteractionPayload = {
      type: "view_submission",
      user: { id: JOHN },
      view: {
        callback_id: EDIT_SUBMIT_CALLBACK,
        private_metadata: "12",
        state: { values: { [EDIT_INPUT_BLOCK]: { [EDIT_INPUT_ACTION]: { value: "   " } } } },
      },
    };
    expect(routeInteraction(submit, JOHN)).toEqual({ kind: "edit_invalid" });
  });

  it("ignores unknown actions and unhandled types", () => {
    expect(routeInteraction(blockAction("mystery_button"), JOHN).kind).toBe("ignore");
    expect(routeInteraction({ type: "shortcut", user: { id: JOHN } }, JOHN).kind).toBe("ignore");
  });
});

describe("interactionIdemKey", () => {
  it("keys block_actions on (message_ts, action_id, user_id)", () => {
    expect(interactionIdemKey(blockAction(ACTION_SHIP))).toBe(`idem:111.222:${ACTION_SHIP}:${JOHN}`);
  });
  it("returns null for non-block_actions (edit submit is CAS-idempotent)", () => {
    expect(interactionIdemKey({ type: "view_submission", user: { id: JOHN } })).toBeNull();
  });
});
