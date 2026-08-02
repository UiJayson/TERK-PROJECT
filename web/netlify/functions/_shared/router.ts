import type { AgentRole, ConversationState, Intent, RoutingDecision } from "./types.ts";

const salesPatterns = [
  /\b(price|pricing|quote|cost|plan|package|discount|buy|purchase|demo|proposal)\b/i,
  /\bwhich (plan|package|office|desk)\b/i,
  /\bfit(s)? (our|my) (team|company|business)\b/i,
  /\bcompare\b/i,
  /\bobjection\b/i,
];

const marketingPatterns = [
  /\b(campaign|newsletter|ad copy|landing page|social post|content calendar)\b/i,
  /\b(segmentation|audience segment|marketing report|performance report)\b/i,
  /\bbrand (collab|collaboration)\b/i,
];

const receptionPatterns = [
  /\b(book|booking|tour|visit|appointment|callback|opening hours|hours|open)\b/i,
  /\bhello|hi|hey|good (morning|afternoon|evening)\b/i,
  /\bwhere are you\b/i,
  /\bcontact\b/i,
];

const humanPatterns = [
  /\b(refund|legal|lawyer|harass|threat|safety|payment dispute)\b/i,
  /\b(speak to|talk to) (a )?(human|person|manager)\b/i,
];

const complaintPatterns = [/\b(complaint|unhappy|terrible|awful|disappointed)\b/i];

function detectIntent(text: string): Intent {
  const lower = text.toLowerCase();

  if (humanPatterns.some((pattern) => pattern.test(text))) return "human_request";
  if (complaintPatterns.some((pattern) => pattern.test(text))) return "complaint";
  if (/\b(book|tour|appointment|visit|callback)\b/i.test(text)) return "appointment_intake";
  if (/\b(quote|proposal)\b/i.test(text)) return "quote_request";
  if (/\b(price|pricing|cost)\b/i.test(text)) return "pricing";
  if (/\b(which package|which plan|best for)\b/i.test(text)) return "product_fit";
  if (/\b(team|people|person)\b/i.test(text) && /\b(plan|package|fit)\b/i.test(text)) {
    return "product_fit";
  }
  if (marketingPatterns.some((pattern) => pattern.test(text))) return "campaign_strategy";
  if (salesPatterns.some((pattern) => pattern.test(text))) return "lead_qualification";
  if (/\b(hours|open|wifi|wi-fi|parking)\b/i.test(text)) return "faq";
  if (/^(hi|hello|hey)\b/i.test(lower.trim())) return "greeting";
  if (text.trim().length < 20 && /\bhelp\b/i.test(text)) return "unknown";

  return "unknown";
}

export function routeMessage(
  text: string,
  options: {
    pageUrl?: string;
    state?: ConversationState;
  } = {},
): RoutingDecision {
  const intent = detectIntent(text);
  const stickySales =
    options.state?.active_agent === "sales" &&
    !receptionPatterns.some((pattern) => pattern.test(text)) &&
    !marketingPatterns.some((pattern) => pattern.test(text));

  if (humanPatterns.some((pattern) => pattern.test(text)) || intent === "complaint") {
    return {
      selected_agent: "human_review",
      confidence: 0.95,
      primary_intent: intent === "complaint" ? "complaint" : "human_request",
      reason: "Sensitive or human-required topic detected.",
      knowledge_files: ["shared/company.md", "shared/policies.md"],
    };
  }

  if (stickySales || salesPatterns.some((pattern) => pattern.test(text))) {
    return {
      selected_agent: "sales",
      confidence: 0.88,
      primary_intent:
        intent === "unknown" ? "lead_qualification" : intent,
      reason: stickySales
        ? "Continuing active sales conversation."
        : "User asked about pricing, product fit, or buying.",
      knowledge_files: [
        "shared/products.md",
        "shared/pricing.md",
        "shared/faq.md",
        "shared/brand_voice.md",
      ],
    };
  }

  if (marketingPatterns.some((pattern) => pattern.test(text))) {
    return {
      selected_agent: "marketing",
      confidence: 0.82,
      primary_intent: "campaign_strategy",
      reason: "Request appears to be marketing or campaign work.",
      knowledge_files: ["shared/brand_voice.md", "shared/products.md"],
    };
  }

  const pricingPageBoost =
    options.pageUrl?.includes("pricing") && /\b(plan|package|fit|team)\b/i.test(text);

  if (pricingPageBoost) {
    return {
      selected_agent: "sales",
      confidence: 0.84,
      primary_intent: "product_fit",
      reason: "Pricing page context with buying-related question.",
      knowledge_files: ["shared/products.md", "shared/pricing.md"],
    };
  }

  return {
    selected_agent: "reception",
    confidence: intent === "unknown" ? 0.65 : 0.9,
    primary_intent:
      intent === "unknown" ? "unknown" : intent,
    reason:
      intent === "unknown"
        ? "Ambiguous message; defaulting to Reception for triage."
        : "Front-desk, FAQ, or booking request.",
    knowledge_files: ["shared/company.md", "shared/faq.md", "shared/sops.md"],
  };
}

export function agentPromptPath(agent: AgentRole): string | null {
  const map: Partial<Record<AgentRole, string>> = {
    reception: "agents/receptionist/agent.md",
    sales: "agents/sales/agent.md",
    marketing: "agents/marketing/agent.md",
  };
  return map[agent] ?? null;
}
