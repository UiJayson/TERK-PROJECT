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
  getWizardStatus,
  submitSection,
  type WizardSectionPayload,
} from "./_shared/onboarding/wizard/wizard-controller.ts";
import {
  getBusinessProfile,
  getOperatingHours,
  listEscalationContacts,
  listPolicyRecords,
  listPricingItems,
} from "./_shared/onboarding/business-store.ts";

/**
 * Onboarding wizard API (Problem 3 §Step 1). All routes are workspace-scoped
 * to the caller's session; a body `tenantId` mismatch is rejected. Writes
 * require owner/admin.
 */
async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;
  const workspaceId = auth.workspace.id;
  const action = context.params?.action;

  try {
    // GET /api/onboarding/status
    if (req.method === "GET" && (!action || action === "status")) {
      const [status, profile, hours, prices, policies, escalations] = await Promise.all([
        getWizardStatus(workspaceId),
        getBusinessProfile(workspaceId),
        getOperatingHours(workspaceId),
        listPricingItems(workspaceId),
        listPolicyRecords(workspaceId),
        listEscalationContacts(workspaceId),
      ]);
      return jsonResponse({
        status,
        data: { profile, hours, prices, policies, escalations },
      });
    }

    // POST /api/onboarding/submit  { section, data }
    if (req.method === "POST" && action === "submit") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json().catch(() => ({}))) as {
        section?: string;
        data?: unknown;
      };
      if (!body.section) {
        return jsonResponse({ error: "section is required" }, { status: 400 });
      }
      const payload = { section: body.section, data: body.data } as WizardSectionPayload;
      const status = await submitSection(workspaceId, payload);
      return jsonResponse({ ok: true, status });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    if (message.startsWith("WIZARD_INVALID:")) {
      return jsonResponse({ error: message }, { status: 400 });
    }
    console.error("onboarding.ts request failed:", error);
    return jsonResponse({ error: publicErrorMessage(error, "Request failed") }, { status: 500 });
  }
}

export const config: Config = {
  path: [
    "/api/onboarding",
    "/api/onboarding/:action",
    "/api/onboarding/wizard/:action",
  ],
};

export default withObservability(handler);
