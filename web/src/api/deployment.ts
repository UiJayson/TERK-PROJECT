import { getStoredToken } from "../auth/api";

export interface DeploymentGate {
  canGoLive: boolean;
  status: "draft" | "staging" | "live";
  wizardComplete: boolean;
  wizardMissing: string[];
  contradictionCount: number;
  validationPassRate: number;
  passRateThreshold: number;
  criticalCategoriesVerified: string[];
  criticalCategoriesMissing: string[];
  escalationContactCount: number;
  reasons: string[];
  lastCheckedAt: string;
}

export interface KbVersion {
  id: number;
  versionNumber: number;
  publishedAt: string;
  isActive: boolean;
  notes: string | null;
}

export interface RetrievalAnswer {
  track: "structured" | "vector" | "fallback";
  answer: string;
  source: string;
  confidence: number;
  category?: string;
  kbVersion: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new Error(typeof data.error === "string" ? data.error : `Request failed (${response.status})`);
  }
  return data as T;
}

export async function fetchGateStatus(): Promise<{ gate: DeploymentGate }> {
  return request("/api/deployment/gate");
}

export async function fetchKbVersions(): Promise<{ versions: KbVersion[] }> {
  return request("/api/deployment/versions");
}

export async function goLive(): Promise<{ gate: DeploymentGate }> {
  const token = getStoredToken();
  const response = await fetch("/api/deployment/go-live", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  // 409 returns the gate so we can show the reasons; treat as data, not error.
  if (response.status === 409) return { gate: (data.gate as DeploymentGate) };
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as { gate: DeploymentGate };
}

export async function rollbackKb(version: number): Promise<{ versions: KbVersion[] }> {
  return request("/api/deployment/rollback", {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

export async function tryRetrieval(message: string): Promise<{ answer: RetrievalAnswer }> {
  return request("/api/deployment/query", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}
