-- RWL initial schema (U1). Postgres (Vercel Postgres / Neon). Idempotent.
--
-- RWL owns the EDITORIAL overlay + publication state here. Bookmark FACTS
-- (full title, archived page, thumbnail) live in Shiori and are joined on
-- shiori_id at build/compose time. There is intentionally NO subscribers
-- table — Buttondown is the source of truth for the email list.

-- A captured item. The act of capturing is the curation decision.
CREATE TABLE IF NOT EXISTS captures (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url             TEXT        NOT NULL,
  normalized_url  TEXT        NOT NULL UNIQUE,            -- dedupe key
  title           TEXT,                                   -- cached fallback; Shiori is canonical
  note            TEXT,                                   -- the "why this caught my eye" (editorial)
  rwl_tag         TEXT        NOT NULL DEFAULT 'read',     -- read | watch | listen
  consume_minutes INTEGER,                                -- est. time to consume; NULL if unknown
  source          TEXT        NOT NULL,                   -- ios-shortcut | chrome-ext | bootstrap
  shiori_id       TEXT,                                   -- join key to Shiori bookmark facts
  shiori_status   TEXT        NOT NULL DEFAULT 'pending', -- pending | synced | failed
  llm_status      TEXT        NOT NULL DEFAULT 'pending', -- pending | done | failed
  bootstrap       BOOLEAN     NOT NULL DEFAULT FALSE,     -- seeded at launch; excluded from first digest
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),     -- may be backdated for bootstrap items
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT captures_rwl_tag_chk       CHECK (rwl_tag IN ('read', 'watch', 'listen')),
  CONSTRAINT captures_shiori_status_chk CHECK (shiori_status IN ('pending', 'synced', 'failed')),
  CONSTRAINT captures_llm_status_chk    CHECK (llm_status IN ('pending', 'done', 'failed'))
);
CREATE INDEX IF NOT EXISTS captures_captured_at_idx   ON captures (captured_at);
CREATE INDEX IF NOT EXISTS captures_shiori_status_idx ON captures (shiori_status);

-- A composed digest (daily) or recap (weekend).
CREATE TABLE IF NOT EXISTS digests (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind             TEXT        NOT NULL,                   -- daily | weekend
  status           TEXT        NOT NULL DEFAULT 'draft',
  slug             TEXT        UNIQUE,                     -- permalink slug
  body_md          TEXT,
  body_json        JSONB,
  composed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at      TIMESTAMPTZ,
  auto_ship_at     TIMESTAMPTZ,                            -- durable 30-min auto-ship timer
  slack_msg_ts     TEXT,                                   -- approval-DM message handle
  slack_channel_id TEXT,
  CONSTRAINT digests_kind_chk   CHECK (kind IN ('daily', 'weekend')),
  CONSTRAINT digests_status_chk CHECK (status IN ('draft', 'pending', 'approved', 'skipped', 'shipped', 'shipped_partial'))
);
-- Supports the auto-ship sweep: "pending digests whose timer is due".
CREATE INDEX IF NOT EXISTS digests_status_auto_ship_idx ON digests (status, auto_ship_at);

-- Which captures belong to a digest, in order, with optional Weekend Reads cluster.
CREATE TABLE IF NOT EXISTS digest_items (
  digest_id     BIGINT  NOT NULL REFERENCES digests (id)  ON DELETE CASCADE,
  capture_id    BIGINT  NOT NULL REFERENCES captures (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  cluster_label TEXT,
  PRIMARY KEY (digest_id, capture_id)
);

-- Per-surface fan-out state. The (digest_id, surface) PK enforces the
-- review's idempotency fix: a duplicate fan-out INSERT fails rather than
-- racing a read-then-write check.
CREATE TABLE IF NOT EXISTS fan_out_status (
  digest_id  BIGINT      NOT NULL REFERENCES digests (id) ON DELETE CASCADE,
  surface    TEXT        NOT NULL,                         -- slack_ch | email | site
  status     TEXT        NOT NULL DEFAULT 'queued',
  attempts   INTEGER     NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (digest_id, surface),
  CONSTRAINT fan_out_surface_chk CHECK (surface IN ('slack_ch', 'email', 'site')),
  CONSTRAINT fan_out_status_chk  CHECK (status IN ('queued', 'success', 'failed', 'skipped'))
);

-- Small ephemeral state that the dropped Cloudflare KV used to hold: pending
-- digest drafts (fast lookup on Slack interaction) and idempotency markers.
-- expires_at gives TTL semantics; a sweep deletes rows past expiry.
CREATE TABLE IF NOT EXISTS kv_state (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kv_state_expires_at_idx ON kv_state (expires_at);
