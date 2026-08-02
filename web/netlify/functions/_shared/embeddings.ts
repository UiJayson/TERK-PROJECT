import { createId } from "./auth-crypto.ts";
import { isKnowledgeItemType } from "./knowledge.ts";
import { generateEmbedding as aiGenerateEmbedding } from "./ai-engine.ts";
import { EMBEDDING_DIMENSIONS } from "./ai-providers/pricing.ts";
import { getSql } from "./db.ts";
import type { KnowledgeSection } from "./knowledge-types.ts";

const CHUNK_SIZE_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 200;

export type KnowledgeContentType =
  | "product"
  | "service"
  | "faq"
  | "policy"
  | "pricing"
  | "document";

export interface KnowledgeChunkMetadata {
  title: string;
  section?: string;
  type: KnowledgeContentType;
  sourceDoc?: string;
  chunkIndex: number;
  itemId: string;
}

export interface RetrievedKnowledgeChunk {
  id: string;
  content: string;
  score: number;
  metadata: KnowledgeChunkMetadata;
}

const SECTION_TYPE_MAP: Record<KnowledgeSection, KnowledgeContentType> = {
  company: "service",
  products: "product",
  pricing: "pricing",
  policies: "policy",
  faqs: "faq",
  brand_voice: "service",
  documents: "document",
};

function sectionToType(section: KnowledgeSection): KnowledgeContentType {
  return SECTION_TYPE_MAP[section];
}

function filePathToType(path: string): KnowledgeContentType {
  if (path.includes("pricing")) return "pricing";
  if (path.includes("products")) return "product";
  if (path.includes("faq")) return "faq";
  if (path.includes("policies")) return "policy";
  return "service";
}

export function chunkText(
  text: string,
  metadata: Omit<KnowledgeChunkMetadata, "chunkIndex">,
): Array<{ content: string; metadata: KnowledgeChunkMetadata }> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: Array<{ content: string; metadata: KnowledgeChunkMetadata }> = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    let end = Math.min(start + CHUNK_SIZE_CHARS, normalized.length);

    // Prefer a natural boundary (paragraph, then line, then sentence) in the
    // back half of the window so a fact is not split mid-sentence across
    // chunks. Fall back to the hard cut when no boundary exists.
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const minBreak = Math.floor(CHUNK_SIZE_CHARS / 2);
      const paragraphBreak = window.lastIndexOf("\n\n");
      const lineBreak = window.lastIndexOf("\n");
      const sentenceBreak = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf(".\n"),
      );
      const boundary =
        paragraphBreak >= minBreak
          ? paragraphBreak + 2
          : lineBreak >= minBreak
            ? lineBreak + 1
            : sentenceBreak >= minBreak
              ? sentenceBreak + 1
              : -1;
      if (boundary > 0) end = start + boundary;
    }

    const content = normalized.slice(start, end).trim();
    if (content) {
      chunks.push({
        content,
        metadata: { ...metadata, chunkIndex: index },
      });
      index += 1;
    }
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP_CHARS);
  }

  return chunks;
}


/**
 * Real embeddings via the configured AI provider (OpenAI embedding model,
 * reached through ai-engine). Previously this called the knowledge.ts
 * placeholder that always returned null, so vector indexing and semantic
 * search silently never worked. Returns null when no provider is configured —
 * callers fall back to keyword search.
 */
export async function generateEmbedding(
  text: string,
  workspaceId?: string,
): Promise<number[] | null> {
  const embedding = await aiGenerateEmbedding(text, workspaceId);
  if (embedding && embedding.length !== EMBEDDING_DIMENSIONS) {
    console.warn(
      `Embedding dimension mismatch: got ${embedding.length}, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }
  return embedding;
}

async function generateEmbeddings(
  texts: string[],
  workspaceId?: string,
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];

  const results: (number[] | null)[] = [];
  for (const text of texts) {
    results.push(await generateEmbedding(text, workspaceId));
  }
  return results;
}

function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function deleteEmbeddingsForItem(
  workspaceId: string,
  itemId: string,
): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  await db`
    DELETE FROM knowledge_embeddings
    WHERE workspace_id = ${workspaceId} AND item_id = ${itemId}
  `;
}

export async function upsertKnowledgeItem(input: {
  workspaceId: string;
  itemId: string;
  title: string;
  content: string;
  type: KnowledgeContentType;
  section?: string;
  sourceDoc?: string;
}): Promise<{ chunksIndexed: number }> {
  if (!input.content.trim()) {
    await deleteEmbeddingsForItem(input.workspaceId, input.itemId);
    return { chunksIndexed: 0 };
  }

  const chunks = chunkText(input.content, {
    title: input.title,
    section: input.section,
    type: input.type,
    sourceDoc: input.sourceDoc ?? input.title,
    itemId: input.itemId,
  });

  await deleteEmbeddingsForItem(input.workspaceId, input.itemId);
  if (chunks.length === 0) return { chunksIndexed: 0 };

  const embeddings = await generateEmbeddings(
    chunks.map((chunk) => chunk.content),
    input.workspaceId,
  );
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${input.workspaceId}, true)`;

  let indexed = 0;
  for (let i = 0; i < chunks.length; i++) {
    const embedding = embeddings[i];
    if (!embedding) continue;

    const id = createId("kemb");
    const chunk = chunks[i];
    await db`
      INSERT INTO knowledge_embeddings (
        id, workspace_id, item_id, content, chunk_text, embedding, metadata, created_at
      ) VALUES (
        ${id},
        ${input.workspaceId},
        ${input.itemId},
        ${chunk.content},
        ${chunk.content},
        ${vectorLiteral(embedding)}::vector,
        ${db.json(chunk.metadata as never)},
        ${new Date().toISOString()}
      )
    `;
    indexed += 1;
  }

  return { chunksIndexed: indexed };
}

export async function indexKnowledgeEntry(
  workspaceId: string,
  item: {
    id: string;
    title: string;
    content: string;
    section: KnowledgeSection;
    type?: string;
    document?: { filename: string };
  },
): Promise<{ chunksIndexed: number }> {
  const mappedType = item.type && isKnowledgeItemType(item.type)
    ? item.type
    : sectionToType(item.section);

  return upsertKnowledgeItem({
    workspaceId,
    itemId: item.id,
    title: item.title,
    content: item.content,
    type: mappedType,
    section: item.section,
    sourceDoc: item.document?.filename ?? item.title,
  });
}

export async function indexSharedKnowledgeFile(
  workspaceId: string,
  filePath: string,
  content: string,
): Promise<{ chunksIndexed: number }> {
  return upsertKnowledgeItem({
    workspaceId,
    itemId: filePath,
    title: filePath,
    content,
    type: filePathToType(filePath),
    section: filePath.replace("shared/", "").replace(".md", ""),
    sourceDoc: filePath,
  });
}

export async function searchKnowledge(
  workspaceId: string,
  query: string,
  topK = 5,
): Promise<RetrievedKnowledgeChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const queryEmbedding = await generateEmbedding(trimmed, workspaceId);
  if (!queryEmbedding) return [];

  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;

  const vector = vectorLiteral(queryEmbedding);
  const rows = await db`
    SELECT
      id,
      content,
      metadata,
      1 - (embedding <=> ${vector}::vector) AS score
    FROM knowledge_embeddings
    WHERE workspace_id = ${workspaceId}
    ORDER BY embedding <=> ${vector}::vector
    LIMIT ${topK}
  `;

  return rows.map((row) => ({
    id: String(row.id),
    content: String(row.content),
    score: Number(row.score ?? 0),
    metadata: row.metadata as KnowledgeChunkMetadata,
  }));
}

export function formatRetrievedKnowledge(chunks: RetrievedKnowledgeChunk[]): string {
  if (chunks.length === 0) {
    return [
      "## Retrieved Knowledge Base (semantic search)",
      "",
      "No relevant knowledge chunks were retrieved for this message.",
      "Do NOT invent company facts. Tell the customer you do not have that information and offer to connect them with the team.",
    ].join("\n");
  }

  const lines = [
    "## Retrieved Knowledge Base (semantic search — use ONLY these facts)",
    "",
    "Before responding, use the chunks below. Do not add facts that are not supported here.",
    "If the answer is not in these chunks, say you do not have that information.",
    "",
  ];

  for (const [index, chunk] of chunks.entries()) {
    lines.push(
      `### Chunk ${index + 1} (score ${chunk.score.toFixed(3)})`,
      `Source: ${chunk.metadata.sourceDoc ?? chunk.metadata.title}`,
      `Type: ${chunk.metadata.type}`,
      chunk.metadata.section ? `Section: ${chunk.metadata.section}` : "",
      "",
      chunk.content.trim(),
      "",
    );
  }

  return lines.filter(Boolean).join("\n");
}

export async function reindexWorkspaceKnowledge(
  workspaceId: string,
  items: Array<{
    id: string;
    title: string;
    content: string;
    section: KnowledgeSection;
    document?: { filename: string };
  }>,
  sharedFiles: Record<string, string>,
): Promise<{ totalChunks: number }> {
  let totalChunks = 0;

  for (const item of items) {
    const result = await indexKnowledgeEntry(workspaceId, item);
    totalChunks += result.chunksIndexed;
  }

  for (const [path, content] of Object.entries(sharedFiles)) {
    const result = await indexSharedKnowledgeFile(workspaceId, path, content);
    totalChunks += result.chunksIndexed;
  }

  return { totalChunks };
}
