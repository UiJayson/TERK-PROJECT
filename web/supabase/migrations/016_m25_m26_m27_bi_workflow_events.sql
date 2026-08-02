-- M25: Business Intelligence Agent
-- M26: Workflow Engine
-- M27: Event Bus

CREATE TABLE IF NOT EXISTS competitor_data (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_data_workspace
  ON competitor_data(workspace_id, source_url, scraped_at DESC);

CREATE TABLE IF NOT EXISTS business_insights (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_insights_workspace
  ON business_insights(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_insights_type
  ON business_insights(workspace_id, type, created_at DESC);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  is_prebuilt BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_workspace
  ON workflows(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  current_step_index INT NOT NULL DEFAULT 0,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_workspace
  ON workflow_executions(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_scheduled
  ON workflow_executions(workspace_id, status, scheduled_at)
  WHERE status = 'waiting';

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_events_pending
  ON events(workspace_id, status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_events_workspace
  ON events(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_workspace
  ON dead_letter_queue(workspace_id, created_at DESC);

ALTER TABLE competitor_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dead_letter_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY competitor_data_isolation ON competitor_data
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY business_insights_isolation ON business_insights
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY workflows_isolation ON workflows
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY workflow_executions_isolation ON workflow_executions
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY events_isolation ON events
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY dead_letter_queue_isolation ON dead_letter_queue
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));
