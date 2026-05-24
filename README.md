# RWL — Read · Watch · Listen

John Intrater's curated AI publication, assembled with AI co-authorship. Links about AI broadly — filtered through a designer's curatorial taste — captured once and published as daily digests + a weekly "Weekend Reads" to a Faire Slack channel, a public email/RSS list, and a public website.

> Curated by John Intrater · Assembled by Claude

## Architecture (Vercel)

- **`apps/api`** — Vercel Functions (capture API, Slack webhook, subscribe endpoint) + Vercel Cron (daily/Friday digests, auto-ship sweep). State in **Vercel Postgres** (Neon).
- **`apps/site`** — Astro static site on Vercel (homepage feed, archive, RSS). Navigated by **medium** (Read/Watch/Listen) + **time-to-consume** (Quick/Medium/Deep).
- **`apps/bootstrap`** — one-time Twitter/X bookmark import for launch.
- **`apps/chrome-extension`** — desktop capture client.

**Shiori** ([shiori.sh](https://www.shiori.sh)) is the canonical bookmark store; RWL owns the editorial overlay (the "why" note, R/W/L, consume-time) and publication state in Postgres, joined to Shiori on `shiori_id`. **Buttondown** is the source of truth for email subscribers.

See `docs/plans/2026-05-24-001-feat-rwl-greenfield-build-plan.md` for the full build plan.

## Develop

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
```

`apps/api` reads `DATABASE_URL` (Vercel Postgres). Locally: `cd apps/api && vercel link && vercel env pull .env.local`, then `pnpm migrate` to apply the schema.
