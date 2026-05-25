import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getPool, query, closePool } from "../src/lib/db.js";
import { runMigrations } from "../src/lib/migrate.js";
import { approveDigest, skipDigest, editAndApprove, autoShipDue, shipDigest } from "../src/lib/approval.js";
import type { SlackClient } from "../src/lib/slack.js";

const describeDb =
  process.env.DATABASE_URL || process.env.POSTGRES_URL ? describe : describe.skip;

const TAG = `appr-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// A Slack stub so finishShip's DM update never hits the network. (Rows here have
// no slack_msg_ts, so finalizeDM returns before calling it anyway.)
const stubSlack = (): SlackClient => ({
  postMessage: vi.fn(async () => ({ ts: "1.1", channel: "D1" })),
  updateMessage: vi.fn(async () => {}),
  openView: vi.fn(async () => {}),
});

let seq = 0;
async function insertPending(opts: { autoShipAt?: string | null; status?: string } = {}): Promise<number> {
  const slug = `${TAG}-${seq++}`;
  const r = await query<{ id: number }>(
    `INSERT INTO digests (kind, status, slug, body_md, auto_ship_at)
     VALUES ('daily', $2, $1, 'body', $3::timestamptz) RETURNING id`,
    [slug, opts.status ?? "pending", opts.autoShipAt ?? null],
  );
  return r.rows[0]!.id;
}

const statusOf = async (id: number) =>
  (await query<{ status: string }>("SELECT status FROM digests WHERE id = $1", [id])).rows[0]!.status;

describeDb("approval transitions integration (requires DATABASE_URL)", () => {
  beforeAll(async () => {
    await runMigrations(getPool());
  });
  afterAll(async () => {
    await query("DELETE FROM digests WHERE slug LIKE $1", [`${TAG}%`]);
    await closePool();
  });

  it("approveDigest is a single-fire CAS — the ship-click-vs-timer race resolves to one winner", async () => {
    const id = await insertPending();
    const [a, b] = await Promise.all([approveDigest(id), approveDigest(id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one transition
    expect(await statusOf(id)).toBe("approved");
    expect(await approveDigest(id)).toBe(false); // already terminal
  });

  it("skipDigest only fires from pending", async () => {
    const id = await insertPending();
    expect(await skipDigest(id)).toBe(true);
    expect(await statusOf(id)).toBe("skipped");
    expect(await skipDigest(id)).toBe(false);
  });

  it("editAndApprove writes the new body then approves", async () => {
    const id = await insertPending();
    expect(await editAndApprove(id, "EDITED BODY")).toBe(true);
    const row = await query<{ status: string; body_md: string }>("SELECT status, body_md FROM digests WHERE id = $1", [id]);
    expect(row.rows[0]).toMatchObject({ status: "approved", body_md: "EDITED BODY" });
  });

  it("shipDigest fans out exactly once and is a no-op on a second call", async () => {
    const id = await insertPending();
    const fanOut = vi.fn(async () => {});
    expect(await shipDigest(id, "shipped", { fanOut, slack: stubSlack() })).toBe(true);
    expect(await shipDigest(id, "shipped", { fanOut, slack: stubSlack() })).toBe(false);
    expect(fanOut).toHaveBeenCalledTimes(1);
    expect(fanOut).toHaveBeenCalledWith(id);
  });

  it("autoShipDue ships only digests whose timer has elapsed", async () => {
    const due = await insertPending({ autoShipAt: new Date(Date.now() - 60_000).toISOString() });
    const future = await insertPending({ autoShipAt: new Date(Date.now() + 3_600_000).toISOString() });
    const fanOut = vi.fn(async () => {});

    const result = await autoShipDue({ fanOut, slack: stubSlack() });

    expect(result.shipped).toContain(due);
    expect(result.shipped).not.toContain(future);
    expect(await statusOf(due)).toBe("approved");
    expect(await statusOf(future)).toBe("pending");
    expect(fanOut).toHaveBeenCalledWith(due);
  });
});
