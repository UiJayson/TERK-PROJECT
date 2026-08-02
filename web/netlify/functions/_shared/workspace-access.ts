import { jsonResponse } from "./auth-http.ts";
import type { AuthenticatedSession } from "./auth-types.ts";

function readWorkspaceIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const value = record.workspaceId ?? record.workspace_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function verifyWorkspaceAccess(
  sessionWorkspaceId: string,
  requestedWorkspaceId: string | null | undefined,
): boolean {
  if (!requestedWorkspaceId) return true;
  return requestedWorkspaceId === sessionWorkspaceId;
}

export function requireWorkspaceAccess(
  session: AuthenticatedSession,
  requestedWorkspaceId?: string | null,
): Response | null {
  if (!verifyWorkspaceAccess(session.workspace.id, requestedWorkspaceId)) {
    return jsonResponse({ error: "Forbidden — workspace access denied." }, { status: 403 });
  }
  return null;
}

export async function enforceWorkspaceAccess(
  req: Request,
  session: AuthenticatedSession,
  routeWorkspaceId?: string | null,
): Promise<Response | null> {
  const denied = requireWorkspaceAccess(session, routeWorkspaceId);
  if (denied) return denied;

  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return null;
  }

  try {
    const clone = req.clone();
    const contentType = clone.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return null;
    }
    const body = await clone.json();
    const bodyWorkspaceId = readWorkspaceIdFromBody(body);
    return requireWorkspaceAccess(session, bodyWorkspaceId);
  } catch {
    return null;
  }
}
