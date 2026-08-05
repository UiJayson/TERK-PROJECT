import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import {
  jsonResponse,
  optionsResponse,
  requireAuthWithWorkspaceAccess,
  withRole,
} from "./_shared/auth-http.ts";
import {
  checkDeploymentGate,
  goLive,
  moveToStaging,
} from "./_shared/onboarding/deployment/gate-checker.ts";
import {
  listKbVersions,
  rollbackKbVersion,
} from "./_shared/onboarding/versioning/kb-version-manager.ts";
import { routeQuery } from "./_shared/onboarding/retrieval/router.ts";

/**
 * Deployment gate + KB versioning + retrieval-query API (Problem 3 §Step 5, 6
 * and §Step 3). The gate is enforced HERE at the API — the UI cannot bypass it.
 */
async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;
  const workspaceId = auth.workspace.id;
  const action = context.params?.action;

  try {
    // GET /api/deployment/gate  — full gate status
    if (req.method === "GET" && (!action || action === "gate" || action === "gate-status")) {
      const gate = await checkDeploymentGate(workspaceId);
      return jsonResponse({ gate });
    }

    // GET /api/deployment/versions  — KB version history
    if (req.method === "GET" && action === "versions") {
      const versions = await listKbVersions(workspaceId);
      return jsonResponse({ versions });
    }

    // POST /api/deployment/go-live
    if (req.method === "POST" && (action === "go-live" || action === "golive")) {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;
      const gate = await goLive(workspaceId);
      if (!gate.canGoLive) {
        // 409: not a warning, a hard lock.
        return jsonResponse(
          { error: "DEPLOYMENT_GATE_BLOCKED", gate },
          { status: 409 },
        );
      }
      return jsonResponse({ ok: true, gate });
    }

    // POST /api/deployment/staging
    if (req.method === "POST" && action === "staging") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;
      await moveToStaging(workspaceId);
      const gate = await checkDeploymentGate(workspaceId);
      return jsonResponse({ ok: true, gate });
    }

    // POST /api/deployment/rollback  { version }
    if (req.method === "POST" && action === "rollback") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;
      const body = (await req.json().catch(() => ({}))) as { version?: number };
      if (typeof body.version !== "number") {
        return jsonResponse({ error: "version is required" }, { status: 400 });
      }
      await rollbackKbVersion(workspaceId, body.version);
      const versions = await listKbVersions(workspaceId);
      return jsonResponse({ ok: true, versions });
    }

    // POST /api/deployment/query  { message, conversationId? }
    // Exposes the two-track retrieval directly, primarily for testing/debug and
    // for the staging UI's "try a question" flow.
    if (req.method === "POST" && (action === "query" || action === "retrieval")) {
      const body = (await req.json().catch(() => ({}))) as {
        message?: string;
        conversationId?: string;
      };
      if (!body.message?.trim()) {
        return jsonResponse({ error: "message is required" }, { status: 400 });
      }
      const answer = await routeQuery({
        workspaceId,
        message: body.message,
        conversationId: body.conversationId,
      });
      return jsonResponse({ answer });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("deployment.ts request failed:", error);
    return jsonResponse({ error: publicErrorMessage(error, "Request failed") }, { status: 500 });
  }
}

export const config: Config = {
  path: [
    "/api/deployment",
    "/api/deployment/:action",
    "/api/retrieval/query",
  ],
};

export default withObservability(handler);
