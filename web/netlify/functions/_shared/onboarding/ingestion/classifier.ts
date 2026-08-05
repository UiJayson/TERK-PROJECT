/**
 * Keyword-rule chunk classifier. Assigns each chunk one of six categories used
 * by both the contradiction checker (pricing/policy chunks are compared against
 * structured DB) and the two-track retrieval router (categories drive filters).
 *
 * Deliberately deterministic — an AI classifier would add latency and cost to
 * every ingested document, and misclassifications here get corrected downstream
 * by the contradiction checker and the staging owner review.
 */

import type { ChunkCategory } from "../types.ts";

const RULES: Array<{ category: ChunkCategory; patterns: RegExp[] }> = [
  {
    category: "pricing",
    patterns: [
      /\b(price|pricing|cost|fee|rate|tier|plan|package|subscription|discount)\b/i,
      /\$\s?\d|£\s?\d|€\s?\d|₦\s?\d/,
      /\b\d+(\.\d{1,2})?\s?(usd|gbp|eur|ngn)\b/i,
    ],
  },
  {
    category: "policy",
    patterns: [
      /\b(refund|return|exchange|cancel(l?ation)?|warranty|guarantee|shipping|delivery|damage)\b/i,
      /\b(policy|policies|terms|conditions)\b/i,
      /\bwithin\s+\d+\s+(day|days|hour|hours|week|weeks)\b/i,
    ],
  },
  {
    category: "product_spec",
    patterns: [
      /\b(spec(ification)?|dimension|weight|material|colou?r|size|capacity|feature|includes)\b/i,
      /\b(model|sku|variant|version)\b/i,
    ],
  },
  {
    category: "troubleshooting",
    patterns: [
      /\b(troubleshoot|error|issue|problem|fix|resolve|reset|reboot|not working|broken)\b/i,
      /\bhow\s+(do|to)\s+i\b.*\b(fix|solve|reset)\b/i,
    ],
  },
  {
    category: "faq",
    patterns: [
      /\b(faq|frequently\s+asked|q:|question:|answer:)\b/i,
      /\?\s*$/m,
    ],
  },
];

export function classifyChunk(text: string): ChunkCategory {
  const scores = new Map<ChunkCategory, number>();
  for (const { category, patterns } of RULES) {
    const hits = patterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
    if (hits > 0) scores.set(category, hits);
  }
  if (scores.size === 0) return "general";
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
