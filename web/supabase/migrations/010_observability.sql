-- Milestone 10: Observability metrics + alert history

CREATE TABLE IF NOT EXISTS observability_request_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  user_id TEXT,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status INT NOT NULL,
  latency_ms INT NOT NULL,
  is_error BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obs_request_logs_created ON observability_request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_request_logs_endpoint ON observability_request_logs(endpoint, created_at DESC);

CREATE TABLE IF NOT EXISTS observability_performance_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  category TEXT NOT NULL,
  operation TEXT NOT NULL,
  duration_ms INT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obs_perf_created ON observability_performance_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_perf_category ON observability_performance_logs(category, created_at DESC);

CREATE TABLE IF NOT EXISTS observability_alerts (
  id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obs_alerts_type_created ON observability_alerts(alert_type, created_at DESC);
