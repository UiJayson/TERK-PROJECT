import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { createSessionToken } from "./_shared/auth-crypto.ts";
import {
  authSuccessResponse,
  jsonResponse,
  optionsResponse,
  requireAuth,
} from "./_shared/auth-http.ts";
import { findUserById } from "./_shared/auth-store.ts";

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const result = await requireAuth(req);
  if (result instanceof Response) return result;

  // Sliding session: re-issue a fresh short-lived token on every session
  // check so active users stay signed in while idle tokens expire in 24h.
  const user = await findUserById(result.user.id);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await createSessionToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    workspaceId: result.workspace.id,
    role: result.role,
    sessionVersion: user.sessionVersion,
  });

  return authSuccessResponse(result, token);
};

export const config: Config = {
  path: "/api/auth/me",
};

export default withObservability(handler);
