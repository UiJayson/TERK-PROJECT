-- M14: Knowledge keyword retrieval schema (Phase A + B structure)

-- Add tags and content_type to knowledge_items
-- content_type maps to spec "type" column (product|service|pricing|faq|policy|document)
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS content_type TEXT;

-- Migrate existing entries from metadata.section
UPDATE knowledge_items
SET content_type = CASE
  WHEN (metadata->>'section') = 'products' THEN 'product'
  WHEN (metadata->>'section') = 'pricing' THEN 'pricing'
  WHEN (metadata->>'section') = 'policies' THEN 'policy'
  WHEN (metadata->>'section') = 'faqs' THEN 'faq'
  WHEN (metadata->>'section') = 'documents' THEN 'document'
  ELSE 'service'
END
WHERE type = 'entry' AND content_type IS NULL;

-- Phase B: knowledge_embeddings chunk_text column (spec name; content kept for compat)
ALTER TABLE knowledge_embeddings ADD COLUMN IF NOT EXISTS chunk_text TEXT;
UPDATE knowledge_embeddings SET chunk_text = content WHERE chunk_text IS NULL;
