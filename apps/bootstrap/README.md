# @rwl/bootstrap — Twitter/X bookmark bootstrap importer (U13)

A one-time CLI that seeds RWL's corpus from your existing X (Twitter) bookmarks:
parse the export → LLM AI-relevance filter → review candidates in the terminal →
import approved items to Shiori + Postgres with `bootstrap=true` (so they show on
the public site immediately but never appear in the first daily digest).

It's **resumable** — quit any time (`q`) and re-run; LLM scores and your
approve/skip/edit decisions are cached on disk, and only un-imported approvals
are (re)sent to Shiori, so re-runs never double-bill the LLM or duplicate
bookmarks.

## 1. Export your bookmarks

Use the [`prinsss/twitter-web-exporter`](https://github.com/prinsss/twitter-web-exporter)
Tampermonkey userscript on your X bookmarks page and export to **JSON**. Drop the
file at:

```
apps/bootstrap/input/bookmarks.json
```

The parser is defensive about the export shape (it handles the raw v1.1 tweet
object, the GraphQL `legacy`-wrapped object, and the flattened export). If your
export looks different, share a sample record and the parser can be adjusted.

## 2. Configure secrets (local env)

The importer calls the same capture core as the live API, so it needs the same
secrets in `apps/api/.env.local` (or your shell):

- `DATABASE_URL` — Neon Postgres (Vercel Storage → rwl, or the Neon dashboard)
- `SHIORI_TOKEN` — Shiori Pro API key
- `LLM_API_KEY` — Anthropic key (for the relevance filter + "why" draft)
- `LLM_MODEL` — optional; defaults to `claude-haiku-4-5`

> Note: `vercel env pull` returns Sensitive vars (DATABASE_URL, LLM_API_KEY) empty
> — repopulate them by hand before running.

## 3. Run

```bash
pnpm --filter @rwl/bootstrap start            # uses input/bookmarks.json
pnpm --filter @rwl/bootstrap start -- path/to/other.json
```

You'll review each candidate (those scoring `relevant` with confidence ≥ 0.6):

```
[12/37]  relevant · 0.82 · agents
  https://example.com/the-article
  "tweet text that bookmarked it…"
  why: An LLM-drafted one-line note in the curator's voice.

  [a] approve   [s] skip   [e] edit note   [q] save & quit
```

On finish (or after a quit-and-resume that completes), approved items are
imported. Re-running picks up where you left off.

## Files

- `src/parse.ts` — export → normalized `ParsedItem[]` (outbound URL or tweet permalink, text, date).
- `src/filter.ts` — LLM relevance judge (`{relevant, confidence, primaryTopic, whyDraft}`) + score cache + threshold.
- `src/ingest.ts` — imports approved items via `@rwl/api` `handleCapture` (`source: "bootstrap"`, `bootstrap: true`, original date as `captured_at`).
- `src/store.ts` — crash-safe JSON store backing the score + decision caches.
- `src/index.ts` — the resumable terminal review loop (raw-mode keypress; no TUI dependency).

Caches live under `apps/bootstrap/.cache/` (gitignored); input under `apps/bootstrap/input/` (gitignored — never commit the raw export).
