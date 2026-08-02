-- Milestone 7: Dashboard notifications (in-app bell)

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_unread
  ON notifications(workspace_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_created
  ON notifications(workspace_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_isolation ON notifications
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));
