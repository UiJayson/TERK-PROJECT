/**
 * Synthetic-question generator (Problem 3 §Step 4). Builds a realistic set of
 * test questions from the tenant's structured data + uploaded chunk categories,
 * to be answered by the retrieval router and reviewed by the owner in staging.
 *
 * Deterministic (no AI cost) so re-running the generator produces the same
 * question set until the underlying data changes.
 */

import {
  getBusinessProfile,
  getOperatingHours,
  listEscalationContacts,
  listPolicyRecords,
  listPricingItems,
} from "../business-store.ts";
import { listIngestedChunks } from "../ingestion/document-store.ts";
import { getCurrentKbVersion } from "../versioning/kb-version-manager.ts";
import type { CriticalCategory } from "../types.ts";

export interface SyntheticQuestion {
  question: string;
  category: CriticalCategory | "general";
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function generateSyntheticQuestions(
  workspaceId: string,
): Promise<SyntheticQuestion[]> {
  const [profile, hours, prices, policies, contacts] = await Promise.all([
    getBusinessProfile(workspaceId),
    getOperatingHours(workspaceId),
    listPricingItems(workspaceId),
    listPolicyRecords(workspaceId),
    listEscalationContacts(workspaceId),
  ]);

  const out: SyntheticQuestion[] = [];

  if (policies.some((p) => p.policyType === "refund")) {
    out.push({ question: "What is your refund policy?", category: "refund_policy" });
    out.push({ question: "How many days do I have to request a refund?", category: "refund_policy" });
  }
  if (policies.some((p) => p.policyType === "cancellation")) {
    out.push({ question: "Can I cancel an order after payment?", category: "refund_policy" });
  }
  if (policies.some((p) => p.policyType === "damage")) {
    out.push({ question: "What happens if my item arrives damaged?", category: "refund_policy" });
  }
  if (policies.some((p) => p.policyType === "delivery")) {
    out.push({ question: "Do you offer weekend delivery?", category: "refund_policy" });
  }

  if (hours.length > 0) {
    out.push({ question: "What are your opening hours?", category: "operating_hours" });
    const openDay = hours.find((h) => !h.isClosed);
    if (openDay) {
      out.push({
        question: `What are your opening hours on ${DAY_NAMES[openDay.dayOfWeek]}?`,
        category: "operating_hours",
      });
    }
  }

  if (prices.length > 0) {
    out.push({ question: "How much do your services cost?", category: "pricing" });
    const first = prices.find((p) => p.isActive) ?? prices[0];
    if (first) {
      out.push({ question: `How much does ${first.name} cost?`, category: "pricing" });
    }
  }

  if (contacts.length > 0) {
    out.push({ question: "How can I speak to a manager?", category: "escalation_contact" });
    out.push({ question: "What is your support contact?", category: "escalation_contact" });
  }

  if (profile) {
    out.push({ question: `What is ${profile.businessName || "your business"} about?`, category: "general" });
  }

  // Add up to 3 questions derived from the ingested document categories, so the
  // owner also exercises Track 2 during review.
  const kbVersion = await getCurrentKbVersion(workspaceId);
  const chunks = await listIngestedChunks(workspaceId, kbVersion);
  const seenCategories = new Set<string>();
  for (const chunk of chunks) {
    if (seenCategories.size >= 3) break;
    if (seenCategories.has(chunk.category)) continue;
    seenCategories.add(chunk.category);
    if (chunk.category === "faq") {
      out.push({ question: "What do customers most commonly ask about?", category: "general" });
    } else if (chunk.category === "troubleshooting") {
      out.push({ question: "What should I do if something isn't working?", category: "general" });
    } else if (chunk.category === "product_spec") {
      out.push({ question: "What are the key specifications of your product?", category: "general" });
    }
  }

  return out;
}
