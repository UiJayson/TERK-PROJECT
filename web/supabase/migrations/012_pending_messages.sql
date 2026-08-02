-- M15: WhatsApp pending message queue for failed sends

CREATE TABLE IF NOT EXISTS pending_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  to_phone TEXT NOT NULL,
  message_text TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_messages_workspace
  ON pending_messages(workspace_id, created_at DESC);

ALTER TABLE pending_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_messages_isolation ON pending_messages
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));
