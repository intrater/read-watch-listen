import { config } from "dotenv";
import { getPool, closePool } from "../src/lib/db.js";
import { runMigrations } from "../src/lib/migrate.js";

// Load local env (vercel env pull writes .env.local); no-op on Vercel where
// env vars come from the platform.
config({ path: ".env.local" });
config();

const applied = await runMigrations(getPool());
console.log(`Applied ${applied.length} migration(s): ${applied.join(", ") || "(none)"}`);
await closePool();
