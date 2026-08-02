-- AI Business OS — initial Supabase schema
-- Run in Supabase SQL Editor or via supabase db push

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  subscription_status TEXT NOT NULL DEFAULT 'active',
  owner_id TEXT NOT NULL,
  public_key TEXT UNIQUE NOT NULL,
  resources JSONB NOT NULL DEFAULT '{"agents":[],"knowledge":[],"conversations":[],"analytics":[],"leads":[]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  workspace_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_workspace_id ON users(workspace_id);

-- Agents (per-workspace config)
CREATE TABLE IF NOT EXISTS agents (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

-- Password resets
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id TEXT,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  agent_used TEXT,
  lead_status TEXT NOT NULL DEFAULT 'new',
  sentiment TEXT NOT NULL DEFAULT 'neutral',
  preview TEXT,
  unread BOOLEAN NOT NULL DEFAULT true,
  intent TEXT,
  routing_reason TEXT,
  customer JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id, updated_at DESC);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);

-- Leads
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  lead_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_workspace ON leads(workspace_id, updated_at DESC);

-- Knowledge items (entries + shared markdown files)
CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'entry',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_workspace ON knowledge_items(workspace_id, type);

-- Business profiles
CREATE TABLE IF NOT EXISTS business_profiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT UNIQUE NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Channel configs (WhatsApp / Instagram)
CREATE TABLE IF NOT EXISTS channel_configs (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  whatsapp JSONB,
  instagram JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Channel sessions (WhatsApp / Instagram sender state)
CREATE TABLE IF NOT EXISTS channel_sessions (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  sender_key TEXT NOT NULL,
  session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, channel, sender_key)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_shared_file ON knowledge_items(workspace_id, title) WHERE type = 'shared_file';

-- Row Level Security (defense in depth; service role bypasses RLS)
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_sessions ENABLE ROW LEVEL SECURITY;

-- Policies filter by workspace_id (for future direct client access)
CREATE POLICY workspaces_isolation ON workspaces
  FOR ALL USING (id = current_setting('app.workspace_id', true));

CREATE POLICY users_isolation ON users
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY agents_isolation ON agents
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY conversations_isolation ON conversations
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY messages_isolation ON messages
  FOR ALL USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE workspace_id = current_setting('app.workspace_id', true)
    )
  );

CREATE POLICY leads_isolation ON leads
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY knowledge_items_isolation ON knowledge_items
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY business_profiles_isolation ON business_profiles
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY channel_configs_isolation ON channel_configs
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY channel_sessions_isolation ON channel_sessions
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

CREATE POLICY password_resets_isolation ON password_resets
  FOR ALL USING (
    user_id IN (
      SELECT id FROM users
      WHERE workspace_id = current_setting('app.workspace_id', true)
    )
  );
