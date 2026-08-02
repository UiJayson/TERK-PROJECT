-- M23: Marketing insights and campaigns
-- M24: Orchestrator handoff metadata (conversation_memory already supports JSONB metadata)

CREATE TABLE IF NOT EXISTS marketing_insights (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT,
  summary TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_insights_workspace
  ON marketing_insights(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_insights_type
  ON marketing_insights(workspace_id, type, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  product_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  lead_magnet JSONB,
  landing_copy JSONB,
  email_sequence JSONB,
  leads_generated INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_workspace
  ON marketing_campaigns(workspace_id, updated_at DESC);

ALTER TABLE marketing_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_insights_isolation ON marketing_insights
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY marketing_campaigns_isolation ON marketing_campaigns
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));
