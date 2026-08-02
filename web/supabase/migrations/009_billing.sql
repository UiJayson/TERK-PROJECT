-- Milestone 9: Billing, usage tracking, Stripe integration

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workspaces_stripe_customer ON workspaces(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_stripe_subscription ON workspaces(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS usage_logs (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  messages_sent INT NOT NULL DEFAULT 0,
  agents_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, month)
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_month ON usage_logs(month);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT UNIQUE,
  amount_cents INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL,
  invoice_pdf_url TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_workspace ON billing_invoices(workspace_id, created_at DESC);

ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_logs_isolation ON usage_logs
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY billing_invoices_isolation ON billing_invoices
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));
