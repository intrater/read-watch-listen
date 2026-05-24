---
title: "feat: Build RWL — John's curated AI publication (greenfield)"
type: feat
status: active
date: 2026-05-24
origin: docs/brainstorms/2026-05-24-rwl-requirements.md
---

# feat: Build RWL — John's curated AI publication (greenfield)

**Target repo:** [intrater/read-watch-listen](https://github.com/intrater/read-watch-listen) (currently empty). The local working directory `/Users/john.intrater/RWL` mirrors this repo. All paths in this plan are repo-relative.

---

## Overview

RWL is a curated AI link publication owned by John Intrater. It captures links via mobile/browser share sheets, stores them in Shiori (SaaS), and publishes daily digests + weekly "Weekend Reads" to three surfaces simultaneously: a private Faire Slack channel, a public email/RSS list, and a public static website. AI is an explicit co-author across all surfaces.

This plan delivers the greenfield product end-to-end across four phases. The control plane (capture API, digest cron, Slack interactivity, state) lives in a single Cloudflare Worker with KV+D1 for state. The public site is an Astro static site on Cloudflare Pages, rebuilt on each digest publish via a deploy hook. Email goes through Buttondown. Shiori is the canonical bookmark store.

---

## Problem Frame

See origin for full context. Summary:

- John shares ~3–5 AI links per week today, almost always into Faire's `#ai-design` Slack or as DMs. The push-based, manual nature suppresses his actual curation rate (the noise tax).
- RWL replaces that with an opt-in subscription model and AI-assisted authoring, with a content scope of AI broadly (filtered through a designer's taste, not "AI-for-design" specifically).
- Two audiences: Faire teammates via a Slack channel, and external readers via a public website + email + RSS. Same content; different distribution.
- The product itself doubles as a deliberate case study of AI-augmented work — "Curated by John Intrater · Assembled by Claude" attribution appears everywhere.

---

## Requirements Trace

Origin R-IDs that this plan must satisfy (full text in the origin requirements doc):

- **Capture:** R1, R2, R3, R4, R5
- **Curation gate:** R16
- **Canonical store:** R17
- **Daily digest:** R6, R7, R8, R9, R10
- **Weekend Reads:** R11, R12
- **Public website:** R13, R14, R23, R26, R27
- **Public subscription:** R22, R25
- **Bootstrap:** R15, R19, R20
- **Identity and tone:** R18, R21

**Origin actors:** A1 (John, curator-publisher), A2 (Faire Slack subscriber), A3 (Public reader), A4 (Capture client), A5 (Canonical store / Shiori), A6 (AI assistant / LLM), A7 (Publisher pipeline)

**Origin flows:** F1 (Capture), F2 (Daily digest multi-surface), F3 (Weekend Reads), F4 (Archive browse), F5 (Bootstrap), F6 (Public subscription)

**Origin acceptance examples:** AE1 (covers R1, R2, R3), AE2 (covers R6, R8), AE3 (covers R6, R7, R9, R10), AE4 (covers R16), AE5 (covers R11, R12), AE6 (covers R13, R14, R23, R27), AE7 (covers R11, R12)

---

## Scope Boundaries

Origin is Deep-product tier; preserving the three-way split.

### Deferred for later

Carried from origin:

- Multi-curator support
- "Suggest a link to John" inbox
- Comments / replies on the public website
- Per-item engagement analytics dashboard
- Cross-posting digests to LinkedIn, Twitter/X, or other social channels
- Native mobile app beyond the iOS Shortcut
- Paid / premium tiers or monetization
- AI "find me items like this" recommendation surfaces
- Notion mirror of Shiori for ambient Faire discovery

### Outside this product's identity

Carried from origin:

- A general link-sharing tool for Faire (`#ai-design` already serves that)
- A discussion forum
- A research database with rich taxonomy
- A recommendation engine
- A Faire-owned publication (RWL is John's, not Faire's)
- A general personal blog

### Deferred to Follow-Up Work

Plan-local — intentionally split out of v1:

- **Custom voice-eval harness.** Mentioned in research as best practice; v1 ships with system-prompt voice card and 3 anchor samples only. A formal eval set lands as a follow-up once 6+ weeks of real digests exist to use as golden samples.
- **Native iOS Share Extension.** v1 ships with an iOS Shortcut. The Swift extension is deferred unless real friction emerges from the Shortcut's plain-text "Ask for Input" constraint.
- **Item retraction / takedown UI.** Manual edit via Shiori web UI + a small "republish digest" trigger is acceptable for v1. A self-service retraction flow follows once frequency of need is known.

---

## Context & Research

### Relevant Code and Patterns

The target repo is empty. No internal patterns to follow. The plan is grounded in external research instead.

### Institutional Learnings

No `docs/solutions/` exists in this repo. None to carry forward.

### External References

- **Shiori** ([shiori.sh](https://www.shiori.sh)) — SaaS bookmark store. Free / $3 / $10 tiers. Pro ($10/mo) includes X bookmark sync, Notion sync, email forwarding, AI chat, PDF uploads, YouTube transcripts. Has REST API, CLI, MCP integration, browser extensions, "natural language search." Auto-fetches metadata.
- **iOS Shortcut pattern** for share-sheet POST with note prompt: `Get Contents of URL` action with manually-authored JSON Text body (workaround for the multi-value field bug). References: [Linkding gist](https://gist.github.com/andrewdolphin/a7dff49505e588d940bec55132fab8ad), [Shiori issue #284](https://github.com/go-shiori/shiori/issues/284).
- **LLM voice priming (2026)**: system-prompt voice card + 3 anchor samples > fine-tuning. Frontier models (Claude Opus 4.7, GPT-5) follow voice cards well enough that fine-tuning's marginal lift is not worth the lock-in.
- **Twitter/X bookmark export**: official archive ZIP still doesn't include bookmarks (2026); official API capped at 800. Use [`prinsss/twitter-web-exporter`](https://github.com/prinsss/twitter-web-exporter) Tampermonkey userscript for one-time bootstrap.
- **Slack approval pattern**: Block Kit `actions` block, `chat.update` (not `response_url`) for state changes, durable timer in storage (not in-memory). Idempotency on `(message_ts, action_id, user_id)`. ACK Slack within 3s.
- **Email**: Buttondown is the strongest fit for a personal AI curation newsletter at this scale — free <100 subs, $9/mo at 1K, markdown-native API, RSS-to-email and email-to-RSS first-class.
- **Static site**: Astro 5 (Content Collections + Content Layer) on Cloudflare Pages. Pagefind for full-text search. `@astrojs/rss` for RSS. Build < 30s for hundreds of items.
- **Cron / control plane**: Cloudflare Workers Cron Triggers with KV+D1 for state. Single Worker hosts: capture ingest API, Slack interactivity webhook, daily/weekly cron, durable timer for auto-ship. Static site rebuild triggered via Cloudflare Pages deploy hook (a single `curl` from the Worker).

---

## Key Technical Decisions

- **Single Cloudflare Worker control plane.** One deploy surface, one log stream, one secret store. Hosts the capture API, Slack interactivity webhook, daily/weekly cron triggers, durable approval timer, and the deploy-hook trigger. Cost: free tier. State: Cloudflare KV (small JSON blobs — pending drafts, dedupe keys) + D1 (relational — digest history, items shipped, email mapping for permalinks).
- **Astro on Cloudflare Pages.** Content Layer loader fetches from Shiori at build time; Pagefind for client-side search; Preact island for tag-chip filtering and email signup; `@astrojs/rss` for RSS. Deploy hook from the Worker rebuilds on publish.
- **Buttondown for email.** Markdown-native API, the right aesthetic for a curated AI publication, free at this scale.
- **Shiori SaaS as canonical store**, not self-hosted. Pro tier ($10/mo) likely worth it for X bookmark sync (helpful for ongoing capture flow consistency with the bootstrap) and email-forwarding-as-capture as a backup ingestion path. Confirm at U2.
- **Two-phase publish.** A digest is *persisted* canonically in D1 first, then *fanned out* via independent retry-able tasks to (Slack channel, Buttondown, deploy hook). Each surface has its own status row. Slack DM approval marks the digest as `approved` in D1; fan-out workers pick up `approved` digests and update per-surface status. This makes partial fan-out failure recoverable and makes idempotency the natural default. Resolves origin flow analyst blockers B1, B3, B13.
- **Capture durability via server-side queue.** Client (Shortcut / extension) POSTs to the Worker. Worker writes the raw capture event into D1 immediately (the truth), then asynchronously writes to Shiori with retry. If Shiori is down, the capture is not lost. The LLM "why" pre-fill is best-effort: if it fails, the share sheet shows empty input or the user's typed note and the item is saved anyway. Resolves B6, B7, B8.
- **Weekend Reads is a recap, not net-new.** It republishes the week's items grouped thematically with LLM-drafted connector prose. This matches the "Weekend Reads" branding (something to read Saturday morning) and resolves the public email cadence question downstream. Resolves B11, I15, I16.
- **Public email gets Weekend Reads only by default; daily emails opt-in.** Reduces inbox burden for casual external readers; power users can toggle. Faire Slack channel still gets dailies. Resolves the brainstorm's "public email cadence" deferred question and the flow analyst's I-band concerns about email volume.
- **iOS Shortcut + Chrome extension for capture, not native Swift v1.** Fastest to ship (no App Store), zero ongoing maintenance. Re-evaluate once Shortcut friction is real.
- **No client-side "why" pre-fill in v1.** The iOS "Ask for Input" action is plain text and synchronous; we can't show the LLM draft inline before POST. Pattern: user types a short note (or leaves blank) → POST to Worker → Worker writes capture event → LLM-drafted "why" generated server-side and applied if no user note was supplied. If the user wants to edit the AI draft later, they do it in Shiori's web UI before the next digest fires. This trades the brainstorm's "5 second edit" UX for shipping in days instead of weeks; the brainstorm's spirit (LLM helps write the note when the user didn't) is preserved.
- **Cloudflare D1 for relational state, KV for ephemeral state.** D1 schema covers: `captures`, `digests`, `digest_items`, `fan_out_status`, `subscribers`. KV holds: `pending_draft:{digest_id}` (with TTL covering the auto-ship window), idempotency markers.
- **Webhook from Shiori is not required.** The daily cron is the pacemaker; it polls Shiori for items captured since the last digest. Polling is fine at this volume (daily cadence, < 50 items/day). If Shiori adds webhooks later we can switch.
- **Bootstrap items have a synthetic `imported_at` timestamp matching their original Twitter bookmark date** (so the archive view reflects when John actually saw them), but a `bootstrap=true` flag prevents them from appearing in the first daily digest. They are visible immediately on the public site and in the archive.

---

## Open Questions

### Resolved During Planning

- **Hosting/runtime**: Cloudflare Workers + Pages + D1 + KV. Single account, one bill.
- **Static site stack**: Astro 5 with Content Layer + Pagefind + `@astrojs/rss` + Preact islands.
- **Email service**: Buttondown.
- **LLM voice approach**: System-prompt voice card + 3 anchor samples. No fine-tuning. Editor/clustering pass for Weekend Reads is a separate, cheaper LLM call.
- **iOS capture mechanism**: iOS Shortcut (`Get Contents of URL` → POST). Chrome extension on desktop. Native Swift deferred.
- **Twitter bootstrap path**: `prinsss/twitter-web-exporter` Tampermonkey userscript → local JSON → LLM AI-relevance filter → bulk POST to Shiori.
- **Slack approval mechanics**: Block Kit actions block, `chat.update`, KV-backed idempotency, D1-backed durable timer.
- **Publish atomicity**: two-phase publish (persist canonical, then async fan-out, per-surface retry).
- **Weekend Reads semantics**: recap of the week's items, thematically clustered.
- **Public email cadence**: Weekend Reads only by default; daily opt-in.
- **Tag taxonomy**: lock the origin-proposed set: Agents, Models, Tools, Research, Builders, Design, Workflow, Industry. Add/remove later as corpus grows. The LLM suggests one or two tags per item at capture; John can override.

### Deferred to Implementation

- **Exact LLM provider** (Anthropic vs OpenAI). Either works; lean Anthropic since the attribution names Claude and the brand will be visible. Decide at U5 based on per-1M-token pricing at the time of implementation.
- **Exact D1 schema details** (indexes, foreign keys, exact column types). Get the rough shape right at U1; refine when actually writing queries.
- **Domain name** for the public site. User decision. `rwl.johnintrater.com` is the fallback; `readwatchlisten.co` is the personal-brand stretch. Defer until U12.
- **Attribution wording**. Working draft: "Curated by John Intrater · Assembled by Claude". Settle when designing the digest template at U7.
- **Cloudflare Pages vs Vercel for static hosting**. Both fine; Cloudflare Pages keeps everything on one provider. Defer until U12.
- **Whether to use Buttondown's RSS-to-email vs sending broadcasts via API**. Likely API for control; defer detail to U7.
- **URL normalization rules** for capture dedupe (strip `utm_*`, `t.co` wrappers, canonical resolution). Implement a reasonable default at U2; refine when real captures show edge cases.

---

## Output Structure

```text
read-watch-listen/
├── README.md
├── package.json
├── .github/
│   └── workflows/
│       └── ci.yml
├── apps/
│   ├── worker/                  # Cloudflare Worker: control plane
│   │   ├── wrangler.toml
│   │   ├── src/
│   │   │   ├── index.ts         # entry: routes + scheduled handler
│   │   │   ├── routes/
│   │   │   │   ├── capture.ts   # POST /capture
│   │   │   │   ├── slack.ts     # POST /slack/interactivity
│   │   │   │   └── deploy.ts    # internal: trigger CF Pages deploy
│   │   │   ├── jobs/
│   │   │   │   ├── daily-digest.ts
│   │   │   │   ├── weekend-reads.ts
│   │   │   │   └── auto-ship.ts
│   │   │   ├── lib/
│   │   │   │   ├── shiori.ts    # Shiori API client
│   │   │   │   ├── llm.ts       # LLM client + voice card
│   │   │   │   ├── slack.ts     # Block Kit + chat.update
│   │   │   │   ├── buttondown.ts
│   │   │   │   ├── pages.ts     # deploy hook trigger
│   │   │   │   ├── db.ts        # D1 wrapper
│   │   │   │   └── url.ts       # URL normalization / dedupe
│   │   │   ├── prompts/
│   │   │   │   ├── voice-card.md
│   │   │   │   ├── why-assist.md
│   │   │   │   ├── classify.md
│   │   │   │   ├── digest-compose.md
│   │   │   │   └── cluster.md
│   │   │   └── types.ts
│   │   └── test/
│   │       ├── capture.test.ts
│   │       ├── daily-digest.test.ts
│   │       ├── slack.test.ts
│   │       └── fan-out.test.ts
│   ├── site/                    # Astro public site
│   │   ├── astro.config.mjs
│   │   ├── src/
│   │   │   ├── content/
│   │   │   │   ├── config.ts    # Content Layer loader (Shiori)
│   │   │   │   └── digests/     # Weekend Reads MDX
│   │   │   ├── pages/
│   │   │   │   ├── index.astro
│   │   │   │   ├── archive/
│   │   │   │   │   ├── [tag].astro
│   │   │   │   │   └── [...week].astro
│   │   │   │   ├── digests/
│   │   │   │   │   └── [slug].astro
│   │   │   │   ├── weekend-reads/
│   │   │   │   │   └── [slug].astro
│   │   │   │   ├── about.astro
│   │   │   │   └── rss.xml.ts
│   │   │   ├── components/
│   │   │   │   ├── Card.astro
│   │   │   │   ├── TagChips.tsx     # Preact island
│   │   │   │   ├── SubscribeForm.tsx  # Preact island
│   │   │   │   └── SearchBox.tsx    # Pagefind UI
│   │   │   └── layouts/
│   │   │       └── Base.astro
│   │   └── public/
│   └── bootstrap/               # Twitter archive import script
│       ├── package.json
│       └── src/
│           ├── index.ts          # CLI entry
│           ├── filter.ts         # LLM AI-relevance filter
│           └── ingest.ts         # bulk POST to Shiori
├── docs/
│   ├── brainstorms/2026-05-24-rwl-requirements.md
│   ├── plans/2026-05-24-001-feat-rwl-greenfield-build-plan.md
│   ├── runbook.md               # ops handbook (created in U14)
│   └── voice/                   # voice card + anchor samples (committed)
│       ├── voice-card.md
│       └── samples/
│           ├── sample-1.md
│           ├── sample-2.md
│           └── sample-3.md
└── ios/
    └── rwl-capture.shortcut.md  # human-readable spec of the Shortcut
```

The tree is a scope declaration. The implementer may adjust as warranted.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Daily digest pipeline (sequence)

```mermaid
sequenceDiagram
    participant Cron as Worker Cron (07:00 PT)
    participant Shiori
    participant LLM
    participant D1
    participant SlackDM as Slack DM (John)
    participant SlackCh as Slack #rwl
    participant Buttondown
    participant Pages as CF Pages

    Cron->>Shiori: GET bookmarks since last_digest
    Shiori-->>Cron: items[]
    alt items is empty
        Cron-->>Cron: skip; no fan-out
    else has items
        Cron->>LLM: compose digest (voice card + items + notes)
        LLM-->>Cron: draft markdown
        Cron->>D1: INSERT digest (status=draft)
        Cron->>SlackDM: post Block Kit DM (Ship/Edit/Skip), persist message_ts
        Note over SlackDM: 30-min auto-ship timer scheduled
        SlackDM-->>Cron: button click (or timer fires)
        alt John taps Ship or timer fires
            Cron->>D1: UPDATE digest status=approved
            par fan-out (independent, retryable)
                Cron->>SlackCh: chat.postMessage
                and
                Cron->>Buttondown: create + send broadcast
                and
                Cron->>Pages: POST deploy hook
            end
            Cron->>D1: UPDATE fan_out_status per surface
            Cron->>SlackDM: chat.update "Shipped"
        else John taps Skip
            Cron->>D1: UPDATE digest status=skipped
            Cron->>SlackDM: chat.update "Skipped"
        else John taps Edit
            Cron->>SlackDM: open modal with draft pre-filled
            SlackDM-->>Cron: edited text
            Cron->>D1: UPDATE digest body=edited
            Note over Cron: same fan-out path
        end
    end
```

### State model (D1, simplified)

```
captures(id, url, normalized_url, title, note, rwl_tag, topic_tags, source,
         captured_at, shiori_id, shiori_status, bootstrap)

digests(id, kind ['daily' | 'weekend'], composed_at, status ['draft' | 'pending'
         | 'approved' | 'skipped' | 'shipped'], body_md, body_json, slug,
         approved_at, slack_msg_ts)

digest_items(digest_id, capture_id, position, cluster_label)

fan_out_status(digest_id, surface ['slack_ch' | 'email' | 'site'],
               status ['queued' | 'success' | 'failed'], attempts, last_error,
               updated_at)

subscribers(email, subscribed_at, daily_opt_in, unsubscribed_at)
```

This sketch communicates direction. Actual columns, indexes, and types are an implementation concern.

---

## Implementation Units

The 14 units below are grouped into four phases. The launch sequence (per origin R20) is: backend stood up → capture flow working → bootstrap → dry-run digest → public site live → invite subscribers. Phases A–D mirror that sequence.

### Phase A — Foundation

- U1. **Repo scaffolding + Cloudflare Worker + D1/KV + secrets**

**Goal:** Stand up the repo, the Cloudflare Worker control plane skeleton, D1 schema, KV namespace, secret management, and CI lint/test.

**Requirements:** R17 (canonical-store dependency: needs a place to host the API client and the digest state).

**Dependencies:** None.

**Files:**
- Create: `package.json`, `README.md`, `.github/workflows/ci.yml`
- Create: `apps/worker/wrangler.toml`, `apps/worker/src/index.ts`, `apps/worker/src/lib/db.ts`, `apps/worker/src/types.ts`
- Create: `apps/worker/migrations/0001_initial.sql` (or wrangler-d1 migration files)
- Test: `apps/worker/test/db.test.ts`

**Approach:**
- pnpm monorepo with workspaces for `apps/worker`, `apps/site`, `apps/bootstrap`.
- Wrangler v3+ with Vitest for tests; TypeScript everywhere.
- Define D1 schema covering `captures`, `digests`, `digest_items`, `fan_out_status`, `subscribers`. Don't bind to a specific column list yet; the schema lands in a migration committed to the repo.
- KV namespace `RWL_STATE` for pending drafts, idempotency, and any small ephemeral state.
- Secrets via `wrangler secret put`: `SHIORI_TOKEN`, `LLM_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `BUTTONDOWN_TOKEN`, `CF_PAGES_DEPLOY_HOOK`.
- CI runs lint, typecheck, unit tests on every push.

**Patterns to follow:** No internal patterns; this is the foundation everyone else will follow. Lean on Cloudflare Workers official docs.

**Test scenarios:**
- Happy path: D1 wrapper opens, runs a `SELECT 1`, returns the result.
- Happy path: KV wrapper writes a key with TTL, reads it back, key expires after TTL.
- Edge case: SQL migration is idempotent — running it twice doesn't error.

**Verification:**
- `wrangler deploy --dry-run` succeeds.
- `pnpm test` passes locally and in CI.
- D1 migration applies cleanly to a fresh database.

---

- U2. **Shiori account + capture API + URL normalization + dedupe**

**Goal:** Sign up for Shiori (Pro tier), wire its API into the Worker, and expose the `POST /capture` endpoint that writes a capture event to D1 and forwards to Shiori with retry.

**Requirements:** R1, R5, R16, R17, AE1, AE4.

**Dependencies:** U1.

**Files:**
- Modify: `apps/worker/src/index.ts` (route registration)
- Create: `apps/worker/src/routes/capture.ts`
- Create: `apps/worker/src/lib/shiori.ts`
- Create: `apps/worker/src/lib/url.ts` (URL normalization)
- Test: `apps/worker/test/capture.test.ts`, `apps/worker/test/url.test.ts`

**Approach:**
- Sign up for Shiori Pro and capture credentials.
- `POST /capture` accepts `{ url, note?, source }` with a bearer token (a long random secret known to the iOS Shortcut and Chrome extension).
- URL normalization strips `utm_*`, `fbclid`, `t.co` wrappers (resolve once if cheap), trailing slashes, and lower-cases the host.
- Dedupe key is the normalized URL. If a capture for the same normalized URL exists, treat the second capture as an update (overwrite the note if a new one is provided) and respond 200 with `{ status: 'updated' }`.
- Write the capture row to D1 first, then call Shiori's create-bookmark API. If Shiori fails, the row is marked `shiori_status='pending'` and a background retry (next cron tick or a queue) reconciles.

**Patterns to follow:** Shiori API docs at shiori.sh; standard Workers HTTP routing.

**Test scenarios:**
- Happy path: POST a fresh URL with a note. **Covers AE1.** Capture row created with status `pending` → `synced`; Shiori receives the request.
- Edge case: POST the same URL twice with different notes. The second updates the existing capture; only one Shiori record exists.
- Edge case: URL normalization — `https://example.com/post?utm_source=x` and `https://EXAMPLE.com/post/` resolve to the same dedupe key.
- Error path: Shiori returns 500. Capture row persists with `shiori_status='pending'`; endpoint still returns 200 to the client.
- Error path: bearer token missing or wrong → 401.
- Integration: capture row in D1 matches the request payload byte-for-byte (no silent mutation).

**Verification:** A manual `curl -X POST /capture` with a real URL writes a row to D1 and creates a Shiori bookmark.

---

- U3. **iOS Shortcut + Chrome extension capture clients**

**Goal:** Two client surfaces that POST to `/capture` — an iOS Shortcut for mobile/iPad and a minimal Chrome extension for desktop.

**Requirements:** R1, R5, AE1.

**Dependencies:** U2.

**Files:**
- Create: `ios/rwl-capture.shortcut.md` (human-readable spec + assembly steps)
- Create: `apps/chrome-extension/manifest.json`, `apps/chrome-extension/popup.html`, `apps/chrome-extension/popup.js`, `apps/chrome-extension/icon.png`

**Approach:**
- **iOS Shortcut**: Share-sheet action accepting URLs. Action chain: Get Selected URL → Ask for Input (text, optional, "why this caught my eye") → Text (manually-authored JSON template) → Get Contents of URL (POST, headers include `Authorization: Bearer …`).
- **Chrome extension**: Browser-action popup with the current tab's URL pre-filled, a textarea for the note, and a Save button. POSTs to the same endpoint with the same bearer token.
- Both surfaces send `{ url, note?, source: 'ios-shortcut' | 'chrome-ext' }`.
- The Shortcut is documented as a markdown spec (action-by-action) rather than a binary file — John assembles it once in the Shortcuts app from the spec.

**Patterns to follow:** Linkding/Shiori iOS Shortcut patterns referenced in research.

**Test scenarios:**
- Test expectation: none — these are deliverables that exercise U2 manually. Functional verification is covered by U2's integration tests plus a manual end-to-end smoke test.

**Verification:**
- John assembles the Shortcut from the spec, shares a URL from Twitter on iPhone, and the capture appears in Shiori within seconds.
- The Chrome extension installs in developer mode, captures the current tab's URL with a note, and shows up in Shiori.

---

- U4. **LLM "why" assist + R/W/L auto-classification + topic tag suggestion**

**Goal:** When a capture lacks a user-supplied note, an LLM job drafts one from the URL's metadata. The same job auto-classifies R/W/L from URL type and suggests topic tags.

**Requirements:** R3, R4, R26.

**Dependencies:** U2.

**Files:**
- Create: `apps/worker/src/lib/llm.ts`
- Create: `apps/worker/src/prompts/why-assist.md`, `apps/worker/src/prompts/classify.md`
- Modify: `apps/worker/src/routes/capture.ts` (kick off the LLM job async after capture is persisted)
- Test: `apps/worker/test/llm.test.ts`, `apps/worker/test/classify.test.ts`

**Approach:**
- After `/capture` persists the row and forwards to Shiori, kick off an async background task (Workers' `event.waitUntil`) that:
  1. Fetches the canonical page title and description (from Shiori once synced, or via a lightweight `og:` fetch as backup).
  2. Calls the LLM with the `why-assist` prompt to draft a one-line note in John's voice, only if the user did not supply a note.
  3. Calls the LLM (or a separate cheap classifier) with the `classify` prompt to assign one of {Read, Watch, Listen} based on URL pattern + content type.
  4. Calls the LLM to suggest one or two topic tags from the locked taxonomy.
  5. Writes the result back to the capture row in D1.
- The LLM job is best-effort. If it fails, the row keeps `note=null`, `rwl_tag='read'` (default), `topic_tags=[]`; the next digest can fill them in or John can override in Shiori.
- The R/W/L classifier should be pattern-first (YouTube → Watch, Spotify/Apple podcasts → Listen, everything else → Read), with the LLM only resolving ambiguous cases.

**Patterns to follow:** Anthropic SDK conventions; prompt-engineering best practices from research (voice card + samples).

**Test scenarios:**
- Happy path: capture with no user note, page metadata available → row gets a non-empty LLM-drafted note.
- Happy path: YouTube URL → `rwl_tag='watch'` without LLM call.
- Happy path: Spotify episode URL → `rwl_tag='listen'`.
- Happy path: ambiguous article URL → LLM-resolved tag.
- Edge case: capture with user-supplied note → LLM does NOT overwrite the user note; classification and tags still run.
- Error path: LLM returns 5xx or times out → capture row stays in its prior state; row is marked `llm_status='failed'` for later retry.
- Edge case: LLM returns a topic tag outside the locked taxonomy → silently dropped; only tags from `['Agents','Models','Tools','Research','Builders','Design','Workflow','Industry']` are accepted.
- Integration: timer of "user-note-precedence-over-LLM-note" enforced — even if both write to the row in close succession, the user note wins.

**Verification:**
- A capture POST with no note results in a row with a non-empty, plausible note within ~30 seconds.

---

### Phase B — Publishing pipeline

- U5. **Daily digest composition (cron + voice card + clustering)**

**Goal:** A scheduled Worker job that pulls new items from Shiori since the last digest, composes a daily digest using the voice card + anchor samples, and persists it as a draft in D1.

**Requirements:** R6, R7, R8, R18, R21.

**Dependencies:** U1, U4. Voice card and anchor samples must be committed to `docs/voice/` before this unit ships.

**Execution note:** Test-first on the digest composer is worth it — voice consistency regresses silently, and a small golden-output test set catches drift early.

**Files:**
- Create: `apps/worker/src/jobs/daily-digest.ts`
- Create: `apps/worker/src/prompts/digest-compose.md`
- Create: `apps/worker/src/prompts/cluster.md`
- Create: `docs/voice/voice-card.md`, `docs/voice/samples/sample-1.md`, `docs/voice/samples/sample-2.md`, `docs/voice/samples/sample-3.md`
- Modify: `apps/worker/src/index.ts` (register scheduled handler for cron `0 14 * * *` = 7am PT)
- Modify: `apps/worker/wrangler.toml` (cron trigger)
- Test: `apps/worker/test/daily-digest.test.ts`

**Approach:**
- Cron fires daily at 7am PT (14:00 UTC; daylight saving will need a manual swap or a fixed UTC choice).
- Pull captures from D1 (or Shiori) since the last `digest_id` with `kind='daily'`, status in `('approved','shipped')`. Skip captures flagged `bootstrap=true`.
- If zero new items, mark the day as "skipped" in D1 (so we have a record) and exit. No fan-out.
- Otherwise, build the prompt: voice card + 3 anchor samples + items (URL, title, R/W/L tag, topic tags, "why" note). Request a markdown body with a natural opener, items grouped by R/W/L, the user's "why" verbatim, and the signature line.
- Use a cheaper, separate "cluster" LLM call first if there are ≥3 items, to suggest a connector sentence theme. Keep that out of the voice-prompted call.
- Persist as `digests` row with `kind='daily'`, `status='draft'`, `body_md`, `composed_at`, `slug` (date-based).

**Patterns to follow:** Voice priming pattern from research (voice card + 3 samples, no fine-tuning). Cloudflare Workers scheduled handler docs.

**Test scenarios:**
- Happy path: 3 captures from yesterday, one YouTube, two articles. Digest body contains all three items, grouped by R/W/L, signature line present.
- **Covers AE2.** Edge case: zero new captures → no digest row is created with `status='draft'`; no fan-out is scheduled.
- Edge case: one item only → digest renders without forced cluster theme.
- Edge case: ten items, all on different topics → cluster pass returns no strong theme; digest opens with a neutral opener like "Eight on AI today —".
- Error path: LLM times out → cron logs error, retries once, then leaves no draft and notifies the ops Slack DM (per U14).
- Edge case: capture row has `note=null` and `llm_status='failed'` → digest item renders with title + URL only, no "why" line, rather than blocking the whole digest.
- Integration: the digest's `body_md` references all items the digest's `digest_items` rows point to (no orphan items).
- Output discipline: digest body must include the signature attribution; tests assert its presence.

**Verification:**
- Manually trigger the cron via Wrangler. A `digests` row appears in D1 with non-empty `body_md` and `status='draft'`.

---

- U6. **Slack approval DM (Block Kit + chat.update + idempotency + durable timer)**

**Goal:** When a daily digest enters `status='draft'`, post a Block Kit DM to John with Ship/Edit/Skip controls. Handle button clicks idempotently and update the message in place. Persist a durable 30-minute auto-ship timer.

**Requirements:** R9.

**Dependencies:** U5.

**Files:**
- Modify: `apps/worker/src/jobs/daily-digest.ts` (post DM after composing)
- Create: `apps/worker/src/routes/slack.ts` (interactivity webhook)
- Create: `apps/worker/src/jobs/auto-ship.ts` (durable timer, scheduled via cron or queue)
- Create: `apps/worker/src/lib/slack.ts` (Block Kit + chat.update helpers + signature verification)
- Modify: `apps/worker/wrangler.toml` (cron trigger for auto-ship: every minute)
- Test: `apps/worker/test/slack.test.ts`, `apps/worker/test/auto-ship.test.ts`

**Approach:**
- After U5 inserts a `status='draft'` row, immediately post a DM to John (via Slack `chat.postMessage`) with a Block Kit `actions` block (Ship, Edit, Skip). Persist `slack_msg_ts` and `slack_channel_id` to D1. Mark `status='pending'`.
- KV write: `pending_draft:{digest_id}` with the digest payload (for fast lookup on interaction) and TTL = 90 minutes.
- D1 write: `auto_ship_at = now + 30min` on the digest row.
- A second Worker cron (every minute) scans for `status='pending' AND auto_ship_at <= now` and ships them. Cheap, durable, immune to Worker restarts.
- Slack interactivity webhook (`POST /slack/interactivity`):
  1. Verify Slack request signature (use `SLACK_SIGNING_SECRET`).
  2. ACK within 3 seconds (return 200, do work via `event.waitUntil`).
  3. Idempotency: dedupe on `(message_ts, action_id)` via a KV write with TTL 1h.
  4. Branch on action: `ship` → mark `approved`, kick off fan-out (U7); `skip` → mark `skipped`; `edit` → `views.open` a modal with the draft markdown in a multiline input.
  5. On modal submit (edit), update `body_md` in D1, then mark `approved`.
  6. `chat.update` the original DM to reflect final state.
- The auto-ship cron does the same as a "ship" click (mark `approved`, kick off fan-out) and `chat.update`s the DM to "Auto-shipped at HH:MM (no response)".

**Patterns to follow:** Slack approval blueprints from research (https://api.slack.com/best-practices/blueprints/approval-workflows); `chat.update` over `response_url` for state changes.

**Test scenarios:**
- **Covers AE3.** Happy path: digest enters draft → DM posted with Block Kit; John taps Ship → D1 row goes to `approved`; DM updated to "Shipped at …"; fan-out fired exactly once.
- Happy path: John taps Skip → D1 status `skipped`; DM updated; no fan-out.
- Happy path: John taps Edit → modal opens; John submits new text; D1 `body_md` updated; row goes `approved`; fan-out fired.
- Edge case: 30-min timer fires, John never responded → row `approved` via auto-ship; DM updated to "Auto-shipped"; fan-out fired exactly once.
- Edge case: John taps Ship at the exact moment the auto-ship timer fires → idempotency wins; fan-out fires once total.
- Edge case: double-tap Ship from a flaky network → second click is a no-op.
- Error path: Slack signature verification fails → 401, no state change.
- Error path: `chat.update` fails after fan-out → fan-out is not rolled back (publishing is the truth, not the DM state); error logged, retry the update once.
- Integration: digest can only be shipped once; once `status` is terminal (`approved` / `skipped` / `shipped`) further interactions are no-ops with a friendly DM update.

**Verification:**
- End-to-end: trigger a fake digest in dev, receive the DM, tap a button, see the digest's status change in D1.

---

- U7. **Multi-surface fan-out + canonical persistence**

**Goal:** When a digest is `approved`, fan out independently to (a) Faire `#rwl` Slack channel post, (b) Buttondown broadcast, (c) Cloudflare Pages deploy hook. Each surface has its own retry-able status row.

**Requirements:** R6, R10.

**Dependencies:** U6.

**Files:**
- Modify: `apps/worker/src/jobs/daily-digest.ts` (fan-out orchestrator)
- Create: `apps/worker/src/lib/buttondown.ts`
- Create: `apps/worker/src/lib/pages.ts`
- Modify: `apps/worker/src/lib/slack.ts` (channel post)
- Test: `apps/worker/test/fan-out.test.ts`

**Approach:**
- Fan-out is a single function called from U6's `ship` action and from the auto-ship cron. It writes three `fan_out_status` rows (`surface ∈ {slack_ch, email, site}`, `status='queued'`) and then attempts each in parallel using `Promise.allSettled`. Each branch updates its own status row on success/failure.
- **Slack channel post**: render the markdown body to Slack `mrkdwn` blocks, post to `#rwl`, append the signature line. Channel ID lives in env config.
- **Buttondown**: only fire for Weekend Reads by default. For daily digests, send only to subscribers with `daily_opt_in=true`. Buttondown `POST /v1/emails` with `subject`, markdown `body`, and an audience filter or tag.
- **CF Pages deploy hook**: simple `POST` to the configured deploy hook URL with `{ ref: 'main' }`. Don't block on completion.
- Failed surfaces are retried by a background sweep (the same per-minute cron used for auto-ship). After 3 attempts, the surface stays `failed`, an error notification goes to John's ops DM, and the digest's master `status` is set to `shipped_partial`.
- The Slack channel post and email subject pull from `digests.body_md` exactly as it was at the moment of approval — no further LLM calls.

**Patterns to follow:** Two-phase publish pattern (persist canonical → fan-out independently with per-surface state). Resolves origin flow analyst B1, B3, B13.

**Test scenarios:**
- Happy path: digest approved → three `fan_out_status` rows created → all three succeed → digest status `shipped`.
- Edge case: Slack channel post succeeds, Buttondown fails. Slack post not rolled back. Background sweep retries Buttondown twice; on third failure, status `shipped_partial`, ops DM fires.
- Edge case: deploy hook 502s → background sweep retries; eventually succeeds; site catches up.
- Edge case: digest fan-out called twice (race between ship click and auto-ship) → second call sees existing `fan_out_status` rows and no-ops.
- Edge case: daily digest with no `daily_opt_in` subscribers → Buttondown call is skipped (not failed); status row marked `skipped`.
- Integration: the signature line "Curated by John Intrater · Assembled by Claude" appears in all three surfaces' output (asserted in the Slack post payload, the Buttondown body, and the static-site digest page).
- Error path: deploy hook URL misconfigured → fan-out doesn't block Slack/email; site is the only surface that fails; ops DM fires.

**Verification:**
- End-to-end with stub APIs: a fan-out fires three calls, persists three status rows, and finishes with the right terminal state under each scenario.

---

- U8. **Weekend Reads cron + thematic clustering**

**Goal:** A weekly Saturday-morning job that composes a "Weekend Reads" recap — the same week's items grouped into 2–3 themes with LLM-drafted connector paragraphs. Approval and fan-out follow the same pattern as U6/U7.

**Requirements:** R11, R12, AE5.

**Dependencies:** U5, U6, U7.

**Files:**
- Create: `apps/worker/src/jobs/weekend-reads.ts`
- Modify: `apps/worker/wrangler.toml` (cron trigger for Saturday 8am PT)
- Reuse: `apps/worker/src/prompts/cluster.md` (extend if needed)
- Test: `apps/worker/test/weekend-reads.test.ts`

**Approach:**
- Cron fires Saturday at 8am PT.
- Pull all captures from the past 7 days (regardless of whether they shipped in dailies — Weekend Reads is a recap, per Key Decision).
- Run a clustering LLM call: input is the items + their notes, output is JSON `{ clusters: [{ label, item_ids[] }] }`. Cheap model, no voice.
- Run a voice-primed LLM call per cluster: input is the cluster's items + their notes, output is a 1–2 paragraph connector. Concatenate to form `body_md` along with a top-of-post "this week's lead" callout (the LLM picks one item from the clusters).
- Persist as `digests` row with `kind='weekend'`, `status='draft'`.
- DM John for approval (reusing U6's machinery, distinct visual treatment — different DM header, etc.).
- On approval, fan out to all three surfaces (reusing U7's machinery), with email going to *all* subscribers (not just `daily_opt_in`).

**Patterns to follow:** Same digest pipeline as U5/U6/U7. Separate clustering LLM call from voice-primed composer (per research).

**Test scenarios:**
- **Covers AE5.** Happy path: 6 captures across the week, 2 clear themes. Clustering returns 2 clusters; voice pass writes 2 connector paragraphs; "this week's lead" callout chosen; body_md complete.
- Edge case: zero captures all week → Weekend Reads is skipped (consistent with daily-digest skipping rule). Ops DM fires a friendly heads-up.
- Edge case: 1 item only → no clustering; renders as a single-item "this week's pick" without forced theme.
- Edge case: 20 items, weak clusters → LLM merges into ≤4 themes; body remains readable.
- Integration: Weekend Reads body always opens with the title "Weekend Reads — [date]" (asserted in fan-out output for all surfaces, per AE7).
- Edge case: Friday's daily digest publishes the same morning Weekend Reads composes — they don't collide because the two cron jobs run at different times and write to different `kind` partitions.

**Verification:**
- Manually trigger Weekend Reads in dev mode → draft DM arrives → approval → all three surfaces show the expected content.

---

### Phase C — Public website

- U9. **Astro site scaffolding + Shiori Content Layer + tag taxonomy lock**

**Goal:** Stand up the Astro 5 project with a Content Layer loader fetching items from Shiori, the locked tag taxonomy as a typed enum, and a base layout.

**Requirements:** R13, R23, R26, R27.

**Dependencies:** U2 (Shiori must be writeable so there's something to read from).

**Files:**
- Create: `apps/site/astro.config.mjs`, `apps/site/package.json`, `apps/site/tsconfig.json`
- Create: `apps/site/src/content/config.ts` (Content Layer loader)
- Create: `apps/site/src/layouts/Base.astro`
- Create: `apps/site/src/components/Card.astro`
- Create: `apps/site/src/lib/taxonomy.ts` (locked tag list as exported const)
- Test: `apps/site/test/content-loader.test.ts`

**Approach:**
- `apps/site/src/content/config.ts` defines a `curatedItems` collection using Astro's Content Layer with a custom `loader` that calls Shiori's REST API at build time. Schema validation ensures every item has `{ url, title, note?, rwlTag, topicTags[], capturedAt, slug }`. Items with invalid tags cause a build warning but don't fail the build.
- `lib/taxonomy.ts` exports the locked taxonomy: `['Agents','Models','Tools','Research','Builders','Design','Workflow','Industry']`. Used by the Content Layer schema, by the tag-chip island in U10, and by the Worker's classifier in U4.
- Base layout includes the curated.supply-style chrome: wordmark, top nav (Discover / Browse / Weekend Reads / About).

**Patterns to follow:** Astro Content Layer docs; curated.supply's layout vocabulary (clean grid, prominent subscribe, minimal chrome).

**Test scenarios:**
- Happy path: Content Layer loader fetches 50 items from Shiori → all 50 appear in the collection.
- Edge case: Shiori returns 500 → build fails fast with a clear error (don't ship a stale-or-empty site).
- Edge case: item has an invalid tag → build warning logged; item still indexed.
- Edge case: item missing required field (e.g. title) → build warning; item dropped from the collection rather than rendered broken.

**Verification:**
- `pnpm --filter site build` succeeds with a non-empty `dist/`.

---

- U10. **Homepage + tag chip filter + email subscribe form**

**Goal:** The homepage above-the-fold (per origin R27): wordmark, nav, one-liner, email subscribe form, tag chip row. Card grid of items below. Tag chips filter the grid client-side without a full page reload.

**Requirements:** R13, R14, R22, R27, AE6.

**Dependencies:** U9.

**Files:**
- Create: `apps/site/src/pages/index.astro`
- Create: `apps/site/src/components/TagChips.tsx` (Preact island)
- Create: `apps/site/src/components/SubscribeForm.tsx` (Preact island)
- Modify: `apps/site/astro.config.mjs` (add `@astrojs/preact` integration)
- Test: `apps/site/test/tag-filter.test.ts`

**Approach:**
- Homepage renders a card per item, sorted newest-first. Each card has the curated.supply visual treatment: thumbnail (if available), brand/source, title, "why" note, R/W/L indicator icon, topic tags.
- Tag chips are a Preact island. Tapping a chip filters the grid via DOM class toggling (zero JS heavy work — the grid is already rendered, the island just hides/shows cards). Active chip state is reflected in `?tag=` URL param for shareability.
- Email subscribe form: a simple `<form>` posting to `/api/subscribe` on the Worker (added inline to U7's Buttondown integration). POST succeeds → show "thanks, check your email." Failure → inline error.
- Subscribe form has a "daily updates too" checkbox; default is off (Weekend Reads only).
- Above-the-fold composition is enforced via layout — content begins immediately below the chip row.

**Patterns to follow:** curated.supply's hero composition; Astro islands for minimal hydration.

**Test scenarios:**
- **Covers AE6.** Happy path: page loads with the card grid; tapping "Agents" chip filters to items tagged Agents; URL updates to `?tag=Agents`; subscribe form submits successfully with email.
- Edge case: zero items match the selected tag → empty state shows "No items tagged X yet."
- Edge case: subscribe with an invalid email → inline validation error, no Worker call.
- Edge case: subscribe with a duplicate email → Worker responds "already subscribed"; form shows that message.
- Edge case: tap a chip then tap it again → grid returns to "all" state.
- Integration: tag chip set on the homepage matches the locked taxonomy in `lib/taxonomy.ts` — no hardcoded duplicates.

**Verification:**
- Manual: visit deployed site, filter by each tag, subscribe with a test email and verify Buttondown receives it.

---

- U11. **Archive pages + Pagefind search + Weekend Reads layout + RSS**

**Goal:** Browseable archive (`/archive/[tag]`, `/archive/[year]/[week]`), full-text search via Pagefind, distinct Weekend Reads page layout, RSS feed.

**Requirements:** R14, R23, R25, AE7.

**Dependencies:** U9, U10.

**Files:**
- Create: `apps/site/src/pages/archive/[tag].astro`
- Create: `apps/site/src/pages/archive/[...week].astro`
- Create: `apps/site/src/pages/weekend-reads/[slug].astro`
- Create: `apps/site/src/pages/digests/[slug].astro`
- Create: `apps/site/src/pages/rss.xml.ts`
- Create: `apps/site/src/components/SearchBox.tsx` (Pagefind UI wrapper)
- Modify: `apps/site/astro.config.mjs` (`astro-pagefind` integration)
- Test: `apps/site/test/archive.test.ts`

**Approach:**
- Archive pages use Astro's dynamic routing (`getStaticPaths`) to generate one page per tag, one per week.
- Pagefind runs as a post-build step (`astro-pagefind` integration) and produces a sharded index in `dist/pagefind/`. The search box is a small Preact island that loads the Pagefind UI on first interaction.
- Weekend Reads layout is visibly distinct: full-width prose block on top (the LLM-drafted body), then the cards grouped by cluster label. The page title is "Weekend Reads — [date]" matching AE7.
- Daily digest layout is similar but with a tighter intro and items grouped by R/W/L.
- RSS feed includes the last 50 digests (mix of daily and Weekend Reads) with a stable `<guid>` per digest so feed readers dedupe correctly.

**Patterns to follow:** `@astrojs/rss` recipe from Astro docs; Pagefind UI integration.

**Test scenarios:**
- Happy path: `/archive/agents` lists all items tagged Agents.
- Happy path: `/archive/2026/W22` lists all items captured during ISO week 22 of 2026.
- Happy path: search box returns results for a query that appears in a "why" note.
- **Covers AE7.** Happy path: a Weekend Reads page is titled "Weekend Reads — [date]" and renders clusters with connector paragraphs.
- Edge case: empty tag archive (no items) → friendly empty state, not a 404.
- Edge case: RSS feed validates against the W3C feed validator (no malformed XML).
- Integration: every digest's `slug` matches the URL it's permalinked at — no broken links from Slack channel posts or emails back to the site.

**Verification:**
- Manual: visit `/archive/agents`, `/archive/2026/W22`, search for a term, verify RSS at `/rss.xml`.

---

- U12. **Cloudflare Pages deploy + Worker deploy-hook integration**

**Goal:** The Astro site builds and deploys to Cloudflare Pages; the Worker's deploy-hook trigger (already wired in U7) actually rebuilds the live site.

**Requirements:** R23, R13.

**Dependencies:** U11.

**Files:**
- Modify: `apps/site/astro.config.mjs` (Cloudflare adapter if needed; static output is preferred)
- Create: `.github/workflows/deploy-site.yml` (or use Cloudflare Pages' git integration directly)
- Modify: `apps/worker/wrangler.toml` (final secret binding for `CF_PAGES_DEPLOY_HOOK`)

**Approach:**
- Configure Cloudflare Pages to deploy `apps/site/` automatically on push to `main`.
- Set up a deploy hook URL in Cloudflare Pages; store it as a Worker secret.
- Verify U7's deploy-hook trigger rebuilds the live site by manually approving a dev digest end-to-end.
- Configure the chosen domain (deferred decision: `rwl.johnintrater.com` fallback, or a separate domain). DNS via Cloudflare.
- Verify SSL, cache headers, and 404 page.

**Patterns to follow:** Cloudflare Pages deploy-hook docs.

**Test scenarios:**
- Test expectation: none — infrastructure config. Functional verification is end-to-end through the existing test coverage in U7 + U11.

**Verification:**
- A `POST` to the deploy hook URL triggers a Pages rebuild within 60s.
- The deployed site is reachable on the chosen domain with valid TLS.

---

### Phase D — Launch readiness

- U13. **Twitter bookmark bootstrap script**

**Goal:** A one-time script that ingests John's `twitter-web-exporter` JSON export, filters for AI relevance via LLM, surfaces ~50–100 candidates for bulk approval, and writes approved items to Shiori with `bootstrap=true`.

**Requirements:** R15, R19, R20, AE4.

**Dependencies:** U2 (Shiori capture API), U4 (LLM client can be reused).

**Files:**
- Create: `apps/bootstrap/package.json`, `apps/bootstrap/src/index.ts`
- Create: `apps/bootstrap/src/filter.ts`
- Create: `apps/bootstrap/src/ingest.ts`
- Create: `apps/bootstrap/README.md` (how to run, where to put the export)
- Test: `apps/bootstrap/test/filter.test.ts`, `apps/bootstrap/test/ingest.test.ts`

**Approach:**
- John runs `twitter-web-exporter` (Tampermonkey userscript) on his X bookmarks page, downloads a JSON file, places it at `apps/bootstrap/input/bookmarks.json`.
- The script:
  1. Parses the JSON.
  2. For each bookmark, extracts the outbound URL (if the tweet links to one) or treats the tweet itself as the source.
  3. Calls the LLM with a tight rubric: `{ relevant: boolean, confidence: 0-1, primary_topic: string }`. Caches scores to a local SQLite or JSON file to avoid re-calling on re-run.
  4. Surfaces all items with `confidence ≥ 0.6 AND relevant=true` to a CLI bulk-approve UI.
  5. CLI UI: paginated terminal interface (use `ink` or `prompts` library). Per-item: Show URL, tweet text, LLM-classified topic, an editable "why" note (pre-filled with a 1-line LLM draft of the tweet's hook). Keys: `a` approve / `s` skip / `e` edit note / `q` quit and resume later.
  6. Approved items are batch-POSTed to Shiori via `/capture` with `source='bootstrap'` and `bootstrap=true` flag. Original tweet date is preserved as `captured_at`.
- The script is resumable — quit anytime, re-run, picks up where it left off.

**Patterns to follow:** Research-recommended pattern (twitter-web-exporter → LLM filter → bulk approve → Shiori).

**Test scenarios:**
- Happy path: 100 bookmarks in the export, 30 LLM-classified as relevant. CLI surfaces 30; John approves 25; 25 rows appear in Shiori with `bootstrap=true`.
- Edge case: LLM filter returns relevant=true for fewer than 30 items → CLI surfaces whatever passes the threshold; explicit message if zero items pass.
- Edge case: LLM filter returns relevant=true for 800 items → CLI paginates; resume support means John can complete over multiple sessions.
- Edge case: re-running after partial approval → already-approved items don't re-prompt; LLM cache is reused (no double-billing).
- Error path: Shiori bulk write fails mid-batch → script logs which items succeeded and which didn't; re-running retries only the failed ones.
- Integration: bootstrap items are visible on the public site (R15) but do NOT appear in the first daily digest (per the `bootstrap=true` filter in U5).

**Verification:**
- Run end-to-end against a small (10-item) export; verify Shiori receives the approved items and the public site rebuild shows them.

---

- U14. **Ops observability + launch sequencing + dry-run mode**

**Goal:** Error notifications to John's Slack DM when any cron, fan-out, or capture fails. A dry-run flag that lets John run a daily digest end-to-end into a private channel for self-review before opening `#rwl`. Runbook covering the launch sequence and break-glass operations.

**Requirements:** R19, R20.

**Dependencies:** U1–U13.

**Files:**
- Create: `apps/worker/src/lib/ops.ts` (ops-DM helper)
- Modify: `apps/worker/src/jobs/daily-digest.ts`, `apps/worker/src/jobs/weekend-reads.ts`, `apps/worker/src/routes/capture.ts`, `apps/worker/src/jobs/auto-ship.ts` (wrap all external calls in ops-error capture)
- Modify: `apps/worker/wrangler.toml` (DRY_RUN_CHANNEL env)
- Create: `docs/runbook.md`
- Test: `apps/worker/test/ops.test.ts`

**Approach:**
- Add `notifyOps(error, context)` helper. Every catch block in cron jobs and routes calls it on unrecoverable failure. The helper posts a Slack DM to John's user ID with the digest ID, surface, error message, and a one-line "what to do."
- Add `DRY_RUN_CHANNEL` env var. When set, the daily digest fans out to that channel (and skips email and deploy hook) instead of `#rwl`. Lets John see end-to-end output for several days privately before announcing.
- `docs/runbook.md` documents:
  - Launch sequence (per origin R20)
  - How to set/unset `DRY_RUN_CHANNEL`
  - How to manually trigger a digest
  - How to re-run a failed fan-out
  - How to retract a published item (Shiori UI delete + manual republish)
  - Where each secret lives
  - LLM provider failover plan
- Final step of launch: switch off dry-run, post the `#rwl` announcement to Faire, share the public URL externally.

**Patterns to follow:** Standard ops-on-call-via-Slack pattern.

**Test scenarios:**
- Happy path: a cron job raises an unhandled error → `notifyOps` posts to John's DM with digest context.
- Happy path: dry-run mode set → daily digest publishes to the test channel only, email and deploy-hook skipped.
- Edge case: `notifyOps` itself fails (Slack down) → logged to console; doesn't recurse; the original error isn't masked.
- Edge case: dry-run digest is approved with one tap → goes to test channel, message says "DRY-RUN".
- Integration: every Phase B unit's error path calls `notifyOps` with at least the digest_id and surface label.

**Verification:**
- Force a failure (bad Buttondown token) → ops DM arrives within 1 minute with actionable context.
- Toggle dry-run, run a real cron tick, verify only the test channel sees output.

---

## System-Wide Impact

- **Interaction graph:** Worker is the central hub. Capture API ↔ D1/KV ↔ Shiori. Daily/weekly crons ↔ LLM ↔ Slack (DM + channel) ↔ Buttondown ↔ Pages deploy hook. The site reads from Shiori at build time only (decoupled from runtime). Every external dependency has an explicit retry-and-notify path.
- **Error propagation:** Per-surface in fan-out; per-job in cron. No silent swallow. Every unrecoverable error notifies the ops DM. Persistent failures degrade the master digest status (e.g., `shipped_partial`) rather than corrupting it.
- **State lifecycle risks:** Idempotency keys cover Slack interactivity (double-tap, network retry) and digest fan-out (race between Ship click and 30-min timer). KV TTLs prevent unbounded growth. D1 schema is append-mostly; deletes only via runbook procedures.
- **API surface parity:** The capture API contract is the same across iOS Shortcut, Chrome extension, and bootstrap script. URL normalization and dedupe rules are centralized in `lib/url.ts` so every entry point behaves identically.
- **Integration coverage:** Mocks alone won't prove the Slack approval flow or the multi-surface fan-out is correct. Integration tests use a Slack sandbox workspace, a Buttondown sandbox account, and a Cloudflare Pages preview deploy.
- **Unchanged invariants:** N/A — greenfield. Future-state invariants the plan establishes and must be preserved by later work: the publication's attribution string format, the locked tag taxonomy, the daily/Weekend cadence rhythm.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Shiori API rate limits or downtime during a digest pull | Med | High | Daily cron retries 3× with backoff; on persistent failure, ops DM and skip the day with an explicit `skipped:shiori_unavailable` row. Don't degrade silently. |
| Shiori shutdown or pricing change | Low | High | Shiori has a CLI and API + export. Daily nightly D1 backup of all capture rows (separate from Shiori) gives an offline copy of every item. If Shiori shuts down, the data survives and a swap to an alternative store is mechanical. |
| LLM voice drift or low quality | Med | Med | Voice card + 3 anchor samples locked in `docs/voice/`. Golden output test in U5. Manual review of every digest in v1 (approval flow exists for this reason). |
| Slack workspace bot install denied by Faire policy | Low | High | Verify with Faire IT before U6 ships. If denied, fall back to John's personal Slack workspace for v1; revisit Faire `#rwl` later. |
| iOS Shortcut friction high enough that John abandons capture | Med | High | Success criterion in origin: "capture feels easier than DMing." Track John's self-reported friction during the first 2 weeks. If real, prioritize a native Swift Share Extension as fast-follow. |
| Public email subscribers spike to noise levels | Low | Med | Weekend-Reads-only default for public email caps inbox to 1/week. Daily opt-in toggle is per-user. |
| Auto-ship publishes something John would have killed | Med | Med | The 30-min window favors action over over-curation. If a regrettable digest ships, the runbook covers retraction. Accept the tradeoff. |
| Static site rebuild lag breaks email permalinks | Med | Med | Fan-out fires email *after* deploy-hook is acknowledged (the hook returns fast even though the build takes longer). Cloudflare Pages serves the old version until the new build is ready — links don't 404. Acceptable. |
| LLM provider price spike | Low | Med | Cron + capture LLM costs are tiny (a few cents per digest). Even 10× growth is < $50/mo. Acceptable. |
| URL normalization is wrong → duplicate items | Med | Low | Centralized in `lib/url.ts` with test coverage. Real-world edge cases caught in U2 tests and refined as captures reveal new ones. |
| John leaves Faire → who owns the bot, channel, secrets | Low | Med | Origin Key Decision: RWL continues even if the Slack channel doesn't. All secrets live on John's personal accounts (Cloudflare, Buttondown, Shiori, GitHub). Only the bot install in Faire's workspace is Faire-dependent. |

---

## Phased Delivery

### Phase A — Foundation (U1–U4)
Stand up the capture pipeline: repo, Worker, D1/KV, Shiori, capture API + clients, LLM assist. Outcome: John can save a link from iPhone or Chrome and see it in Shiori within seconds with an LLM-drafted "why."

### Phase B — Publishing pipeline (U5–U8)
Build the daily digest composer, the Slack approval DM with durable timer, the multi-surface fan-out, and the Weekend Reads variant. Outcome: a digest composed from real captures gets DM'd to John, approved, and fans out to (eventually) Slack + email + site.

### Phase C — Public website (U9–U12)
Build and deploy the Astro public site, including the homepage, tag chip filter, archive pages, Pagefind search, RSS feed, and Cloudflare Pages deploy with the Worker's deploy-hook wired up. Outcome: the public site is live, browsable, subscribable.

### Phase D — Launch readiness (U13–U14)
Bootstrap from John's Twitter bookmark archive. Ops observability and dry-run mode. Runbook. Outcome: the corpus is non-empty, errors are visible, and the launch sequence is documented. After dry-run validation, `#rwl` opens and the public URL is shared.

---

## Documentation / Operational Notes

- **Runbook:** `docs/runbook.md` (created in U14).
- **Voice library:** `docs/voice/` — versioned, treated as source code. Changes require a PR.
- **Launch announcement copy:** out of scope for this plan; John writes the Slack announcement and the first public site About page directly.
- **Cost ceiling:** all-in monthly cost should sit under $30 for v1 (Shiori Pro $10, Buttondown free <100 subs, Cloudflare free tier, LLM ~$5–10, domain ~$1–2 amortized).

---

## Alternative Approaches Considered

- **Self-hosted Shiori instead of SaaS.** Rejected: adds ops burden for a one-person publication. The SaaS Pro tier ($10/mo) is cheap insurance.
- **Notion as the canonical store.** Rejected during brainstorming (see origin Key Decisions); reaffirmed here. Shiori is purpose-built; Notion would require glue code Brian has already written.
- **Next.js or Hugo for the public site.** Rejected during research. Astro wins on REST ingestion ergonomics, build performance for the card-grid use case, and aesthetic fit.
- **One git repo per app vs monorepo.** Rejected. pnpm workspaces keeps the worker, site, and bootstrap together; they share the tag taxonomy and capture-event type, and they ship as one product.
- **Native iOS Share Extension v1.** Rejected for v1; deferred to follow-up. The iOS Shortcut covers the "3 taps" requirement at zero ongoing maintenance cost.
- **Real-time WebSocket capture stream.** Rejected. Daily cadence makes polling fine; complexity buys nothing.
- **A dedicated approval UI in the Worker (instead of Slack DM).** Rejected. John already lives in Slack; a separate URL means another tab, breaking the "ship it in one tap" flow.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-24-rwl-requirements.md](../brainstorms/2026-05-24-rwl-requirements.md)
- **Shiori:** [shiori.sh](https://www.shiori.sh)
- **Visual reference for the public site:** [curated.supply](https://curated.supply)
- **Astro Content Layer:** https://docs.astro.build/en/guides/content-collections/
- **astro-pagefind:** https://github.com/shishkin/astro-pagefind
- **Slack approval workflow blueprints:** https://api.slack.com/best-practices/blueprints/approval-workflows
- **Cloudflare Workers Cron Triggers:** https://developers.cloudflare.com/workers/configuration/cron-triggers/
- **Twitter web exporter:** https://github.com/prinsss/twitter-web-exporter
- **Buttondown:** https://buttondown.com
