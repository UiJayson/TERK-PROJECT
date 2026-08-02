import {
  clearSessionCookieHeader,
  readSessionToken,
  sessionCookieHeader,
  verifySessionToken,
} from "./auth-crypto.ts";
import { findUserById, findWorkspaceById, getWorkspaceRoleForUser } from "./auth-store.ts";
import type {
  AuthenticatedSession,
  AuthResponse,
  PublicUser,
  PublicWorkspace,
  WorkspaceRecord,
  WorkspaceRole,
} from "./auth-types.ts";
import { enforceWorkspaceAccess } from "./workspace-access.ts";
import { setObservabilityContext } from "./observability.ts";

/**
 * Authenticated dashboard APIs are same-origin, so CORS only needs to admit
 * the site's own origin — never a wildcard (which is also invalid alongside
 * Allow-Credentials). The public chat endpoint sets its own `*` headers.
 *
 * Read straight from env (not getConfig) so producing a response never
 * depends on full config validation / DB availability.
 */
function resolveSiteOrigin(): string | null {
  const raw =
    process.env.URL ??
    process.env.DEPLOY_PRIME_URL ??
    process.env.SITE_URL ??
    null;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production" || process.env.CONTEXT === "production";
}

function corsHeaders(): Record<string, string> {
  const siteOrigin = isProductionEnv() ? resolveSiteOrigin() : null;
  const origin = siteOrigin ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ...(origin === "*" ? {} : { "Access-Control-Allow-Credentials": "true", Vary: "Origin" }),
  };
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: {
      ...corsHeaders(),
      ...(init.headers ?? {}),
    },
  });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function toPublicUser(user: { id: string; email: string; name: string }): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

export function toPublicWorkspace(workspace: WorkspaceRecord): PublicWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    ownerId: workspace.ownerId,
    createdAt: workspace.createdAt,
    publicKey: workspace.publicKey,
    resources: workspace.resources,
    agentConfigs: workspace.agentConfigs ?? [],
  };
}

export function authSuccessResponse(
  payload: AuthResponse,
  token: string,
): Response {
  return jsonResponse(
    { ...payload, token },
    {
      headers: {
        "Set-Cookie": sessionCookieHeader(token),
      },
    },
  );
}

export function logoutResponse() {
  return jsonResponse(
    { ok: true },
    {
      headers: {
        "Set-Cookie": clearSessionCookieHeader(),
      },
    },
  );
}

export async function optionalAuth(req: Request): Promise<AuthenticatedSession | null> {
  const token = readSessionToken(req);
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session) return null;

  const user = await findUserById(session.sub);
  const workspace = await findWorkspaceById(session.workspaceId);

  if (!user || !workspace || !user.workspaceIds.includes(workspace.id)) {
    return null;
  }

  if (session.sessionVersion !== user.sessionVersion) {
    return null;
  }

  const role = await getWorkspaceRoleForUser(workspace.id, user.id, workspace.ownerId);

  if (session.role !== role) {
    // Role changed since token was issued — require re-login.
    return null;
  }

  const auth = {
    user: toPublicUser(user),
    workspace: toPublicWorkspace(workspace),
    role,
  };
  attachObservabilityContext(auth);
  return auth;
}

function attachObservabilityContext(auth: AuthenticatedSession): void {
  setObservabilityContext({
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
  });
}

export async function requireAuth(req: Request): Promise<AuthenticatedSession | Response> {
  const auth = await optionalAuth(req);
  if (!auth) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  attachObservabilityContext(auth);
  return auth;
}

export async function requireAuthWithWorkspaceAccess(
  req: Request,
  routeWorkspaceId?: string | null,
): Promise<AuthenticatedSession | Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const denied = await enforceWorkspaceAccess(req, auth, routeWorkspaceId);
  if (denied) return denied;

  return auth;
}

export { requireWorkspaceIsolation, withWorkspaceIsolation } from "./require-workspace-isolation.ts";

export function withRole(
  auth: AuthenticatedSession,
  allowed: readonly WorkspaceRole[],
): Response | null {
  if (!allowed.includes(auth.role)) {
    return jsonResponse({ error: "Forbidden — insufficient permissions." }, { status: 403 });
  }
  return null;
}
