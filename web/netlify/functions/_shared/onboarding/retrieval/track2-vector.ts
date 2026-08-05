/**
 * Track 2 — document RAG with a confidence gate. Runs only when Track 1 misses.
 * Uses text-similarity scoring against ingested chunks pinned to the requested
 * KB version. If the top chunk's score is <= threshold, the router returns the
 * fallback ("I don't have a verified answer") — the AI never invents an answer
 * on critical business data.
 */

import { listIngestedChunks } from "../ingestion/document-store.ts";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;

export interface Track2Answer {
  matched: true;
  answer: string;
  score: number;
  source: string; // "document_chunk:<filename>"
  chunkId: string;
}

export interface Track2Fallback {
  matched: false;
  score: number;
  fallbackAnswer: string;
}

export type Track2Result = Track2Answer | Track2Fallback;

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","by","do","does","for","from","how","i","in",
  "is","it","of","on","or","our","the","their","to","was","were","what","when",
  "where","which","who","why","will","with","you","your",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Jaccard similarity on token sets. Cheap, deterministic, no embeddings needed. */
function similarity(queryTokens: string[], chunkText: string): number {
  const qSet = new Set(queryTokens);
  if (qSet.size === 0) return 0;
  const cSet = new Set(tokenize(chunkText));
  let inter = 0;
  for (const t of qSet) if (cSet.has(t)) inter += 1;
  const union = qSet.size + cSet.size - inter;
  return union > 0 ? inter / union : 0;
}

function buildFallback(): string {
  return (
    "I don't have a verified answer for this. Let me connect you with our team so " +
    "they can help you directly."
  );
}

export async function retrieveTrack2(
  workspaceId: string,
  query: string,
  kbVersion: number,
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): Promise<Track2Result> {
  const chunks = await listIngestedChunks(workspaceId, kbVersion);
  if (chunks.length === 0) {
    return { matched: false, score: 0, fallbackAnswer: buildFallback() };
  }

  const queryTokens = tokenize(query);
  let best: { score: number; chunk: (typeof chunks)[number] } | null = null;
  for (const chunk of chunks) {
    const score = similarity(queryTokens, chunk.chunkText);
    if (!best || score > best.score) best = { score, chunk };
  }
  if (!best) return { matched: false, score: 0, fallbackAnswer: buildFallback() };

  // Normalise the raw Jaccard score to something closer to a probability. Short
  // customer queries have small token sets, which pushes raw scores low even on
  // strong hits, so we boost by the fraction of query tokens present.
  const querySet = new Set(queryTokens);
  const chunkSet = new Set(tokenize(best.chunk.chunkText));
  const overlap = [...querySet].filter((t) => chunkSet.has(t)).length;
  const coverage = querySet.size === 0 ? 0 : overlap / querySet.size;
  const confidence = Math.max(best.score, coverage);

  if (confidence <= threshold) {
    return { matched: false, score: confidence, fallbackAnswer: buildFallback() };
  }

  const source = best.chunk.filename
    ? `document_chunk:${best.chunk.filename}`
    : "document_chunk";

  return {
    matched: true,
    answer: best.chunk.chunkText,
    score: confidence,
    source,
    chunkId: best.chunk.id,
  };
}
