-- Milestone 3: Semantic Knowledge Retrieval (pgvector)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_workspace
  ON knowledge_embeddings(workspace_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_item
  ON knowledge_embeddings(workspace_id, item_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_vector
  ON knowledge_embeddings USING hnsw (embedding vector_cosine_ops);

ALTER TABLE knowledge_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_embeddings_isolation ON knowledge_embeddings
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true));
