import { Pool, type QueryResult, type QueryResultRow } from "pg";

// A single lazily-created pool per function instance. Vercel Postgres (Neon)
// pools connections at the proxy, so `max: 1` is the right setting for
// short-lived serverless invocations.
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL (or POSTGRES_URL) is not set");
    }
    pool = new Pool({ connectionString, max: 1 });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[] | undefined);
}

/** Query function scoped to a single transaction connection. */
export type TxQuery = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/**
 * Run `fn` inside a BEGIN/COMMIT, rolling back on any throw. All statements use
 * one checked-out connection so they're atomic (e.g. a digest + its items).
 */
export async function withTransaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn((text, params) => client.query(text, params as unknown[] | undefined));
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
