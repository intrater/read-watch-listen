import { config } from "dotenv";

// Make local DATABASE_URL (from `vercel env pull .env.local`) available so the
// DB integration tests run locally. In CI there is no .env.local, so
// DATABASE_URL stays unset and those tests self-skip.
config({ path: ".env.local" });
config();
