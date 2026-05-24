import { query } from "../src/lib/db.js";

// GET /api/health — liveness + DB reachability. Used by U1 verification and as
// an ongoing uptime probe. Never throws: reports db state instead.
export async function GET(): Promise<Response> {
  let db: "up" | "down" | "unconfigured" = "unconfigured";
  if (process.env.DATABASE_URL) {
    try {
      await query("SELECT 1");
      db = "up";
    } catch {
      db = "down";
    }
  }
  return Response.json({ status: "ok", db, ts: new Date().toISOString() });
}
