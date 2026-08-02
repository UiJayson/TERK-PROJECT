-- Milestone 2: Conversation Memory Service

CREATE TABLE IF NOT EXISTS customer_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  phone TEXT,
  email TEXT,
  name TEXT,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  lead_score INTEGER NOT NULL DEFAULT 0,
  lead_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_workspace ON customer_profiles(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_profiles_workspace_phone
  ON customer_profiles(workspace_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_profiles_workspace_email
  ON customer_profiles(workspace_id, email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_memory (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_conversation_memory_lookup
  ON conversation_memory(workspace_id, customer_id, channel, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_memory_session
  ON conversation_memory(workspace_id, session_id, timestamp DESC);

ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_profiles_isolation ON customer_profiles
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY conversation_memory_isolation ON conversation_memory
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));
