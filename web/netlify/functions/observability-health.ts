import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess, withRole } from "./_shared/auth-http.ts";
import { isAdminAuthorized } from "./_shared/admin-auth.ts";
import * as db from "./_shared/db.ts";

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const admin = url.pathname.includes("/admin/health");
    const hours = Number(url.searchParams.get("hours") ?? "24");

    if (admin) {
      // Platform-wide dashboard (workspace count, MRR, cross-tenant error
      // feed) — platform-operator token only, never a workspace role.
      if (!isAdminAuthorized(req)) {
        return jsonResponse({ error: "Unauthorized" }, { status: 401 });
      }
      const dashboard = await db.getAdminHealthDashboard(hours);
      return jsonResponse({ dashboard, generatedAt: new Date().toISOString() });
    }

    const auth = await requireAuthWithWorkspaceAccess(req);
    if (auth instanceof Response) return auth;

    const denied = withRole(auth, ["owner"]);
    if (denied) return denied;

    const summary = await db.getObservabilityHealthSummary(hours, auth.workspace.id);
    return jsonResponse({ summary, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("observability-health.ts request failed:", error);
    const message = publicErrorMessage(error, "Request failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
}

export const config: Config = {
  path: ["/api/observability/health", "/api/admin/health"],
};

export default withObservability(handler);
