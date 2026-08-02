export type AgentRole = "reception" | "sales" | "marketing" | "human_review";

export type Intent =
  | "greeting"
  | "faq"
  | "appointment_intake"
  | "admin_triage"
  | "lead_qualification"
  | "product_fit"
  | "pricing"
  | "quote_request"
  | "sales_objection"
  | "campaign_strategy"
  | "content_draft"
  | "complaint"
  | "human_request"
  | "billing_limit"
  | "unknown";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface HandoffRequest {
  handoff_requested: boolean;
  target_agent: AgentRole;
  reason: string;
  urgency?: string;
  conversation_summary: string;
  collected_fields?: Record<string, string>;
  missing_fields?: string[];
  recommended_next_action?: string;
}

export interface AgentResponse {
  response: string;
  handoff_request: HandoffRequest | null;
  action_log: string[];
  citations: Array<{ source: string; topic?: string }>;
  confidence?: number;
}

export interface RoutingDecision {
  selected_agent: AgentRole;
  confidence: number;
  primary_intent: Intent;
  reason: string;
  knowledge_files: string[];
}

export interface ConversationState {
  active_agent: AgentRole;
  last_intent: Intent;
  escalated?: boolean;
}

export interface ChatRequest {
  message: string;
  history: ChatMessage[];
  state?: ConversationState;
  page_url?: string;
}

export interface ChatResponse {
  reply: string;
  agent: AgentRole;
  intent: Intent;
  routing_reason: string;
  handoff: HandoffRequest | null;
  citations: Array<{ source: string; topic?: string }>;
  action_log: string[];
  state: ConversationState;
  mode: "ai" | "demo";
}
