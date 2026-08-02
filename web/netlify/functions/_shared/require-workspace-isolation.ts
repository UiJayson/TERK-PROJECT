import type { Context } from "@netlify/functions";
import {
  jsonResponse,
  requireAuth,
  requireAuthWithWorkspaceAccess,
} from "./auth-http.ts";
import type { AuthenticatedSession } from "./auth-types.ts";
import { verifyWorkspaceAccess } from "./workspace-access.ts";

type NetlifyHandler = (req: Request, context: Context) => Promise<Response>;

function readWorkspaceIdFromUrl(req: Request): string | null {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);

  const workspaceIndex = segments.indexOf("workspaces");
  if (workspaceIndex >= 0 && segments[workspaceIndex + 1]) {
    return segments[workspaceIndex + 1];
  }

  const queryWorkspace = url.searchParams.get("workspaceId") ?? url.searchParams.get("workspace_id");
  return queryWorkspace?.trim() || null;
}

function readWorkspaceIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const value = record.workspaceId ?? record.workspace_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Verifies the JWT workspace claim matches the workspace_id used in the request.
 * Returns a 403 Response when isolation fails, otherwise null.
 */
export async function requireWorkspaceIsolation(
  req: Request,
  auth: AuthenticatedSession,
  explicitWorkspaceId?: string | null,
): Promise<Response | null> {
  const routeWorkspaceId = explicitWorkspaceId ?? readWorkspaceIdFromUrl(req);

  if (routeWorkspaceId && !verifyWorkspaceAccess(auth.workspace.id, routeWorkspaceId)) {
    return jsonResponse({ error: "Workspace access denied" }, { status: 403 });
  }

  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return null;
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return null;
    }

    const body = await req.clone().json();
    const bodyWorkspaceId = readWorkspaceIdFromBody(body);
    if (bodyWorkspaceId && !verifyWorkspaceAccess(auth.workspace.id, bodyWorkspaceId)) {
      return jsonResponse({ error: "Workspace access denied" }, { status: 403 });
    }
  } catch {
    // Non-JSON bodies are validated elsewhere.
  }

  return null;
}

/**
 * Netlify handler wrapper — auth + workspace isolation before running the handler.
 */
export function withWorkspaceIsolation(
  handler: NetlifyHandler,
  routeWorkspaceId?: string | null,
): NetlifyHandler {
  return async (req, context) => {
    const auth = await requireAuthWithWorkspaceAccess(req, routeWorkspaceId);
    if (auth instanceof Response) return auth;

    const denied = await requireWorkspaceIsolation(req, auth, routeWorkspaceId);
    if (denied) return denied;

    return handler(req, context);
  };
}

/**
 * Express-style alias for documentation/tests — returns 403 Response or null.
 */
export async function requireWorkspaceIsolationMiddleware(
  req: Request,
): Promise<{ auth: AuthenticatedSession } | Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const denied = await requireWorkspaceIsolation(req, auth);
  if (denied) return denied;

  return { auth };
}
