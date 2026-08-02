-- Stripe webhook idempotency — prevents duplicate processing on retries.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
  ON stripe_webhook_events (processed_at DESC);

-- Service role only — webhooks run outside workspace RLS context.
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
