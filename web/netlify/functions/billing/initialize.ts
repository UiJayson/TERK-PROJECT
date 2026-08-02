import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "../_shared/db-errors.ts";
import { withObservability } from "../_shared/observability.ts";
import { getSiteUrl } from "../_shared/config.ts";
import {
  jsonResponse,
  optionsResponse,
  requireAuthWithWorkspaceAccess,
  withRole,
} from "../_shared/auth-http.ts";
import { findUserById } from "../_shared/auth-store.ts";
import { isPlanId, PAID_PLANS, type PlanId } from "../_shared/billing-plans.ts";
import {
  initializeTransaction,
  isPaystackConfigured,
} from "../_shared/paystack-billing.ts";

function billingOrigin(req: Request): string {
  return req.headers.get("origin") ?? getSiteUrl();
}

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  if (!isPaystackConfigured()) {
    return jsonResponse({ error: "Paystack is not configured." }, { status: 503 });
  }

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const denied = withRole(auth, ["owner", "admin"]);
  if (denied) return denied;

  try {
    const body = (await req.json()) as { plan?: string; email?: string; workspaceId?: string };
    const planId = (body.plan?.trim() ?? "") as PlanId;
    const workspaceId = body.workspaceId?.trim() || auth.workspace.id;

    if (workspaceId !== auth.workspace.id) {
      return jsonResponse({ error: "Workspace mismatch." }, { status: 403 });
    }

    if (!isPlanId(planId) || !PAID_PLANS.includes(planId)) {
      return jsonResponse({ error: "Invalid plan." }, { status: 400 });
    }

    const user = await findUserById(auth.user.id);
    const email = body.email?.trim() || user?.email;
    if (!email) {
      return jsonResponse({ error: "Email is required." }, { status: 400 });
    }

    const origin = billingOrigin(req);
    const result = await initializeTransaction({
      email,
      planId,
      workspaceId,
      callbackUrl: `${origin}/app/billing?checkout=success`,
    });

    return jsonResponse({
      authorization_url: result.authorizationUrl,
      reference: result.reference,
    });
  } catch (error) {
    console.error("billing/initialize.ts request failed:", error);
    const message = publicErrorMessage(error, "Initialize failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
}

export const config: Config = {
  path: "/.netlify/functions/billing/initialize",
};

export default withObservability(handler);
