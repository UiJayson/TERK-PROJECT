import { getStoredToken } from "../auth/api";

export interface ValidationQuestion {
  id: string;
  question: string;
  category: string;
  aiAnswer: string | null;
  aiAnswerSource: string | null;
  status: "pending" | "correct" | "incorrect" | "needs_improvement";
  correctedAnswer: string | null;
  reviewedAt: string | null;
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

export async function fetchValidationQuestions(): Promise<{ questions: ValidationQuestion[] }> {
  return request("/api/validation/questions");
}

export async function regenerateValidationQuestions(): Promise<{ questions: ValidationQuestion[] }> {
  return request("/api/validation/regenerate", { method: "POST" });
}

export async function reviewValidationAnswer(
  questionId: string,
  status: "correct" | "incorrect" | "needs_improvement",
  correctedAnswer?: string,
): Promise<{ question: ValidationQuestion }> {
  return request(`/api/validation/answer/${questionId}`, {
    method: "POST",
    body: JSON.stringify({ status, correctedAnswer }),
  });
}
