-- Milestone 4: WhatsApp webhook logging + message idempotency

CREATE TABLE IF NOT EXISTS whatsapp_processed_messages (
  message_id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  phone_number_id TEXT,
  sender_phone TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_processed_workspace
  ON whatsapp_processed_messages(workspace_id, processed_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_webhook_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  phone_number_id TEXT,
  message_id TEXT,
  event_type TEXT NOT NULL DEFAULT 'message',
  direction TEXT NOT NULL DEFAULT 'inbound',
  status TEXT NOT NULL DEFAULT 'received',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_logs_workspace
  ON whatsapp_webhook_logs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_logs_status
  ON whatsapp_webhook_logs(workspace_id, status, created_at DESC);

ALTER TABLE whatsapp_processed_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_processed_messages_isolation ON whatsapp_processed_messages
  FOR ALL USING (
    workspace_id IS NULL OR workspace_id = current_setting('app.workspace_id', true)
  );

CREATE POLICY whatsapp_webhook_logs_isolation ON whatsapp_webhook_logs
  FOR ALL USING (
    workspace_id IS NULL OR workspace_id = current_setting('app.workspace_id', true)
  );
