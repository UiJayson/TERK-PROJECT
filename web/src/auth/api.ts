import type { AuthSession, WorkspaceRole } from "./types";

const TOKEN_KEY = "aios_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function parseJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function authHeaders(): HeadersInit {
  const token = getStoredToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function authRequest(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeoutMs = 12_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      ...init,
      signal: init.signal ?? controller.signal,
      credentials: "include",
      headers: {
        ...authHeaders(),
        ...(init.headers ?? {}),
      },
    });

    const data = (await parseJson(response)) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        status: 408,
        data: { error: "Request timed out. Please check your connection and try again." },
      };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function asSession(data: Record<string, unknown>): AuthSession | null {
  if (!data.user || !data.workspace) return null;
  const role = data.role;
  const normalizedRole: WorkspaceRole =
    role === "owner" || role === "admin" || role === "staff" ? role : "owner";
  return {
    user: data.user as AuthSession["user"],
    workspace: data.workspace as AuthSession["workspace"],
    role: normalizedRole,
  };
}

export async function registerAccount(input: {
  name: string;
  email: string;
  password: string;
  companyName: string;
}): Promise<AuthSession> {
  const { ok, data } = await authRequest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (!ok) {
    throw new Error(String(data.error ?? "Registration failed"));
  }

  const session = asSession(data);
  if (!session) throw new Error("Invalid registration response");
  if (typeof data.token === "string") setStoredToken(data.token);
  return session;
}

export async function loginAccount(input: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  const { ok, data } = await authRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (!ok) {
    throw new Error(String(data.error ?? "Login failed"));
  }

  const session = asSession(data);
  if (!session) throw new Error("Invalid login response");
  if (typeof data.token === "string") setStoredToken(data.token);
  return session;
}

export async function logoutAccount(): Promise<void> {
  await authRequest("/api/auth/logout", { method: "POST" });
  setStoredToken(null);
}

export async function fetchSession(): Promise<AuthSession | null> {
  const { ok, data } = await authRequest("/api/auth/me");
  if (!ok) return null;
  // The server re-issues a fresh token on each session check (sliding
  // session) — adopt it so the stored token never goes stale.
  if (typeof data.token === "string") setStoredToken(data.token);
  return asSession(data);
}

export async function requestPasswordReset(email: string): Promise<{
  message: string;
  resetUrl?: string;
}> {
  const { ok, data } = await authRequest("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

  if (!ok) {
    throw new Error(String(data.error ?? "Request failed"));
  }

  return {
    message: String(data.message ?? "Check your email for reset instructions."),
    resetUrl: typeof data.resetUrl === "string" ? data.resetUrl : undefined,
  };
}

export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<string> {
  const { ok, data } = await authRequest("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (!ok) {
    throw new Error(String(data.error ?? "Reset failed"));
  }

  setStoredToken(null);
  return String(data.message ?? "Password updated.");
}
