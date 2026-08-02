-- M22: Product catalog fields on knowledge_items
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS price DECIMAL(12, 2);
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS stock_status TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_products
  ON knowledge_items(workspace_id, content_type)
  WHERE type = 'entry' AND content_type = 'product';
