import { getStoredToken } from "../auth/api";

export interface ObservabilityHealthSummary {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  ai: { count: number; avgMs: number; p95Ms: number };
  db: { count: number; avgMs: number; p95Ms: number };
  webhook: { count: number; avgMs: number; failures: number };
}

export interface AdminHealthDashboard {
  totalWorkspaces: number;
  activeConversationsToday: number;
  avgAiLatencyMs: number;
  errorRate: number;
  webhookSuccessRate: number;
  topErrors: Array<{ endpoint: string; count: number; lastSeen: string }>;
  summary: ObservabilityHealthSummary;
}

export async function fetchObservabilityHealth(): Promise<{
  summary: ObservabilityHealthSummary;
  generatedAt: string;
}> {
  const token = getStoredToken();
  const response = await fetch("/api/observability/health", {
    credentials: "include",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = (await response.json()) as {
    summary?: ObservabilityHealthSummary;
    generatedAt?: string;
    error?: string;
  };
  if (!response.ok || !data.summary) {
    throw new Error(data.error ?? "Could not load system health");
  }
  return { summary: data.summary, generatedAt: data.generatedAt ?? new Date().toISOString() };
}

export async function fetchAdminHealth(): Promise<{
  dashboard: AdminHealthDashboard;
  generatedAt: string;
}> {
  const token = getStoredToken();
  const response = await fetch("/api/admin/health", {
    credentials: "include",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = (await response.json()) as {
    dashboard?: AdminHealthDashboard;
    generatedAt?: string;
    error?: string;
  };
  if (!response.ok || !data.dashboard) {
    throw new Error(data.error ?? "Could not load admin health");
  }
  return {
    dashboard: data.dashboard,
    generatedAt: data.generatedAt ?? new Date().toISOString(),
  };
}
