import { getStoredToken } from "../auth/api";

export interface WizardStatus {
  complete: boolean;
  sectionsComplete: string[];
  sectionsMissing: string[];
}

export interface OnboardingData {
  profile: {
    workspaceId: string;
    businessName: string;
    industry: string;
    supportEmail: string;
    phone: string;
    timezone: string;
  } | null;
  hours: Array<{
    id: string;
    dayOfWeek: number;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
    isHoliday: boolean;
    holidayLabel: string | null;
  }>;
  prices: Array<{
    id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    discountPercent: number | null;
    isActive: boolean;
  }>;
  policies: Array<{
    id: string;
    policyType: string;
    ruleText: string;
    windowDays: number | null;
    effectiveDate: string | null;
  }>;
  escalations: Array<{
    id: string;
    role: string;
    name: string;
    email: string;
    phone: string;
  }>;
}

export interface UploadedDocument {
  id: string;
  filename: string;
  fileType: string;
  byteSize: number | null;
  uploadStatus: string;
  contradictionStatus: string;
  errorMessage: string | null;
  uploadedAt: string;
}

export interface FlaggedChunk {
  id: string;
  chunkText: string;
  category: string;
  contradictionDetail: string | null;
  filename?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : `Request failed (${response.status})`,
    );
  }
  return data as T;
}

export async function fetchOnboarding(): Promise<{ status: WizardStatus; data: OnboardingData }> {
  return request("/api/onboarding/status");
}

export async function submitOnboardingSection(
  section: string,
  data: unknown,
): Promise<{ status: WizardStatus }> {
  return request("/api/onboarding/submit", {
    method: "POST",
    body: JSON.stringify({ section, data }),
  });
}

export async function uploadDocument(file: File): Promise<{ result: { document: UploadedDocument; chunksTotal: number; chunksIngested: number; chunksFlagged: number } }> {
  const form = new FormData();
  form.append("file", file);
  return request("/api/knowledge-onboarding/upload", { method: "POST", body: form });
}

export async function listDocuments(): Promise<{ documents: UploadedDocument[] }> {
  return request("/api/knowledge-onboarding/documents");
}

export async function listContradictions(): Promise<{ chunks: FlaggedChunk[] }> {
  return request("/api/knowledge-onboarding/contradictions");
}

export async function resolveContradiction(
  chunkId: string,
  action: "confirm" | "discard" | "edit",
  correctedText?: string,
): Promise<{ remaining: FlaggedChunk[] }> {
  return request("/api/knowledge-onboarding/resolve", {
    method: "POST",
    body: JSON.stringify({ chunkId, action, correctedText }),
  });
}
