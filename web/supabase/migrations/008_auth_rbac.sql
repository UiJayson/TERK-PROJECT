-- Milestone 8: RBAC + session invalidation

CREATE TABLE IF NOT EXISTS workspace_users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_users_user ON workspace_users(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_users_workspace ON workspace_users(workspace_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;

-- Backfill membership from existing users
INSERT INTO workspace_users (id, workspace_id, user_id, role)
SELECT
  'wu_' || u.id,
  u.workspace_id,
  u.id,
  CASE
    WHEN w.owner_id = u.id THEN 'owner'
    WHEN u.role IN ('owner', 'admin', 'staff') THEN u.role
    ELSE 'owner'
  END
FROM users u
JOIN workspaces w ON w.id = u.workspace_id
ON CONFLICT (workspace_id, user_id) DO NOTHING;

ALTER TABLE workspace_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_users_isolation ON workspace_users
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));
