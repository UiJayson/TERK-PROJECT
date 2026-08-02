-- Milestone: performance hardening for 1000+ concurrent workspaces.
--
-- Audit of existing coverage (001..016) before this migration:
--   conversations(workspace_id, updated_at DESC)          -> idx_conversations_workspace (001)
--   messages(conversation_id, timestamp)                  -> idx_messages_conversation (001)
--   leads(workspace_id, updated_at DESC)                  -> idx_leads_workspace (001)
--   knowledge_items(workspace_id, type)                   -> idx_knowledge_workspace (001)
--   customer_profiles(workspace_id [+phone/email unique]) -> 002
--   conversation_memory(workspace_id, customer_id, channel, timestamp DESC) -> 002
-- This migration only adds what production query patterns still miss.
--
-- NOTE: Supabase SQL Editor runs migrations inside a transaction, so plain
-- CREATE INDEX is used. On a table that is already large in production,
-- run each statement manually with CREATE INDEX CONCURRENTLY instead
-- (outside a transaction) to avoid holding a write lock during the build.

-- ---------------------------------------------------------------------------
-- messages: add workspace_id so per-tenant queries and the RLS policy stop
-- going through a conversations subquery. Backfilled from conversations;
-- application code now writes it on insert (see db.ts saveMessage).
-- ---------------------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS workspace_id TEXT;

UPDATE messages m
SET workspace_id = c.workspace_id
FROM conversations c
WHERE m.conversation_id = c.id
  AND m.workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_workspace_timestamp
  ON messages(workspace_id, timestamp DESC);

-- Replace the subquery-based RLS policy with a direct column check
-- (old rows with NULL workspace_id stay invisible to RLS clients only;
-- the service role bypasses RLS and the backfill above fills them anyway).
DROP POLICY IF EXISTS messages_isolation ON messages;
CREATE POLICY messages_isolation ON messages
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));

-- ---------------------------------------------------------------------------
-- conversations: status-filtered inbox views ("open", "escalated") and
-- unread badges currently scan the whole workspace slice.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_status
  ON conversations(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace_unread
  ON conversations(workspace_id, updated_at DESC)
  WHERE unread = true;

-- Keyset pagination tie-breaker: (updated_at, id) must be fully indexed so
-- "WHERE (updated_at, id) < ($1, $2)" is a pure index range scan.
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_cursor
  ON conversations(workspace_id, updated_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- leads: pipeline views filter by status and sort by recency.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_workspace_status_created
  ON leads(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_workspace_cursor
  ON leads(workspace_id, updated_at DESC, id DESC);

-- Lead dedup on capture matches by email inside lead_data (previously a
-- full-workspace fetch + JS scan; now a single indexed lookup).
CREATE INDEX IF NOT EXISTS idx_leads_workspace_email
  ON leads(workspace_id, (lead_data->>'email'))
  WHERE lead_data->>'email' IS NOT NULL AND lead_data->>'email' <> '';

CREATE INDEX IF NOT EXISTS idx_leads_workspace_conversation
  ON leads(workspace_id, (lead_data->>'conversationId'))
  WHERE lead_data->>'conversationId' IS NOT NULL;

-- ---------------------------------------------------------------------------
-- knowledge_items: tag filtering and content-type filtering.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_knowledge_tags
  ON knowledge_items USING GIN (tags)
  WHERE tags IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_workspace_content_type
  ON knowledge_items(workspace_id, content_type)
  WHERE content_type IS NOT NULL;

-- ---------------------------------------------------------------------------
-- conversation_memory: per-channel history reads (lookup index requires
-- customer_id; channel-wide feeds were unindexed).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversation_memory_channel
  ON conversation_memory(workspace_id, channel, timestamp DESC);

-- ---------------------------------------------------------------------------
-- customer_profiles: recency-ordered CRM listing.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customer_profiles_workspace_updated
  ON customer_profiles(workspace_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- ai_usage_logs: the analytics summary aggregates per workspace; created_at
-- ordering supports future month-windowed rollups without a re-scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_workspace_created
  ON ai_usage_logs(workspace_id, created_at DESC);

-- Refresh planner statistics so the new indexes are picked up immediately.
ANALYZE messages;
ANALYZE conversations;
ANALYZE leads;
ANALYZE knowledge_items;
ANALYZE conversation_memory;
ANALYZE customer_profiles;
