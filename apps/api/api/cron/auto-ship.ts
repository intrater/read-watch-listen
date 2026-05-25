// GET /api/cron/auto-ship — per-minute durable timer sweep (U6). Ships every
// pending digest whose 30-min auto-ship window has elapsed. The CAS in
// approveDigest makes this safe against a simultaneous Ship click. Declared in
// vercel.json.

import { autoShipDue } from "../../src/lib/approval.js";

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await autoShipDue();
    return Response.json(result);
  } catch (e) {
    console.error("auto-ship cron failed:", e);
    return Response.json({ status: "error", message: (e as Error).message }, { status: 500 });
  }
}
