import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

// migrations/ lives at the apps/api root: src/lib/ -> ../../migrations
export const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

/**
 * Apply every `*.sql` migration in lexical order. Each migration is written to
 * be idempotent (CREATE ... IF NOT EXISTS), so re-running is safe. Returns the
 * list of files applied.
 */
export async function runMigrations(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(join(dir, file), "utf8");
    await pool.query(sql);
  }
  return files;
}
