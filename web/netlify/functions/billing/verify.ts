import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "../_shared/db-errors.ts";
import { createId } from "../_shared/auth-crypto.ts";
import { withObservability } from "../_shared/observability.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess } from "../_shared/auth-http.ts";
import { type PlanId } from "../_shared/billing-plans.ts";
import * as db from "../_shared/db.ts";
import { isPaystackConfigured, verifyTransaction } from "../_shared/paystack-billing.ts";

function periodEndIso(months = 1): string {
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  return end.toISOString();
}

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  if (!isPaystackConfigured()) {
    return jsonResponse({ error: "Paystack is not configured." }, { status: 503 });
  }

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const reference = url.searchParams.get("reference")?.trim();
  if (!reference) {
    return jsonResponse({ error: "reference query param is required." }, { status: 400 });
  }

  try {
    const verified = await verifyTransaction(reference);
    if (verified.status !== "success") {
      return jsonResponse({ error: "Payment not successful.", status: verified.status }, { status: 402 });
    }

    const workspaceId = verified.workspaceId ?? auth.workspace.id;
    if (workspaceId !== auth.workspace.id) {
      return jsonResponse({ error: "Workspace mismatch." }, { status: 403 });
    }

    const plan = (verified.planId ?? "starter") as PlanId;

    await db.updateWorkspaceBilling(workspaceId, {
      plan,
      subscriptionStatus: "active",
      subscriptionPeriodEnd: periodEndIso(),
      paystackCustomerCode: verified.customerCode,
      paystackSubscriptionCode: verified.subscriptionCode,
    });

    await db.upsertBillingInvoice({
      id: createId("inv"),
      workspaceId,
      stripeInvoiceId: `paystack_${reference}`,
      amountCents: Math.round(verified.amount / 100),
      currency: "ngn",
      status: "paid",
      periodStart: new Date().toISOString(),
      periodEnd: periodEndIso(),
    });

    return jsonResponse({
      ok: true,
      reference,
      plan,
      subscriptionStatus: "active",
    });
  } catch (error) {
    console.error("billing/verify.ts request failed:", error);
    const message = publicErrorMessage(error, "Verify failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
}

export const config: Config = {
  path: "/.netlify/functions/billing/verify",
};

export default withObservability(handler);
