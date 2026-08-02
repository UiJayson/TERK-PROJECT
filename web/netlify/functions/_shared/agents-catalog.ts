export type AgentId = "reception" | "sales" | "marketing";

export interface AgentDefinition {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  model: string;
  knowledgeSources: string[];
  channels: string[];
  promptPath: string;
}

/** Static catalog — mirrors existing agent architecture. Not per-tenant. */
export const AGENT_CATALOG: Record<AgentId, AgentDefinition> = {
  reception: {
    id: "reception",
    name: "Reception Agent",
    role: "AI Receptionist",
    description: "Welcome visitors, answer FAQs, collect intake, and route conversations.",
    model: "gpt-4o-mini",
    knowledgeSources: [
      "shared/company.md",
      "shared/faq.md",
      "shared/products.md",
      "shared/policies.md",
      "shared/brand_voice.md",
      "shared/sops.md",
      "shared/documents.md",
    ],
    channels: ["website_chat"],
    promptPath: "agents/reception/agent.md",
  },
  sales: {
    id: "sales",
    name: "Sales Agent",
    role: "AI Sales Executive",
    description: "Recommend products, handle objections, explain benefits, and encourage checkout.",
    model: "gpt-4o-mini",
    knowledgeSources: [
      "shared/company.md",
      "shared/products.md",
      "shared/pricing.md",
      "shared/faq.md",
      "shared/policies.md",
      "shared/brand_voice.md",
      "shared/sops.md",
      "shared/documents.md",
    ],
    channels: ["website_chat"],
    promptPath: "agents/sales/agent.md",
  },
  marketing: {
    id: "marketing",
    name: "Marketing Agent",
    role: "AI Marketing Manager",
    description: "Create captions, campaign ideas, and brand-aligned content drafts.",
    model: "gpt-4o-mini",
    knowledgeSources: [
      "shared/brand_voice.md",
      "shared/products.md",
      "shared/pricing.md",
      "shared/policies.md",
      "shared/sops.md",
      "shared/documents.md",
    ],
    channels: ["website_chat"],
    promptPath: "agents/marketing/agent.md",
  },
};

export const AGENT_IDS: AgentId[] = ["reception", "sales", "marketing"];

export function isAgentId(value: string): value is AgentId {
  return AGENT_IDS.includes(value as AgentId);
}
