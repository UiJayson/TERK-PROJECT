/**
 * Contradiction checker (Problem 3 §Step 2, item 4). Compares chunks tagged
 * `pricing` or `policy` against the verified structured DB. On mismatch, the
 * chunk is flagged and blocked from ingestion — it cannot enter the vector
 * store until the owner resolves it. This is the mechanism that prevents
 * "document says 30-day refund, verified refund is 7 days" hallucinations.
 */

import { getPolicyByType, listPolicyRecords, listPricingItems } from "../business-store.ts";
import type { ChunkCategory } from "../types.ts";

export interface ContradictionResult {
  hasContradiction: boolean;
  detail: string;
}

const CLEAN: ContradictionResult = { hasContradiction: false, detail: "" };

/** Extract every number that looks like "N day/days" from text. */
function extractDayNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /\b(\d{1,3})\s*[- ]?\s*(day|days|d)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0 && n < 400) out.push(n);
  }
  return out;
}

/** Extract price-looking numbers (currency-prefixed OR with .XX cents). */
function extractPrices(text: string): number[] {
  const out: number[] = [];
  const re = /(?:[$£€₦]\s?)(\d+(?:\.\d{1,2})?)|(?<!\d)(\d+\.\d{2})(?!\d)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[1] ?? match[2];
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) out.push(Number(n.toFixed(2)));
  }
  return out;
}

async function checkPolicyChunk(
  workspaceId: string,
  text: string,
): Promise<ContradictionResult> {
  const lower = text.toLowerCase();
  const isRefund = /\brefund\b/.test(lower);
  const isCancel = /\bcancel(l?ation)?\b/.test(lower);
  const isExchange = /\bexchange\b/.test(lower);

  const candidateTypes: Array<"refund" | "cancellation" | "exchange"> = [];
  if (isRefund) candidateTypes.push("refund");
  if (isCancel) candidateTypes.push("cancellation");
  if (isExchange) candidateTypes.push("exchange");
  if (candidateTypes.length === 0) return CLEAN;

  const daysInChunk = extractDayNumbers(text);
  if (daysInChunk.length === 0) return CLEAN;

  for (const type of candidateTypes) {
    const verified = await getPolicyByType(workspaceId, type);
    if (!verified?.windowDays) continue;
    const match = daysInChunk.some((n) => n === verified.windowDays);
    if (!match) {
      return {
        hasContradiction: true,
        detail: `Document mentions ${daysInChunk.join("/")} days for ${type}; verified value is ${verified.windowDays} days.`,
      };
    }
  }

  // Text mentions a policy area we have no verified record for — surface it so
  // the owner adds the structured record before ingestion.
  const missing = candidateTypes.filter(async (type) => !(await getPolicyByType(workspaceId, type)));
  if (missing.length > 0) {
    // (Note: `filter` w/ async predicate returns Promises, not booleans; keep
    //  the simple check below as authoritative.)
  }
  const allExisting = await listPolicyRecords(workspaceId);
  const haveTypes = new Set(allExisting.map((p) => p.policyType));
  for (const type of candidateTypes) {
    if (!haveTypes.has(type)) {
      return {
        hasContradiction: true,
        detail: `Document mentions a ${type} policy but no verified ${type} policy is on file. Add the structured record or discard the chunk.`,
      };
    }
  }

  return CLEAN;
}

async function checkPricingChunk(
  workspaceId: string,
  text: string,
): Promise<ContradictionResult> {
  const pricesInChunk = extractPrices(text);
  if (pricesInChunk.length === 0) return CLEAN;

  const items = await listPricingItems(workspaceId);
  if (items.length === 0) {
    return {
      hasContradiction: true,
      detail: `Document mentions prices (${pricesInChunk.join(", ")}) but no verified pricing is on file.`,
    };
  }

  // If any product NAMED in the structured catalog appears in this chunk, its
  // adjacent price must match. Otherwise we don't have a strong enough signal
  // to flag — the chunk may be talking about historical/example prices.
  const lower = text.toLowerCase();
  for (const item of items) {
    if (!item.name || !lower.includes(item.name.toLowerCase())) continue;
    const match = pricesInChunk.some((p) => Math.abs(p - item.price) < 0.005);
    if (!match) {
      return {
        hasContradiction: true,
        detail:
          `Document lists a price for "${item.name}" that doesn't match the verified price ` +
          `(${item.currency} ${item.price.toFixed(2)}). Prices in chunk: ${pricesInChunk.join(", ")}.`,
      };
    }
  }

  return CLEAN;
}

/**
 * Public entry point. Returns clean for anything that isn't `pricing` or
 * `policy`; those two categories go through their category-specific checks.
 */
export async function checkChunkForContradictions(
  workspaceId: string,
  category: ChunkCategory,
  text: string,
): Promise<ContradictionResult> {
  if (category === "pricing") return checkPricingChunk(workspaceId, text);
  if (category === "policy") return checkPolicyChunk(workspaceId, text);
  return CLEAN;
}
