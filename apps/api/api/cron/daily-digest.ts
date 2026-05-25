// GET /api/cron/daily-digest — Vercel Cron target (07:00 PT Sun–Fri; declared in
// vercel.json). Composes the day's digest draft. Saturday is intentionally
// skipped so it never double-sends with the Saturday Weekend Reads recap (U8).
//
// Verification (plan): manually trigger this and confirm a draft `digests` row
// appears with non-empty body_md and status='draft'.

import { composeDailyDigest } from "../../src/lib/digest.js";

export async function GET(req: Request): Promise<Response> {
  // Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is
  // configured. Enforce it when present so the endpoint can't be triggered publicly.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await composeDailyDigest();
    return Response.json(outcome);
  } catch (e) {
    console.error("daily-digest cron failed:", e);
    return Response.json({ status: "error", message: (e as Error).message }, { status: 500 });
  }
}
