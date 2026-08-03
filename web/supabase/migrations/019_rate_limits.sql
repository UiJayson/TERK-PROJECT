-- Distributed rate limiting — replaces the per-instance in-memory counters so
-- limits hold across serverless instances and survive cold starts. Keyed by
-- "<action>:<ip>"; rows are reused via upsert and expire logically via reset_at.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits (reset_at);

-- Service role only — keyed by IP/action, carries no workspace/tenant data.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
