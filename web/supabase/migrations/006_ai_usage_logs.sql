-- Milestone 6: AI provider usage / token tracking

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'chat',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_workspace
  ON ai_usage_logs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_provider
  ON ai_usage_logs(workspace_id, provider, created_at DESC);

ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_usage_logs_isolation ON ai_usage_logs
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));
