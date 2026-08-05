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
  ensureKernelBooted,
  getAvailableModules,
  getModule,
  installModuleForTenant,
  listInstalledModules,
  uninstallModuleForTenant,
  UnknownModuleError,
} from "./_shared/kernel/index.ts";

/**
 * Module management API (spec §API Design). The tenant is ALWAYS the
 * authenticated session's workspace — a client-supplied tenantId is validated
 * against it, never trusted, consistent with the app-layer isolation model.
 */
async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  ensureKernelBooted();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const workspaceId = auth.workspace.id;
  const a = context.params?.a;
  const b = context.params?.b;

  try {
    // GET /api/modules  |  GET /api/modules/available
    if (req.method === "GET" && (!a || a === "available")) {
      return jsonResponse({ modules: getAvailableModules() });
    }

    // GET /api/modules/installed  |  GET /api/modules/installed/:tenantId
    if (req.method === "GET" && a === "installed") {
      if (b && b !== workspaceId) {
        return jsonResponse({ error: "Forbidden: tenant mismatch." }, { status: 403 });
      }
      const installed = await listInstalledModules(workspaceId);
      return jsonResponse({ installed });
    }

    // GET /api/modules/:moduleId/capabilities
    if (req.method === "GET" && a && b === "capabilities") {
      const adapter = getModule(a);
      if (!adapter) {
        return jsonResponse({ error: `Unknown module "${a}".` }, { status: 404 });
      }
      return jsonResponse({ moduleId: a, capabilities: adapter.getCapabilities() });
    }

    // POST /api/modules/install    { moduleId }
    // POST /api/modules/uninstall  { moduleId }
    if (req.method === "POST" && (a === "install" || a === "uninstall")) {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json().catch(() => ({}))) as {
        moduleId?: string;
        tenantId?: string;
      };
      const moduleId = body.moduleId?.trim();
      if (!moduleId) {
        return jsonResponse({ error: "moduleId is required." }, { status: 400 });
      }
      if (body.tenantId && body.tenantId !== workspaceId) {
        return jsonResponse({ error: "Forbidden: tenant mismatch." }, { status: 403 });
      }

      const result =
        a === "install"
          ? await installModuleForTenant(workspaceId, moduleId)
          : await uninstallModuleForTenant(workspaceId, moduleId);

      const installed = await listInstalledModules(workspaceId);
      return jsonResponse({ ok: true, action: a, result, installed });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof UnknownModuleError) {
      return jsonResponse({ error: error.message }, { status: 404 });
    }
    console.error("modules.ts request failed:", error);
    return jsonResponse({ error: publicErrorMessage(error, "Request failed") }, { status: 500 });
  }
}

export const config: Config = {
  path: ["/api/modules", "/api/modules/:a", "/api/modules/:a/:b"],
};

export default withObservability(handler);
