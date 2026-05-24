---
date: 2026-05-24
topic: rwl-curated-ai-feed
---

# RWL — John's Curated Read / Watch / Listen Publication

## Problem Frame

John regularly comes across podcasts, articles, videos, and threads about AI — how the technology is evolving, how people are building with it, how it's reshaping work and craft. Many of these are design-relevant because that's his lens, but the scope is **AI broadly**, not "AI for designers." Topics span agents, model releases, new tools, research breakthroughs, how companies are building with AI, workflow shifts, and industry/strategy. He shares ~3–5 of them per week today — into Faire's `#ai-design` Slack or as one-off DMs to specific people. The current behavior is push-based and manual, so John self-censors to avoid noise: the actual rate of valuable content he encounters is meaningfully higher than what gets shared. People who'd want this signal either miss it (they're not in his DM list) or get it in a low-density, ephemeral form (it scrolls past in a channel and dies).

**RWL ("Read, Watch, Listen") is John Intrater's curated AI publication**, assembled with AI co-authorship. It is a personal publication that John runs — Faire is its most important distribution channel, but not its only one and not the boundary of the audience. The content is AI broadly, filtered through a designer's curatorial taste; it is not an "AI for design" niche newsletter.

There are two audiences and two corresponding subscriber surfaces:

1. **Faire Slack subscribers** — Faire teammates who join `#rwl` by choice. The highest-engagement surface and where John most directly benefits the design org.
2. **Public web/email/RSS readers** — anyone on the internet who finds the public RWL site or subscribes via email or RSS. They get the same content; they just don't see the internal Slack channel.

Both audiences also have access to a browsable archive at the public website.

The product itself doubles as a deliberate case study of AI-augmented work — that's part of the point, and it remains true whether the reader is internal or external.

Why it matters: as Faire's design org (and engineering, product, and broader builder population) leans further into AI-native ways of working, RWL gives them a *trusted, curated, in-band* signal — turning John's existing taste into a low-effort, high-density artifact. The Faire audience isn't just designers; anyone at Faire curious about where AI is going can subscribe. And because the same artifact is public, RWL also builds John's external presence as a design-leader-with-AI-fluency, with zero marginal effort: he curates once, it flows everywhere.

---

## Actors

**People**

- A1. **John (curator-publisher):** Captures links, writes a one-line "why this caught my eye," approves AI-drafted digest copy. Owns the brand and voice; this is his publication.
- A2. **Faire Slack subscriber:** Joins `#rwl` channel by choice. Reads daily digest in Slack, may click through to the public website to browse the archive, may engage in-thread.
- A3. **Public reader:** Anyone on the internet. Discovers RWL via the public website, subscribes via email or RSS, or simply browses the archive.

**Systems**

- A4. **Capture client (mobile share sheet + browser extension):** Surfaces "Save to RWL" as a share target, prompts for a "why," writes to the canonical store.
- A5. **Canonical store (Shiori):** Brian Lovin's purpose-built bookmark service. Single source of truth. Stores URL, title (auto-fetched), capture timestamp, "why" note, R/W/L tag, optional topic tags, source-of-capture metadata. Exposes a CLI and HTTP API.
- A6. **AI assistant (LLM):** Auto-classifies R/W/L, drafts the "why" suggestion at capture time, composes daily and Friday digest copy in John's voice, generates monthly thematic synthesis.
- A7. **Publisher pipeline:** A scheduled job set that, for each digest cycle, pulls new items from Shiori, runs them through A6, requests John's approval, and fans the published artifact out to Slack, email, and the public website (static rebuild).

---

## Key Flows

- F1. **Capture (mobile/browser)**
  - **Trigger:** John finds a link in the wild (Twitter, podcast app, YouTube, article).
  - **Actors:** A1, A4, A5, A6
  - **Steps:**
    1. John taps Share → "Save to RWL."
    2. Capture client fetches page/video metadata and asks A6 for a draft "why this caught my eye" based on the content.
    3. John sees the URL + pre-filled draft one-liner; edits in ~5 seconds or accepts.
    4. Item is written to A5 (Shiori) via its API with note, timestamp, auto-classified R/W/L tag, and source metadata. Shiori handles title fetching, archiving, and any other URL-side enrichment.
  - **Outcome:** Item is queued for the next daily digest. John spent <15 seconds.
  - **Covered by:** R1, R2, R3, R4, R5, R17

- F2. **Daily digest (morning publish, multi-surface)**
  - **Trigger:** Scheduled cron at a fixed morning time (e.g., 9am PT). Skip if no new items since the previous digest.
  - **Actors:** A1, A6, A7, A2, A3
  - **Steps:**
    1. A7 pulls bookmarks added to Shiori since the previous digest.
    2. A6 drafts digest copy: natural opening line, items grouped by R/W/L, John's "why" notes preserved verbatim, an LLM-written connector sentence where there's a thread across items.
    3. A7 DMs John the draft with one-tap "ship it" / "edit" / "skip today" controls. If no response within 30 min, ship as-is.
    4. On ship, the digest fans out simultaneously to: (a) post to `#rwl` Slack channel for A2, (b) email blast to public subscribers for A3, (c) trigger a static rebuild of the public RWL website so the new digest is the homepage and RSS feed updates.
  - **Outcome:** A single composed post lands across all surfaces. No "no items today" placeholder ever.
  - **Covered by:** R6, R7, R8, R9, R10, R21, R22

- F3. **Friday weekly recap (multi-surface)**
  - **Trigger:** Scheduled Friday morning.
  - **Actors:** A6, A7, A1, A2, A3
  - **Steps:**
    1. A6 reads the week's items from Shiori, identifies thematic clusters, drafts a 2–3 paragraph recap in John's voice.
    2. John approves or edits.
    3. Recap publishes across the same surfaces as the daily digest (Slack thread, email, static site update).
  - **Outcome:** A more substantive, forward-able artifact lands at the end of each week, with the public version being especially shareable externally.
  - **Covered by:** R11, R12

- F4. **Archive browse / search**
  - **Trigger:** A reader wants to find something John shared weeks ago or browse a topic.
  - **Actors:** A2, A3, A5
  - **Steps:**
    1. Reader visits the public website (`rwl.[domain]`, no auth) or pulls from the RSS feed.
    2. On the site, they browse by R/W/L, by week/month, by topic tag, or full-text search across titles and "why" notes.
    3. The site is statically generated from Shiori's API on each digest publish (and on a periodic interval as a safety net).
  - **Outcome:** The corpus is durable, rediscoverable, and accessible to both audiences through the same public surface.
  - **Covered by:** R13, R14, R23

- F5. **Bootstrap (one-time, at launch)**
  - **Trigger:** Initial RWL launch.
  - **Actors:** A1, A5, A6
  - **Steps:**
    1. John exports his existing Twitter bookmark archive.
    2. A6 filters/scores for AI-relevance, surfaces ~50–100 candidates.
    3. John bulk-approves a seed set, optionally writing "why" notes on the strongest ones.
    4. Approved items are written into Shiori.
  - **Outcome:** RWL launches non-empty: subscribers see immediate value on day 1.
  - **Covered by:** R15, R19, R20

- F6. **Public subscription**
  - **Trigger:** A public reader visits the website and wants ongoing delivery.
  - **Actors:** A3, A7
  - **Steps:**
    1. Reader enters their email on the public site's signup form (or copies the RSS URL into a reader).
    2. They are added to the email list maintained by A7.
    3. They receive the same daily/Friday digests A2 sees in Slack — same copy, same cadence.
  - **Outcome:** Public readers have an ongoing subscription channel; RWL grows beyond Faire without John doing anything extra.
  - **Covered by:** R22, R23

---

## Requirements

**Capture**

- R1. A user (John) can save any URL into RWL via the iOS share sheet and a Chrome browser extension. The action takes no more than three taps end-to-end on a good day.
- R2. Every captured item carries a free-text "why this caught my eye" note (optional but strongly encouraged via prompt). The note is preserved verbatim through the publication pipeline.
- R3. When the user invokes capture, an AI assistant pre-fills a draft "why" based on the page/video content. The user can accept, edit, or replace it.
- R4. Items are auto-classified as Read / Watch / Listen based on URL/content type. The user can override the classification.
- R5. Capture works for at least: standard web articles, YouTube videos, Twitter/X posts, podcast episode pages (Spotify, Apple, Overcast).

**Curation gate**

- R16. The act of capturing into RWL *is* the curation decision. There is no separate "promote to RWL" review step. Personal-only bookmarking remains in Twitter or other tools the user already uses, unmodified.

**Canonical store**

- R17. **Items are stored in Shiori** (Brian Lovin's bookmarking service), which is the single source of truth for RWL. All downstream surfaces (Slack, email, public website, RSS) read from Shiori's API. The store holds: URL, title (auto-fetched), capture timestamp, "why" note, R/W/L tag, optional topic tags, source-of-capture metadata.

**Daily digest**

- R6. A daily digest publishes to all subscriber surfaces (Faire Slack `#rwl`, public email list, public website homepage, RSS feed) at a fixed morning time. Faire subscribers self-select by joining the Slack channel; public subscribers self-select by signing up via the website.
- R7. The digest is composed by an LLM from the day's bookmarks and notes, in John's voice. It is not a templated dump.
- R8. The digest skips days where no new items were captured. It does not post empty to any surface.
- R9. John receives a Slack DM with the draft digest and one-tap "ship / edit / skip today" controls. With no response after 30 minutes, the draft auto-ships across all surfaces.
- R10. Every published digest is attributed: "curated by John Intrater, assembled by Claude" (or equivalent signature making the AI co-author role explicit). Attribution is consistent across all surfaces.

**Weekend Reads (weekly recap)**

- R11. A weekly post titled **"Weekend Reads"** publishes Friday or Saturday morning, groups the week's items into thematic clusters, and includes 2–3 paragraphs of LLM-drafted commentary in John's voice. John approves before publish. The recap fans out to all surfaces.
- R12. Weekend Reads formatting is visibly distinct from daily digests: longer-form on the website (its own page), threaded on Slack, branded as "Weekend Reads" in the email subject line. The name signals the consumption mode (something to read on Saturday morning, not a midweek skim).

**Public website**

- R13. RWL has a **public website** on a domain John owns (e.g., `rwl.johnintrater.com` or a dedicated RWL domain). The site is open — **no SSO, no Faire-auth gate** — and anyone on the internet can read it. **Visual reference:** [curated.supply](https://curated.supply) — clean card grid, prominent email subscribe above the fold, category chips for filtering, minimal chrome, items as the homepage (not a manifesto).
- R14. The public site's primary navigation is a row of **tag chips** (the topic taxonomy — see R26), the way curated.supply uses Tech / Workspace / Home / Carry. Readers filter by tag in one click. R/W/L is a secondary filter or a visual indicator on each card, not the primary axis. Full-text search across titles and "why" notes is also available. The latest digest is the homepage.
- R23. The public site is **statically generated** from Shiori (rebuild triggered on each digest publish, plus a periodic safety-net rebuild). This decouples public read traffic from any backend rate limits.
- R26. RWL has a **topic tag taxonomy** of roughly 6–10 tags that becomes the primary filtering vocabulary on the public site and is also applied to items in Shiori. The taxonomy must reflect that RWL covers **AI broadly**, not AI-for-design specifically. Probable starting set: *Agents*, *Models*, *Tools*, *Research*, *Builders*, *Design*, *Workflow*, *Industry*. ("Design" is one tag among many, not the through-line.) The taxonomy can evolve, but stays bounded — never more than ~10 chips visible at once.
- R27. The homepage above-the-fold contains: the RWL wordmark/logo, the top nav (Discover / Browse / Weekend Reads / About), a "What is RWL" one-liner, an email subscribe field, and the tag chip row. Items begin immediately below. Reader can subscribe or filter without scrolling.

**Public subscription (email + RSS)**

- R22. The public website offers email subscription via a simple signup form. Subscribers receive the daily and Friday digests by email at the same cadence and with the same content as Slack subscribers.
- R25. The public website exposes a standard RSS feed of digests for power users who prefer feed readers.

**Bootstrap**

- R15. The launch ships with a non-empty corpus seeded from John's existing Twitter bookmark archive. Seeding is a one-time bulk-approval workflow, not an ongoing sync.
- R19. Bootstrap **must complete before any subscribers are invited to any surface**. The first time anyone joins `#rwl` or visits the public site, there must already be meaningful content. The "empty room" failure mode — subscribers arrive, see nothing, lose interest — is explicitly out of bounds.
- R20. Bootstrap is milestone-gated. The launch order is: (1) Shiori stood up → (2) capture flow working → (3) Twitter archive imported and curated → (4) at least one daily digest dry-run published privately for John's own review → (5) public site live with archive browsable → (6) `#rwl` channel announced, public site URL shared.

**Identity and tone**

- R18. AI's role in RWL is explicit and celebrated, not hidden. Every published digest and the public site itself acknowledge AI as co-author. Periodic (e.g., monthly) "how RWL is built" posts make the meta-story part of the product.
- R21. RWL is positioned as John Intrater's personal curated publication. Branding and attribution reflect this. Faire is named as the primary internal audience but is not the publisher.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given John is on his phone reading a tweet about Claude's new memory feature, when he taps Share → "Save to RWL," then he sees a prompt with a pre-filled draft "why" sentence, he edits it to "the memory cross-session thing is going to change how agents feel — pay attention," and one tap saves it. Total elapsed time: under 15 seconds. The item appears in Shiori within seconds.

- AE2. **Covers R6, R8.** Given John captured zero items between 9am Tuesday and 9am Wednesday, when the daily digest job runs Wednesday morning, then nothing posts to `#rwl`, no email is sent to public subscribers, and the public site homepage continues to show the previous digest. No "no items today" placeholder is sent to any surface.

- AE3. **Covers R6, R7, R9, R10.** Given John captured three items yesterday — one YouTube video, two articles, all loosely about agent UX — when the digest job runs this morning, then the LLM-drafted post opens with a natural sentence like "Three on agent UX today —" rather than a templated header, groups items into Watch/Read sections, ends with the "curated by John Intrater, assembled by Claude" attribution, and is sent to John as a DM with ship/edit/skip buttons before posting to Slack, email, and the website together.

- AE4. **Covers R16.** Given John bookmarks a recipe tweet on Twitter for himself, when nothing further happens, then the recipe does not appear in RWL. Capture flow is the only ingestion path; Twitter bookmarks are not auto-synced after the launch bootstrap.

- AE5. **Covers R11, R12.** Given the week included two podcast episodes and four articles spanning agent reliability and design tooling, when the Friday recap job runs, then John sees a draft thread that groups the items into two clusters with a connector paragraph each, calls out a "this week's lead" item, and waits for his approval before publishing to all surfaces.

- AE6. **Covers R13, R14, R23, R27.** Given a public reader (no Faire affiliation) finds `rwl.johnintrater.com` via Twitter, when they open the site, then they see the latest items as a card grid below an email subscribe field and tag chip row (curated.supply-style layout), with no login wall. They tap a tag chip (e.g., "Agents") and the grid filters in place. They can become a subscriber by typing their email and tapping subscribe — no account creation required.

- AE7. **Covers R11, R12.** Given the week's items are ready for Saturday morning, when the Weekend Reads job runs, then the published post is titled "Weekend Reads — [date]" across all surfaces, formatted longer-form on the website with its own page, sent as an email with subject "Weekend Reads: [theme of the week]," and threaded on Slack with the daily-digest visual treatment but expanded.

---

## Success Criteria

- **Curation rate doubles or more.** John publishes ≥7 items/week on average within 6 weeks of launch (up from ~3–5/week today), because the noise tax has been replaced by opt-in audiences and AI-assisted authoring.
- **Faire audience self-selects to a meaningful size.** `#rwl` channel has ≥30 voluntary subscribers within the first month, with stable or growing membership thereafter.
- **Public audience grows organically.** ≥50 public email or RSS subscribers within 3 months without paid promotion. The product is shareable — Faire subscribers share RWL links with people outside the company.
- **The digest is read, not skipped.** Slack reactions/replies on daily digests average ≥3 per post within 8 weeks; Friday recaps are visibly higher-engagement.
- **The tool stops being a chore.** John self-reports that capturing a link feels easier than DMing it. If capture is harder than the alternative, the product has failed regardless of subscriber numbers.
- **Handoff quality:** a downstream implementer can read this document and the resulting plan, and not need to ask John to invent product behavior, scope boundaries, or audience definition.

---

## Scope Boundaries

### Deferred for later

- Multi-curator support (anyone else contributing). v1 is single-curator.
- A "suggest a link to John" inbox for teammates or public readers to submit content.
- Comments / replies / discussion features on the public website. Slack threading handles internal discussion; the public site is read-only in v1.
- Analytics dashboard showing per-item engagement.
- Cross-posting digests to LinkedIn, Twitter/X, or other social channels (could be added later without changing the product shape).
- Mobile-native RWL app beyond the iOS share sheet integration.
- Paid/premium tiers, sponsorships, or any monetization. RWL is free across all surfaces in v1.
- AI-powered "find me items like this" recommendation surfaces.
- A Notion mirror of the Shiori corpus for ambient Faire discovery (rejected for v1 because it adds sync complexity for a nice-to-have).

### Outside this product's identity

- A general-purpose link-sharing tool for Faire. RWL is *curated and opinionated*; an "anyone can post AI links" board is a different product (and `#ai-design` already exists for that).
- A discussion forum or community space. RWL is a feed, not a chat surface. Threading in Slack is fine; building forum semantics is not.
- A research database / structured knowledge base with rich taxonomy. RWL is intentionally lightweight: a curator's bookmarks with notes, not a librarian's catalogue.
- A recommendation engine. The value is John's taste, not algorithmic similarity.
- A Faire-owned publication. RWL is John's personal publication that happens to serve Faire as its highest-priority audience. If John ever leaves Faire, RWL continues; the Slack channel might not, but the publication does.
- A general personal blog. RWL is specifically a curated link feed in the read/watch/listen format. John can write essays elsewhere; RWL is not the place for original long-form writing (beyond the LLM-drafted digest connector text).

---

## Key Decisions

- **RWL is John's personal publication, not a Faire product.** Faire is the highest-priority audience and gets a dedicated Slack distribution surface, but Faire does not own RWL. John does.
- **Two surfaces, one canonical store.** Shiori holds the truth; Slack and the public website (with email + RSS attached) are views generated from Shiori. This keeps publishing one-shot for John while reaching multiple audiences.
- **Shiori as the canonical store, not a rolled-our-own database.** Shiori is purpose-built for exactly this — URL ingestion, metadata fetching, archiving, tagging, search, API — so using it saves us from re-implementing what Brian already shipped. Notion was considered and rejected: it would require glue code Shiori already wrote, and the "Faire teammates browse in Notion" benefit is a nice-to-have, not load-bearing.
- **Public website on a John-owned domain, no SSO.** Content is public links + brief commentary — nothing confidential. SSO would add friction and signal "Faire-internal" when the publication is meant to live beyond Faire.
- **Static-generated public site, not live reads from Shiori.** Decouples public traffic from any backend rate limits. Rebuilds trigger on each digest publish.
- **curated.supply as the visual North Star.** Clean card grid, prominent email subscribe above the fold, tag chips as primary navigation. The grid is the homepage; the manifesto is on /About. RWL inherits this aesthetic vocabulary so the site reads as a curated publication, not a personal blog.
- **"Weekend Reads" is the weekly post's name across all surfaces.** It signals the consumption mode (something to read on Saturday morning) and gives the publication a recurring branded ritual.
- **Opt-in via channel join (Faire) or email/RSS signup (public).** The friction of choosing a surface is the entire subscription mechanic. No central account system.
- **Daily digest + Friday recap, not real-time push.** Real-time posts re-introduce the noise tax that suppresses curation today. Async batching is the unlock and applies equally across all surfaces.
- **The act of capturing is the curation decision.** No separate review/promote step. Twitter bookmarks remain personal; share-sheet to RWL is the explicit "this belongs in RWL" action.
- **AI as explicit, celebrated co-author.** Each digest is attributed; the meta-story is part of the product. Consistent across all surfaces — public readers see the same AI attribution Faire readers do.
- **Bootstrap from Twitter archive on launch only.** Avoids the polluting problem of auto-syncing personal bookmarks, but solves the empty-room problem on day 1.
- **Launch is sequenced, not flipped.** Shiori → capture → bootstrap → dry-run digest → public site → invite subscribers. Never invite an audience to a non-functioning surface.
- **R/W/L taxonomy stays.** Meaningful (different modalities, different consumption contexts), memorable name, cheap to maintain via auto-classification.

---

## Dependencies / Assumptions

- Shiori is available to John under a deployment model he can use (hosted by Brian, self-hosted, or otherwise). *Unverified — Brian's Shiori product specifics need a quick check at https://www.shiori.sh during planning. Whether it's hosted SaaS, self-host, or both shapes a few infra decisions.*
- A `#rwl` Slack channel can be created and a Slack bot installed under Faire's workspace policies. *Unverified — Faire's Slack app install policy not checked in this brainstorm.*
- A domain (e.g., `rwl.johnintrater.com` or a dedicated RWL domain) can be registered and pointed at a static-site host (Vercel, Netlify, Cloudflare Pages). *Reasonable, no blockers expected.*
- An email service for the public subscription list exists or can be set up (Buttondown, Resend, MailerLite, etc.). *Many viable options; a planning decision.*
- An LLM provider (Anthropic / OpenAI / equivalent) is reachable with budget for ~$5–20/month of digest composition. *Assumption — budget is John's personal call since this is his publication.*
- iOS share sheet supports a custom action via a Shortcut or a tiny native app wrapper around Shiori's API or CLI. *Plausible given Shiori has a published API and CLI; needs validation in planning.*
- John's Twitter bookmark archive is exportable as a usable dataset. *Twitter's data export does include bookmarks per their account export, but the format may need normalization.*
- The product remains valuable through near-term shifts in the AI landscape. The bet is that "trusted curator with good taste" outlasts the topical AI moment — if AI saturation drops, RWL can pivot topic while keeping the curatorial format.
- Hosting a personal publication that primarily distributes inside Faire is acceptable under any Faire employment/IP terms. *John should sanity-check this. Content is curated public links so the risk is low, but the framing as "personal publication" rather than "Faire artifact" should be intentional.*

---

## Outstanding Questions

### Resolve Before Planning

- None blocking. Product shape is sufficiently resolved for `/ce-plan` to take it forward.

### Deferred to Planning

- [Affects R17][Technical/User decision] Shiori deployment: hosted SaaS, self-hosted, or other? Check shiori.sh for current options. Affects where capture writes go and where the digest publisher reads from.
- [Affects R13, R23][Technical] Static site stack: Astro, Next.js + ISR, 11ty, or something simpler? Constraint: rebuilds must trigger on each digest publish and complete in seconds.
- [Affects R22][Technical] Email service choice: Buttondown, Resend, MailerLite, or other? Trade-off is cost, ease of integration, and how much "John's personal brand" identity it lets through.
- [Affects R1, R5][Needs research] iOS share sheet implementation: native Shortcut + URL scheme calling Shiori's API, a thin SwiftUI wrapper app, or use Brian's @shiori-sh/cli somehow? The "three taps" requirement constrains this.
- [Affects R7, R11][Needs research] LLM voice training: few-shot John's prior `#ai-design` posts, system-prompt persona, or finetune? "In John's voice" is real but defining "his voice" is a planning-phase exercise.
- [Affects R6, R8][Technical] Where does the digest cron job run? Cloudflare Workers, Vercel cron, GitHub Actions on schedule, or a tiny always-on worker? It needs to write to Slack, send email, and trigger a static rebuild.
- [Affects R18, R21][User decision] Exact attribution wording on each digest ("curated by John Intrater, assembled by Claude" is a draft). Settle when designing the digest template.
- [Affects R15, R19, R20][Technical] Twitter archive ingestion: how do we pull John's archive? Twitter's official data export (ZIP of JSON), a scraper, or a third-party tool. Then: LLM-score for AI-relevance vs. bulk-tap-approve. The chosen path must be deliverable as a milestone *before* any subscriber invites.
- [Affects R13, R22][Needs research] Domain name and brand identity for the public site: `rwl.johnintrater.com`, a standalone `readwatchlisten.co` or similar, or something else? Affects R21's positioning.
- [Affects R26][User decision] Topic tag taxonomy: lock the initial 6–10 tags before the public site ships. Proposed starting set is *Agents / Models / Tools / Research / Builders / Design / Workflow / Industry* — broad enough to cover AI generally, with Design as one tag among many rather than the through-line. John picks the final list; can add/remove later as the corpus grows.
- [Affects R6, R22][User decision] Public email cadence: does the email list receive both daily digests and Weekend Reads, or only Weekend Reads? Daily emails may be too noisy for an external newsletter audience even if Slack's `#rwl` channel happily takes them. One option: Weekly-only by default for email, with an "all updates" toggle for power readers.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
