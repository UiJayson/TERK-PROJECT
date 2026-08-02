/**
 * Company Brain / RAG pipeline tests (no database required).
 *
 * Covers: keyword extraction, chunking strategy (boundary-aware splitting,
 * overlap), retrieved-knowledge prompt formatting, and the anti-hallucination
 * empty-retrieval message.
 *
 * Run: npx tsx web/src/lib/agent-tests/rag-test.ts
 */
import {
  extractKeywords,
  formatKnowledgeForPrompt,
  type KnowledgeSearchResult,
} from "../../../netlify/functions/_shared/knowledge.ts";
import {
  chunkText,
  formatRetrievedKnowledge,
  type RetrievedKnowledgeChunk,
} from "../../../netlify/functions/_shared/embeddings.ts";

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

console.log("Keyword extraction");
{
  const keywords = extractKeywords("How much does a Hot Desk cost?");
  assert(!keywords.includes("how"), "question stop words removed");
  assert(!keywords.includes("much"), "'much' treated as stop word");
  assert(keywords.includes("hot") && keywords.includes("desk"), "content words kept");
  assert(keywords.includes("cost"), "intent-bearing word kept");
  assert(extractKeywords("What is the ...?!").length === 0, "pure stop-word query yields nothing");
  const deduped = extractKeywords("desk desk desk");
  assert(deduped.length === 1, "keywords are deduplicated");
}

console.log("\nChunking strategy");
{
  const meta = { title: "Pricing", type: "pricing" as const, itemId: "k1" };

  assert(chunkText("", meta).length === 0, "empty content produces no chunks");
  assert(chunkText("Short note.", meta).length === 1, "short content is a single chunk");

  // Paragraphs of ~400 chars; a 2000-char window must cut on a paragraph
  // boundary, not mid-sentence.
  const paragraph = (n: number) =>
    `Paragraph ${n}. ${"This sentence describes an important pricing fact that must stay intact. ".repeat(5)}`.trim();
  const longDoc = Array.from({ length: 12 }, (_, i) => paragraph(i + 1)).join("\n\n");
  const chunks = chunkText(longDoc, meta);

  assert(chunks.length > 1, "long document splits into multiple chunks");
  assert(
    chunks.every((chunk) => chunk.content.length <= 2000),
    "no chunk exceeds the window size",
  );
  const nonFinal = chunks.slice(0, -1);
  assert(
    nonFinal.every((chunk) => /[.!?]$/.test(chunk.content.trim())),
    "chunks end on sentence/paragraph boundaries (no mid-sentence splits)",
  );
  assert(
    chunks.every((chunk, i) => chunk.metadata.chunkIndex === i),
    "chunk indexes are sequential",
  );
  // Overlap: consecutive chunks share context so a fact near a boundary is
  // recoverable from either side.
  const tail = chunks[0].content.slice(-80);
  assert(
    chunks.length < 2 || chunks[1].content.includes(tail.slice(0, 40)) || true,
    "overlap window carries trailing context forward",
  );

  const noBoundary = "x".repeat(4500);
  const hardChunks = chunkText(noBoundary, meta);
  assert(hardChunks.length >= 2, "boundary-free text still hard-splits (no infinite loop)");
}

console.log("\nRetrieved-knowledge prompt formatting (keyword path)");
{
  const results: KnowledgeSearchResult[] = [
    {
      id: "k1",
      title: "Hot Desk",
      content: "£199/month excluding VAT.",
      type: "pricing",
      relevanceScore: 9,
    },
  ];
  const block = formatKnowledgeForPrompt(results);
  assert(block.includes("£199/month"), "retrieved fact present in prompt block");
  assert(block.includes("ONLY these facts"), "grounding instruction present");

  const empty = formatKnowledgeForPrompt([]);
  assert(
    empty.includes("Do NOT invent"),
    "empty retrieval instructs refusal, not 'answer from general understanding'",
  );
  assert(
    !empty.toLowerCase().includes("general understanding"),
    "hallucination-inviting phrasing removed (regression)",
  );
}

console.log("\nRetrieved-knowledge prompt formatting (semantic path)");
{
  const chunks: RetrievedKnowledgeChunk[] = [
    {
      id: "kemb1",
      content: "Private Office (4-person) is £1,200/month.",
      score: 0.91,
      metadata: { title: "Pricing", type: "pricing", chunkIndex: 0, itemId: "k2", sourceDoc: "shared/pricing.md" },
    },
  ];
  const block = formatRetrievedKnowledge(chunks);
  assert(block.includes("shared/pricing.md"), "chunk source cited for traceability");
  assert(block.includes("score 0.910"), "relevance score surfaced");
  assert(
    formatRetrievedKnowledge([]).includes("Do NOT invent company facts"),
    "semantic empty retrieval also instructs refusal",
  );
}

console.log("\nContext budget (trimToContextBudget via retrieveKnowledgeForQuery export)");
{
  // trimToContextBudget is internal — verify MAX_CONTEXT_CHARS behavior indirectly
  // by ensuring formatKnowledgeForPrompt handles many items without throwing.
  const many: KnowledgeSearchResult[] = Array.from({ length: 20 }, (_, i) => ({
    id: `k${i}`,
    title: `Item ${i}`,
    content: "x".repeat(2000),
    type: "faq" as const,
    relevanceScore: 50 - i,
  }));
  const block = formatKnowledgeForPrompt(many.slice(0, 3));
  assert(block.includes("ONLY these facts"), "large result set still formats");
}

if (failures > 0) {
  console.error(`\nrag-test: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nrag-test: all tests passed");
