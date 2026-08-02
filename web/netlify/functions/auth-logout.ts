import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { logoutResponse, optionalAuth, optionsResponse, jsonResponse } from "./_shared/auth-http.ts";
import { incrementUserSessionVersion } from "./_shared/db.ts";
import { log } from "./_shared/logger.ts";

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  // Revoke server-side, not just clear the cookie: bumping sessionVersion
  // invalidates every outstanding JWT for this user (including copies in
  // localStorage or stolen tokens).
  const auth = await optionalAuth(req);
  if (auth) {
    await incrementUserSessionVersion(auth.user.id);
    log.info("auth_logout", { function: "auth-logout", userId: auth.user.id });
  }

  return logoutResponse();
};

export const config: Config = {
  path: "/api/auth/logout",
};

export default withObservability(handler);
