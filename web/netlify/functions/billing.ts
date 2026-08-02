import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import { getSiteUrl } from "./_shared/config.ts";
import {
  jsonResponse,
  optionsResponse,
  requireAuthWithWorkspaceAccess,
  withRole,
} from "./_shared/auth-http.ts";
import { PLANS, type PlanId } from "./_shared/billing-plans.ts";
import * as db from "./_shared/db.ts";
import {
  cancelSubscriptionAtPeriodEnd,
  createBillingPortalSession,
} from "./_shared/stripe-billing.ts";
import { disablePaystackSubscription } from "./_shared/paystack-billing.ts";
import { getUsageSnapshot } from "./_shared/usage-limits.ts";
import { handleBillingSubscribe } from "./_shared/billing-subscribe-handler.ts";

function billingOrigin(req: Request): string {
  return req.headers.get("origin") ?? getSiteUrl();
}

async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const segment = url.pathname.split("/").pop();

  try {
    if (req.method === "GET" && url.pathname === "/api/billing") {
      const billing = await db.getWorkspaceBilling(auth.workspace.id);
      const usage = await getUsageSnapshot(auth.workspace.id);
      const invoices = await db.listBillingInvoices(auth.workspace.id);
      const planId = (billing.plan as PlanId) in PLANS ? (billing.plan as PlanId) : "free";

      return jsonResponse({
        plan: planId,
        planDetails: PLANS[planId],
        subscriptionStatus: billing.subscriptionStatus,
        subscriptionPeriodEnd: billing.subscriptionPeriodEnd,
        usage,
        invoices,
        plans: Object.values(PLANS).filter((plan) => plan.id !== "free"),
      });
    }

    if (req.method === "POST" && segment === "subscribe") {
      return handleBillingSubscribe(req, auth);
    }

    if (req.method === "POST" && segment === "cancel") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const billing = await db.getWorkspaceBilling(auth.workspace.id);

      if (billing.paystackSubscriptionCode || billing.stripeSubscriptionId) {
        // Cancel at the payment provider FIRST — only flipping the local flag
        // left the provider subscription live and the customer kept being
        // charged after "cancelling".
        if (billing.stripeSubscriptionId) {
          await cancelSubscriptionAtPeriodEnd(billing.stripeSubscriptionId);
        }
        if (billing.paystackSubscriptionCode) {
          await disablePaystackSubscription(billing.paystackSubscriptionCode);
        }

        await db.updateWorkspaceBilling(auth.workspace.id, {
          subscriptionStatus: "canceling",
        });
        return jsonResponse({
          ok: true,
          message: "Subscription will cancel at the end of the billing period.",
        });
      }

      return jsonResponse({ error: "No active subscription to cancel." }, { status: 400 });
    }

    if (req.method === "POST" && segment === "portal") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const billing = await db.getWorkspaceBilling(auth.workspace.id);
      if (!billing.stripeCustomerId) {
        return jsonResponse(
          { error: "Billing portal is only available for Stripe subscriptions." },
          { status: 400 },
        );
      }

      const url = await createBillingPortalSession({
        customerId: billing.stripeCustomerId,
        returnUrl: `${billingOrigin(req)}/app/billing`,
      });

      return jsonResponse({ url });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("billing.ts request failed:", error);
    const message = publicErrorMessage(error, "Request failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: [
    "/api/billing",
    "/api/billing/cancel",
    "/api/billing/portal",
    "/api/billing/subscribe",
  ],
};

export default withObservability(handler);
