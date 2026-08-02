import type { Config, Context } from "@netlify/functions";
import { createId } from "../_shared/auth-crypto.ts";
import { withObservability } from "../_shared/observability.ts";
import { jsonResponse } from "../_shared/auth-http.ts";
import { type PlanId } from "../_shared/billing-plans.ts";
import * as db from "../_shared/db.ts";
import {
  mapPaystackSubscriptionStatus,
  planFromPaystackMetadata,
  verifyPaystackWebhookSignature,
} from "../_shared/paystack-billing.ts";
import { log } from "../_shared/logger.ts";

interface PaystackEvent {
  event: string;
  data: Record<string, unknown>;
}

function periodEndIso(months = 1): string {
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  return end.toISOString();
}

async function resolveWorkspaceId(data: Record<string, unknown>): Promise<string | null> {
  const metadata = data.metadata as Record<string, unknown> | undefined;
  if (typeof metadata?.workspace_id === "string") return metadata.workspace_id;

  const customer = data.customer as { customer_code?: string } | undefined;
  if (customer?.customer_code) {
    return db.getWorkspaceIdByPaystackCustomerCode(customer.customer_code);
  }

  const subscriptionCode =
    typeof data.subscription_code === "string"
      ? data.subscription_code
      : typeof data.subscription === "object" && data.subscription
        ? String((data.subscription as { subscription_code?: string }).subscription_code ?? "")
        : null;

  if (subscriptionCode) {
    return db.getWorkspaceIdByPaystackSubscriptionCode(subscriptionCode);
  }

  return null;
}

async function applyChargeSuccess(data: Record<string, unknown>): Promise<void> {
  const workspaceId = await resolveWorkspaceId(data);
  if (!workspaceId) return;

  const metadata = data.metadata as Record<string, unknown> | undefined;
  const plan = planFromPaystackMetadata(metadata) ?? "starter";
  const customer = data.customer as { customer_code?: string } | undefined;
  const reference = String(data.reference ?? createId("pay"));

  await db.updateWorkspaceBilling(workspaceId, {
    plan,
    subscriptionStatus: "active",
    subscriptionPeriodEnd: periodEndIso(),
    paystackCustomerCode: customer?.customer_code ?? null,
  });

  await db.upsertBillingInvoice({
    id: createId("inv"),
    workspaceId,
    stripeInvoiceId: `paystack_${reference}`,
    amountCents: Math.round(Number(data.amount ?? 0) / 100),
    currency: String(data.currency ?? "ngn"),
    status: "paid",
    periodStart: new Date().toISOString(),
    periodEnd: periodEndIso(),
  });
}

async function applySubscriptionEvent(
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const workspaceId = await resolveWorkspaceId(data);
  if (!workspaceId) return;

  const metadata = data.metadata as Record<string, unknown> | undefined;
  const plan = planFromPaystackMetadata(metadata) ?? undefined;
  const status = mapPaystackSubscriptionStatus(event, String(data.status ?? ""));

  await db.updateWorkspaceBilling(workspaceId, {
    ...(plan ? { plan } : {}),
    subscriptionStatus: status,
    subscriptionPeriodEnd:
      event === "subscription.disable" ? new Date().toISOString() : periodEndIso(),
    paystackSubscriptionCode:
      typeof data.subscription_code === "string" ? data.subscription_code : null,
    ...(status === "canceled" ? { plan: "free" } : {}),
  });
}

async function handler(req: Request, _context: Context) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!verifyPaystackWebhookSignature(rawBody, signature)) {
    return jsonResponse({ error: "Invalid signature" }, { status: 400 });
  }

  let event: PaystackEvent;
  try {
    event = JSON.parse(rawBody) as PaystackEvent;
  } catch {
    return jsonResponse({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    switch (event.event) {
      case "charge.success":
        await applyChargeSuccess(event.data);
        break;
      case "subscription.create":
        await applySubscriptionEvent(event.event, event.data);
        break;
      case "subscription.disable":
        await applySubscriptionEvent(event.event, event.data);
        break;
      default:
        log.info("paystack_webhook_ignored", { action: event.event });
        break;
    }

    return jsonResponse({ received: true });
  } catch (error) {
    log.error("paystack_webhook_failed", {
      error: error instanceof Error ? error.message : "handler failed",
    });
    return jsonResponse({ error: "Webhook handler failed" }, { status: 500 });
  }
}

export const config: Config = {
  path: "/.netlify/functions/billing/webhook",
};

export default withObservability(handler);
