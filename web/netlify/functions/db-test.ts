import type { Config, Context } from "@netlify/functions";
import { isProduction } from "./_shared/config.ts";
import { isAdminAuthorized } from "./_shared/admin-auth.ts";
import { dbErrorToResponse, runDbConnectivityTest } from "./_shared/db.ts";
import { jsonResponse, optionsResponse } from "./_shared/auth-http.ts";

function isAuthorized(req: Request): boolean {
  if (!isProduction()) return true;
  return isAdminAuthorized(req);
}

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  if (!isAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDbConnectivityTest();
    return Response.json(result, { status: result.success ? 200 : 503 });
  } catch (error) {
    return dbErrorToResponse(error);
  }
}

export const config: Config = {
  path: "/.netlify/functions/db-test",
};

export default handler;
