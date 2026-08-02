import { getStoredToken } from "../auth/api";
import type { AgentRole } from "../auth/types";

async function request(path: string, init: RequestInit = {}) {
  const token = getStoredToken();
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error ?? "Request failed"));
  }
  return data;
}

export interface RuntimeConversation {
  id: string;
  customer: {
    name: string;
    email?: string;
    phone?: string;
    handle?: string;
  };
  channel: "website" | "whatsapp" | "instagram" | "email" | "dashboard";
  agentUsed: AgentRole;
  conversationStatus?: "open" | "escalated" | "resolved";
  leadStatus: "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";
  sentiment: "positive" | "neutral" | "negative";
  updatedAt: string;
  createdAt: string;
  preview: string;
  unread: boolean;
  intent?: string;
  routingReason?: string;
  messages: Array<{
    id: string;
    role: "customer" | "agent" | "system";
    agent?: AgentRole;
    content: string;
    sentAt: string;
    handoff?: {
      from: AgentRole;
      to: AgentRole;
      reason: string;
    };
  }>;
}

export interface RuntimeLead {
  id: string;
  name: string;
  phone: string;
  email: string;
  productInterest: string;
  leadScore: number;
  assignedAgent: AgentRole;
  status: RuntimeConversation["leadStatus"];
  notes: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  conversationId?: string;
}

export interface AnalyticsSummary {
  totalConversations: number;
  aiResponseRate: number;
  averageResponseTimeSeconds: number;
  leadConversion: number;
  salesInfluenced: number;
  mostActiveAgent: string;
  mostActiveAgentShare: number;
  agentActivity: Array<{ agent: string; conversations: number; share: number }>;
  topQuestions: Array<{ question: string; count: number }>;
  leadsCount: number;
  aiUsage: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    activeProvider: string;
    byProvider: Array<{
      provider: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      requests: number;
    }>;
  };
  billing?: {
    plan: string;
    planName: string;
    monthlyRecurringRevenue: number;
    subscriptionStatus: string;
    messagesUsed: number;
    messageLimit: number | null;
  };
}

export interface PageParams {
  limit?: number;
  cursor?: string | null;
  status?: string | null;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

function pageQuery(params: PageParams): string {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.status) query.set("status", params.status);
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export async function fetchConversationsPage(
  params: PageParams = {},
): Promise<PagedResult<RuntimeConversation>> {
  const data = await request(`/api/conversations${pageQuery(params)}`);
  return {
    items: (data.conversations as RuntimeConversation[]) ?? [],
    nextCursor: (data.nextCursor as string | null) ?? null,
    hasMore: Boolean(data.hasMore),
  };
}

export async function fetchConversations(): Promise<RuntimeConversation[]> {
  return (await fetchConversationsPage({ limit: 50 })).items;
}

export async function resolveConversation(conversationId: string): Promise<void> {
  await request(`/api/conversations/${conversationId}/resolve`, { method: "POST" });
}

export async function fetchLeadsPage(
  params: PageParams = {},
): Promise<PagedResult<RuntimeLead>> {
  const data = await request(`/api/leads${pageQuery(params)}`);
  return {
    items: (data.leads as RuntimeLead[]) ?? [],
    nextCursor: (data.nextCursor as string | null) ?? null,
    hasMore: Boolean(data.hasMore),
  };
}

export async function fetchLeads(): Promise<RuntimeLead[]> {
  return (await fetchLeadsPage({ limit: 50 })).items;
}

export async function fetchAnalyticsSummary(): Promise<AnalyticsSummary> {
  const data = await request("/api/analytics/summary");
  return data.summary as AnalyticsSummary;
}

export async function sendWorkspaceChat(input: {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  conversationId?: string;
  channel?: RuntimeConversation["channel"];
}): Promise<{
  reply: string;
  agent: AgentRole;
  intent: string;
  routing_reason: string;
  conversation_id?: string;
  mode: string;
  citations: Array<{ source: string; topic?: string }>;
  action_log: string[];
}> {
  const data = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      message: input.message,
      history: input.history ?? [],
      conversation_id: input.conversationId,
      channel: input.channel ?? "dashboard",
    }),
  });

  return {
    reply: String(data.reply ?? ""),
    agent: data.agent as AgentRole,
    intent: String(data.intent ?? "unknown"),
    routing_reason: String(data.routing_reason ?? ""),
    conversation_id:
      typeof data.conversation_id === "string" ? data.conversation_id : undefined,
    mode: String(data.mode ?? "demo"),
    citations: (data.citations as Array<{ source: string; topic?: string }>) ?? [],
    action_log: (data.action_log as string[]) ?? [],
  };
}
