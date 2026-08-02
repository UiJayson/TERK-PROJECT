import {
  isKnowledgeItemType,
  searchKnowledge as keywordSearch,
  type KnowledgeSearchResult,
} from "./knowledge.ts";
import { searchKnowledge as semanticSearch } from "./embeddings.ts";

/** Minimum cosine-similarity score to include a semantic chunk (0–1). */
const MIN_SEMANTIC_SCORE = 0.68;

const MAX_CONTEXT_CHARS = 12_000;

/**
 * Hybrid Company Brain retrieval: semantic vector search + keyword scoring,
 * merged and deduplicated. Falls back to keyword-only when embeddings are
 * unavailable (no provider configured or index empty).
 */
export async function retrieveKnowledgeForQuery(
  workspaceId: string,
  query: string,
  topK = 5,
): Promise<KnowledgeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [semantic, keyword] = await Promise.all([
    semanticSearch(workspaceId, trimmed, topK).catch(() => []),
    keywordSearch(workspaceId, trimmed, topK).catch(() => []),
  ]);

  const semanticResults: KnowledgeSearchResult[] = semantic
    .filter((chunk) => chunk.score >= MIN_SEMANTIC_SCORE)
    .map((chunk) => ({
      id: chunk.id,
      title: chunk.metadata.title || chunk.metadata.sourceDoc || "Knowledge",
      content: chunk.content,
      type: isKnowledgeItemType(chunk.metadata.type)
        ? chunk.metadata.type
        : "service",
      relevanceScore: Math.round(chunk.score * 100),
    }));

  const merged = new Map<string, KnowledgeSearchResult>();

  for (const item of [...semanticResults, ...keyword]) {
    const key = item.id || `${item.title}:${item.content.slice(0, 80)}`;
    const existing = merged.get(key);
    if (!existing || item.relevanceScore > existing.relevanceScore) {
      merged.set(key, item);
    }
  }

  const ranked = [...merged.values()]
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);

  return trimToContextBudget(ranked);
}

/** Prevent context stuffing — cap total injected knowledge size. */
function trimToContextBudget(results: KnowledgeSearchResult[]): KnowledgeSearchResult[] {
  let total = 0;
  const kept: KnowledgeSearchResult[] = [];

  for (const item of results) {
    const line = `[${item.type}] ${item.title}: ${item.content}`;
    if (total + line.length > MAX_CONTEXT_CHARS && kept.length > 0) break;
    kept.push(item);
    total += line.length;
  }

  return kept;
}
