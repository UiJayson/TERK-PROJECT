/**
 * Track 1 — deterministic DB lookup. The customer query is pattern-matched
 * against a small set of *critical* intents (refund policy, operating hours,
 * pricing for a named product, escalation contact). On match, the answer is
 * assembled from the verified structured DB — no AI in the loop. On no match,
 * the router falls through to Track 2 (RAG).
 *
 * Hard rule (spec §Step 3): refund policy, business hours, pricing, and
 * contacts are ALWAYS Track 1. They never touch RAG.
 */

import {
  getBusinessProfile,
  getOperatingHours,
  getPolicyByType,
  listEscalationContacts,
  listPricingItems,
} from "../business-store.ts";

export interface Track1Answer {
  matched: true;
  answer: string;
  category:
    | "refund_policy"
    | "cancellation_policy"
    | "exchange_policy"
    | "operating_hours"
    | "pricing"
    | "escalation_contact"
    | "business_info";
  source: "structured_db";
}

export type Track1Result = Track1Answer | { matched: false };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTime(hhmm: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function normalizeQuery(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function askedAboutRefund(q: string): boolean {
  return /\brefund/.test(q);
}
function askedAboutCancellation(q: string): boolean {
  return /\bcancel(l?ation)?\b/.test(q);
}
function askedAboutExchange(q: string): boolean {
  return /\bexchange\b/.test(q);
}
function askedAboutHours(q: string): boolean {
  return /\b(hours|open(ing)?|close|closing|when.*open|when.*close)\b/.test(q);
}
function askedAboutPricing(q: string): boolean {
  return /\b(price|pricing|cost|how much|how many|charge|fee|rate)\b/.test(q);
}
function askedAboutEscalation(q: string): boolean {
  return /\b(speak to|talk to|human|manager|contact|escalate|complaint|support (email|phone))\b/.test(q);
}

function dayFromQuery(q: string): number | null {
  for (let i = 0; i < DAY_NAMES.length; i++) {
    if (q.includes(DAY_NAMES[i].toLowerCase())) return i;
  }
  return null;
}

async function answerRefund(workspaceId: string): Promise<Track1Answer | null> {
  const policy = await getPolicyByType(workspaceId, "refund");
  if (!policy) return null;
  const window = policy.windowDays ? ` (within ${policy.windowDays} days)` : "";
  return {
    matched: true,
    answer: `Our refund policy${window}: ${policy.ruleText}`,
    category: "refund_policy",
    source: "structured_db",
  };
}

async function answerCancellation(workspaceId: string): Promise<Track1Answer | null> {
  const policy = await getPolicyByType(workspaceId, "cancellation");
  if (!policy) return null;
  const window = policy.windowDays ? ` (within ${policy.windowDays} days)` : "";
  return {
    matched: true,
    answer: `Cancellation policy${window}: ${policy.ruleText}`,
    category: "cancellation_policy",
    source: "structured_db",
  };
}

async function answerExchange(workspaceId: string): Promise<Track1Answer | null> {
  const policy = await getPolicyByType(workspaceId, "exchange");
  if (!policy) return null;
  const window = policy.windowDays ? ` (within ${policy.windowDays} days)` : "";
  return {
    matched: true,
    answer: `Exchange policy${window}: ${policy.ruleText}`,
    category: "exchange_policy",
    source: "structured_db",
  };
}

async function answerHours(workspaceId: string, q: string): Promise<Track1Answer | null> {
  const hours = await getOperatingHours(workspaceId);
  if (hours.length === 0) return null;

  const specificDay = dayFromQuery(q);
  if (specificDay !== null) {
    const day = hours.find((h) => h.dayOfWeek === specificDay);
    if (!day) return null;
    if (day.isClosed) {
      return {
        matched: true,
        answer: `We're closed on ${DAY_NAMES[specificDay]}.`,
        category: "operating_hours",
        source: "structured_db",
      };
    }
    return {
      matched: true,
      answer: `On ${DAY_NAMES[specificDay]} we're open ${formatTime(day.openTime)}–${formatTime(day.closeTime)}.`,
      category: "operating_hours",
      source: "structured_db",
    };
  }

  const lines = hours.map((h) =>
    h.isClosed
      ? `${DAY_NAMES[h.dayOfWeek]}: closed`
      : `${DAY_NAMES[h.dayOfWeek]}: ${formatTime(h.openTime)}–${formatTime(h.closeTime)}`,
  );
  return {
    matched: true,
    answer: `Our opening hours:\n${lines.join("\n")}`,
    category: "operating_hours",
    source: "structured_db",
  };
}

async function answerPricing(workspaceId: string, q: string): Promise<Track1Answer | null> {
  const items = await listPricingItems(workspaceId);
  if (items.length === 0) return null;

  // Named-product path: if the query mentions a product name from the catalog,
  // return that item's price deterministically.
  for (const item of items) {
    if (!item.isActive || !item.name) continue;
    if (q.includes(item.name.toLowerCase())) {
      const priceStr = `${item.currency} ${item.price.toFixed(2)}`;
      const discount =
        item.discountPercent != null && item.discountPercent > 0
          ? ` (currently ${item.discountPercent}% off)`
          : "";
      return {
        matched: true,
        answer: `${item.name}: ${priceStr}${discount}.`,
        category: "pricing",
        source: "structured_db",
      };
    }
  }
  // Generic "your prices" ask: list up to 5 active items.
  if (askedAboutPricing(q)) {
    const active = items.filter((item) => item.isActive).slice(0, 5);
    if (active.length === 0) return null;
    const lines = active.map(
      (item) => `• ${item.name}: ${item.currency} ${item.price.toFixed(2)}`,
    );
    return {
      matched: true,
      answer: `Here's our current pricing:\n${lines.join("\n")}`,
      category: "pricing",
      source: "structured_db",
    };
  }
  return null;
}

async function answerEscalation(workspaceId: string): Promise<Track1Answer | null> {
  const contacts = await listEscalationContacts(workspaceId);
  if (contacts.length === 0) return null;
  const support = contacts.find((c) => c.role === "support") ?? contacts[0];
  const bits: string[] = [];
  if (support.email) bits.push(`email ${support.email}`);
  if (support.phone) bits.push(`call ${support.phone}`);
  const contactStr = bits.length > 0 ? bits.join(" or ") : "our team";
  return {
    matched: true,
    answer: `You can reach ${support.name || "our team"} directly: ${contactStr}.`,
    category: "escalation_contact",
    source: "structured_db",
  };
}

async function answerBusinessInfo(
  workspaceId: string,
  q: string,
): Promise<Track1Answer | null> {
  if (!/\b(email|phone|contact|reach|call)\b/.test(q)) return null;
  const profile = await getBusinessProfile(workspaceId);
  if (!profile) return null;
  const bits: string[] = [];
  if (profile.supportEmail) bits.push(`email ${profile.supportEmail}`);
  if (profile.phone) bits.push(`phone ${profile.phone}`);
  if (bits.length === 0) return null;
  return {
    matched: true,
    answer: `You can contact ${profile.businessName || "us"} by ${bits.join(" or ")}.`,
    category: "business_info",
    source: "structured_db",
  };
}

/** Try each critical-intent handler in order; first match wins. */
export async function retrieveTrack1(
  workspaceId: string,
  query: string,
): Promise<Track1Result> {
  const q = normalizeQuery(query);

  if (askedAboutRefund(q)) {
    const answer = await answerRefund(workspaceId);
    if (answer) return answer;
  }
  if (askedAboutCancellation(q)) {
    const answer = await answerCancellation(workspaceId);
    if (answer) return answer;
  }
  if (askedAboutExchange(q)) {
    const answer = await answerExchange(workspaceId);
    if (answer) return answer;
  }
  if (askedAboutHours(q)) {
    const answer = await answerHours(workspaceId, q);
    if (answer) return answer;
  }
  const pricingAnswer = await answerPricing(workspaceId, q);
  if (pricingAnswer) return pricingAnswer;
  if (askedAboutEscalation(q)) {
    const answer = await answerEscalation(workspaceId);
    if (answer) return answer;
  }
  const bizAnswer = await answerBusinessInfo(workspaceId, q);
  if (bizAnswer) return bizAnswer;

  return { matched: false };
}
