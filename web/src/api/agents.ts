import { getStoredToken } from "../auth/api";
import type { AgentId, WorkspaceAgent } from "../auth/types";

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

export async function fetchAgents(): Promise<WorkspaceAgent[]> {
  const data = await request("/api/agents");
  return (data.agents as WorkspaceAgent[]) ?? [];
}

export async function updateAgent(
  id: AgentId,
  patch: { enabled?: boolean; notes?: string },
): Promise<WorkspaceAgent> {
  const data = await request(`/api/agents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.agent as WorkspaceAgent;
}

export async function testAgent(
  id: AgentId,
  message: string,
  options?: {
    conversationId?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  },
): Promise<{
  reply: string;
  mode: string;
  citations: Array<{ source: string; topic?: string }>;
  action_log: string[];
  handoff: unknown;
  routing_reason?: string;
  conversation_id?: string;
}> {
  const data = await request(`/api/agents/${id}/test`, {
    method: "POST",
    body: JSON.stringify({
      message,
      conversation_id: options?.conversationId,
      history: options?.history,
    }),
  });

  return {
    reply: String(data.reply ?? ""),
    mode: String(data.mode ?? "demo"),
    citations: (data.citations as Array<{ source: string; topic?: string }>) ?? [],
    action_log: (data.action_log as string[]) ?? [],
    handoff: data.handoff ?? null,
    routing_reason:
      typeof data.routing_reason === "string" ? data.routing_reason : undefined,
    conversation_id:
      typeof data.conversation_id === "string" ? data.conversation_id : undefined,
  };
}
