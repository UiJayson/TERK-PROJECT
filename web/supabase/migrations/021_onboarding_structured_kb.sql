-- Problem 3: Structured Onboarding + Two-Track Retrieval + Deployment Gate.
-- All tables workspace-scoped; app-layer isolation enforces workspace_id on
-- every query, consistent with the rest of the schema. RLS is enabled for
-- defense-in-depth (see TENANT_ISOLATION_REPORT.md).

-- ── Verified structured business data (Track 1 source of truth) ────────────

CREATE TABLE IF NOT EXISTS business_profiles (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL UNIQUE,
  business_name TEXT,
  industry      TEXT,
  support_email TEXT,
  phone         TEXT,
  timezone      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operating_hours (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  day_of_week   INT NOT NULL,               -- 0=Sunday, 6=Saturday
  open_time     TIME,
  close_time    TIME,
  is_closed     BOOLEAN NOT NULL DEFAULT FALSE,
  is_holiday    BOOLEAN NOT NULL DEFAULT FALSE,
  holiday_label TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operating_hours_ws ON operating_hours (workspace_id);

CREATE TABLE IF NOT EXISTS pricing_items (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  price             NUMERIC(12, 2),
  currency          TEXT NOT NULL DEFAULT 'USD',
  discount_percent  NUMERIC(5, 2),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pricing_items_ws ON pricing_items (workspace_id, is_active);

CREATE TABLE IF NOT EXISTS policy_records (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  policy_type    TEXT NOT NULL,             -- refund | cancellation | exchange | delivery | damage
  rule_text      TEXT NOT NULL,
  window_days    INT,                       -- e.g. refund window; NULL when not applicable
  effective_date DATE,
  version        INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policy_records_ws_type ON policy_records (workspace_id, policy_type);

CREATE TABLE IF NOT EXISTS escalation_contacts (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  role         TEXT NOT NULL,               -- manager | support | emergency
  name         TEXT,
  email        TEXT,
  phone        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_escalation_ws ON escalation_contacts (workspace_id, role);

-- ── Document ingestion ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uploaded_documents (
  id                   TEXT PRIMARY KEY,
  workspace_id         TEXT NOT NULL,
  filename             TEXT NOT NULL,
  file_type            TEXT NOT NULL,       -- pdf | docx | txt | md
  byte_size            INT,
  upload_status        TEXT NOT NULL DEFAULT 'pending',   -- pending | processing | complete | failed
  contradiction_status TEXT NOT NULL DEFAULT 'clean',     -- clean | flagged | resolved
  error_message        TEXT,
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_uploaded_documents_ws ON uploaded_documents (workspace_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id                   TEXT PRIMARY KEY,
  workspace_id         TEXT NOT NULL,
  document_id          TEXT REFERENCES uploaded_documents(id) ON DELETE CASCADE,
  chunk_index          INT NOT NULL DEFAULT 0,
  chunk_text           TEXT NOT NULL,
  category             TEXT NOT NULL,        -- pricing | policy | product_spec | troubleshooting | faq | general
  -- Embeddings stored as JSON text to avoid a hard pgvector dependency in this
  -- migration; the existing knowledge_embeddings pipeline can be pointed at
  -- these chunks separately. The retrieval Track-2 path uses text similarity
  -- fallback + score threshold when no vector index is present.
  embedding_json       TEXT,
  contradiction_flag   BOOLEAN NOT NULL DEFAULT FALSE,
  contradiction_detail TEXT,
  ingested             BOOLEAN NOT NULL DEFAULT FALSE,
  kb_version           INT NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_ws ON knowledge_chunks (workspace_id, category, ingested);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks (document_id);

-- ── Validation (staging Q&A) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS validation_questions (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  question          TEXT NOT NULL,
  category          TEXT NOT NULL,           -- refund_policy | operating_hours | pricing | escalation_contact | general
  ai_answer         TEXT,
  ai_answer_source  TEXT,                    -- structured_db | document_chunk:<filename> | fallback
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | correct | incorrect | needs_improvement
  corrected_answer  TEXT,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_validation_ws ON validation_questions (workspace_id, status);

-- ── Deployment gate ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deployment_status (
  workspace_id                  TEXT PRIMARY KEY,
  status                        TEXT NOT NULL DEFAULT 'draft',   -- draft | staging | live
  wizard_complete               BOOLEAN NOT NULL DEFAULT FALSE,
  wizard_sections_complete      TEXT[] NOT NULL DEFAULT '{}',    -- e.g. {business_info,operating_hours,pricing,policies,escalation}
  critical_categories_verified  TEXT[] NOT NULL DEFAULT '{}',    -- e.g. {refund_policy,operating_hours,pricing,escalation_contact}
  contradiction_count           INT NOT NULL DEFAULT 0,
  validation_pass_rate          NUMERIC(5, 2) NOT NULL DEFAULT 0,
  last_gate_check               TIMESTAMPTZ,
  locked_reason                 TEXT,
  went_live_at                  TIMESTAMPTZ
);

-- ── Knowledge base versions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kb_versions (
  id             SERIAL PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  version_number INT NOT NULL,
  published_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by     TEXT,
  notes          TEXT,
  UNIQUE (workspace_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_kb_versions_ws_active ON kb_versions (workspace_id, is_active);

-- Active-conversation pinning: which KB version each ongoing session started
-- against. New sessions pick the latest published version; active sessions are
-- never disrupted by a mid-flight update.
CREATE TABLE IF NOT EXISTS conversation_kb_pins (
  workspace_id   TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  kb_version     INT NOT NULL,
  pinned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, conversation_id)
);

-- RLS on all new tables (defense-in-depth; policies app-driven).
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_kb_pins ENABLE ROW LEVEL SECURITY;
