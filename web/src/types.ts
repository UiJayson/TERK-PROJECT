export type AgentRole = "reception" | "sales" | "marketing" | "human_review";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  products?: ProductCard[];
}

export interface ProductCard {
  id: string;
  title: string;
  description: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  stockStatus: string | null;
}

export interface HandoffRequest {
  handoff_requested: boolean;
  target_agent: AgentRole;
  reason: string;
  conversation_summary: string;
}

export interface ConversationState {
  active_agent: AgentRole;
  last_intent: string;
  escalated?: boolean;
}

export interface ChatResponse {
  reply: string;
  agent: AgentRole;
  intent: string;
  routing_reason: string;
  handoff: HandoffRequest | null;
  citations: Array<{ source: string; topic?: string }>;
  action_log: string[];
  state: ConversationState;
  mode: "ai" | "demo";
  typing_delay_ms?: number;
  escalated?: boolean;
  products?: ProductCard[];
}
