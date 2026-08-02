import { getSql } from "./db.ts";

export const KNOWLEDGE_ITEM_TYPES = [
  "product",
  "service",
  "pricing",
  "faq",
  "policy",
  "document",
] as const;

export type KnowledgeItemType = (typeof KNOWLEDGE_ITEM_TYPES)[number];

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "how", "what", "when", "where", "which", "who", "why",
  "do", "does", "did", "can", "could", "would", "should",
  "you", "your", "i", "me", "my", "we", "our", "it", "its",
  "to", "of", "in", "on", "at", "for", "with", "and", "or",
  "have", "has", "had", "get", "got", "there", "this", "that",
  "please", "tell", "about", "much", "many", "any", "some",
]);

export interface KnowledgeSearchResult {
  id: string;
  title: string;
  content: string;
  type: KnowledgeItemType;
  relevanceScore: number;
}

export function isKnowledgeItemType(value: string): value is KnowledgeItemType {
  return (KNOWLEDGE_ITEM_TYPES as readonly string[]).includes(value);
}

export function extractKeywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
  return [...new Set(words)];
}

function scoreItem(
  item: { title: string; content: string; tags: string[] | null },
  keywords: string[],
  phrase: string,
): number {
  let score = 0;
  const titleLower = item.title.toLowerCase();
  const contentLower = item.content.toLowerCase();
  const tagsLower = (item.tags ?? []).map((tag) => tag.toLowerCase());

  for (const keyword of keywords) {
    if (titleLower.includes(keyword)) score += 3;
    if (contentLower.includes(keyword)) score += 1;
    if (tagsLower.some((tag) => tag === keyword || tag.includes(keyword))) score += 2;
  }

  // Exact multi-word phrase match strongly signals relevance over incidental
  // single-keyword hits ("hot desk" should beat items merely containing "hot").
  if (phrase.includes(" ") && (titleLower.includes(phrase) || contentLower.includes(phrase))) {
    score += 5;
  }

  // Require more than one keyword hit for multi-keyword queries so a single
  // incidental word match doesn't count as "relevant".
  if (keywords.length >= 3 && score <= 1) return 0;

  return score;
}

export async function searchKnowledge(
  workspaceId: string,
  query: string,
  topK = 3,
): Promise<KnowledgeSearchResult[]> {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;

  const rows = await db`
    SELECT id, title, content, COALESCE(content_type, 'service') AS item_type, tags
    FROM knowledge_items
    WHERE workspace_id = ${workspaceId}
      AND type = 'entry'
  `;

  return rows
    .map((row) => {
      const title = String(row.title);
      const content = String(row.content);
      const itemType = String(row.item_type);
      const tags = (row.tags as string[] | null) ?? [];

      return {
        id: String(row.id),
        title,
        content,
        type: (isKnowledgeItemType(itemType) ? itemType : "service") as KnowledgeItemType,
        relevanceScore: scoreItem({ title, content, tags }, keywords, query.trim().toLowerCase()),
      };
    })
    .filter((item) => item.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);
}

export function formatKnowledgeForPrompt(results: KnowledgeSearchResult[]): string {
  if (results.length === 0) {
    return [
      "## Retrieved Knowledge Base",
      "",
      "No relevant knowledge was retrieved for this message.",
      "Do NOT invent company facts (products, prices, policies, hours).",
      "Say you do not have that information and offer to connect the customer with the team.",
    ].join("\n");
  }

  return [
    "## Retrieved Knowledge Base (use ONLY these facts for company information)",
    "",
    ...results.map(
      (item) => `[${item.type}] ${item.title}: ${item.content}`,
    ),
    "",
    "If the answer is not covered above, say you do not have that information — do not guess.",
  ].join("\n");
}

/** Placeholder for M16 — returns null until OpenAI embeddings are wired. */
export async function generateEmbedding(_text: string): Promise<number[] | null> {
  return null;
}
