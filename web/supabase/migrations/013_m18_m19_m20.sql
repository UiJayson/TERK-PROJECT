-- M18: notification deep links
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;

-- M19: Paystack billing fields
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT;

CREATE INDEX IF NOT EXISTS idx_workspaces_paystack_customer
  ON workspaces(paystack_customer_code);

-- M19: Extended monthly usage tracking
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS leads_created INT NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS appointments_booked INT NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS ai_tokens_used BIGINT NOT NULL DEFAULT 0;

-- M20: Aggregated performance metrics
CREATE TABLE IF NOT EXISTS performance_metrics (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  metric_name TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ms',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_date
  ON performance_metrics(date DESC);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_name_date
  ON performance_metrics(metric_name, date DESC);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_workspace
  ON performance_metrics(workspace_id, date DESC);

ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY performance_metrics_isolation ON performance_metrics
  FOR ALL USING (
    workspace_id IS NULL
    OR workspace_id = current_setting('app.workspace_id', true)
  );
