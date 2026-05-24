import { describe, it, expect, afterAll } from "vitest";
import { query, getPool, closePool } from "../src/lib/db.js";
import { runMigrations } from "../src/lib/migrate.js";

// Runs only when a real database is configured (locally, after
// `vercel env pull .env.local`). Self-skips in CI where DATABASE_URL is unset.
const describeDb =
  process.env.DATABASE_URL || process.env.POSTGRES_URL ? describe : describe.skip;

describeDb("db integration (requires DATABASE_URL)", () => {
  afterAll(async () => {
    await closePool();
  });

  it("connects and runs SELECT 1", async () => {
    const res = await query<{ one: number }>("SELECT 1 AS one");
    expect(res.rows[0]?.one).toBe(1);
  });

  it("migration is idempotent — applying it twice does not error", async () => {
    await runMigrations(getPool());
    await expect(runMigrations(getPool())).resolves.toEqual(
      expect.arrayContaining(["0001_initial.sql"]),
    );
  });

  it("expected tables exist after migration", async () => {
    await runMigrations(getPool());
    const res = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'`,
    );
    const tables = res.rows.map((r) => r.table_name);
    for (const t of ["captures", "digests", "digest_items", "fan_out_status", "kv_state"]) {
      expect(tables).toContain(t);
    }
    // No subscribers table — Buttondown owns the list.
    expect(tables).not.toContain("subscribers");
  });
});
