import type { Config, Context } from "@netlify/functions";
import { withObservability } from "../../_shared/observability.ts";
import { createId } from "../../_shared/auth-crypto.ts";
import { jsonResponse } from "../../_shared/auth-http.ts";
import { type PlanId } from "../../_shared/billing-plans.ts";
import * as db from "../../_shared/db.ts";
import {
  extractPlanFromSubscription,
  mapStripeSubscriptionStatus,
  verifyStripeWebhookSignature,
} from "../../_shared/stripe-billing.ts";

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

function periodEndIso(timestamp: unknown): string | null {
  if (typeof timestamp !== "number") return null;
  return new Date(timestamp * 1000).toISOString();
}

async function resolveWorkspaceId(object: Record<string, unknown>): Promise<string | null> {
  const metadata = object.metadata as Record<string, string> | undefined;
  if (metadata?.workspace_id) return metadata.workspace_id;

  const customerId =
    typeof object.customer === "string"
      ? object.customer
      : typeof object.customer === "object" && object.customer !== null
        ? String((object.customer as { id?: string }).id ?? "")
        : null;

  if (customerId) {
    return db.getWorkspaceIdByStripeCustomerId(customerId);
  }

  const subscriptionId = typeof object.subscription === "string" ? object.subscription : null;
  if (subscriptionId) {
    return db.getWorkspaceIdByStripeSubscriptionId(subscriptionId);
  }

  if (typeof object.id === "string" && object.object === "subscription") {
    return db.getWorkspaceIdByStripeSubscriptionId(object.id);
  }

  return null;
}

async function applySubscriptionUpdate(
  workspaceId: string,
  subscription: Record<string, unknown>,
): Promise<void> {
  const plan =
    extractPlanFromSubscription(
      subscription as {
        items?: { data?: Array<{ price?: { id?: string } }> };
        metadata?: Record<string, string>;
      },
    ) ?? "starter";

  const status = mapStripeSubscriptionStatus(String(subscription.status ?? "inactive"));
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const subscriptionStatus =
    cancelAtPeriodEnd && status === "active" ? "canceling" : status;

  await db.updateWorkspaceBilling(workspaceId, {
    plan,
    subscriptionStatus,
    subscriptionPeriodEnd: periodEndIso(subscription.current_period_end),
    stripeSubscriptionId: String(subscription.id ?? ""),
  });
}

async function handleCheckoutCompleted(session: Record<string, unknown>): Promise<void> {
  const workspaceId = await resolveWorkspaceId(session);
  if (!workspaceId) return;

  const customerId = typeof session.customer === "string" ? session.customer : null;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
  const metadata = session.metadata as Record<string, string> | undefined;
  const plan = (metadata?.plan_id as PlanId | undefined) ?? "starter";

  await db.updateWorkspaceBilling(workspaceId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    plan,
    subscriptionStatus: "active",
  });
}

async function handleInvoice(invoice: Record<string, unknown>, succeeded: boolean): Promise<void> {
  const workspaceId = await resolveWorkspaceId(invoice);
  if (!workspaceId) return;

  const stripeInvoiceId = String(invoice.id ?? createId("inv"));
  await db.upsertBillingInvoice({
    id: createId("inv"),
    workspaceId,
    stripeInvoiceId,
    amountCents: Number(invoice.amount_paid ?? invoice.amount_due ?? 0),
    currency: String(invoice.currency ?? "usd"),
    status: succeeded ? "paid" : "failed",
    invoicePdfUrl:
      typeof invoice.invoice_pdf === "string" ? invoice.invoice_pdf : null,
    periodStart: periodEndIso(invoice.period_start),
    periodEnd: periodEndIso(invoice.period_end),
  });

  if (!succeeded) {
    await db.updateWorkspaceBilling(workspaceId, { subscriptionStatus: "past_due" });
  } else {
    // A successful payment recovers a past_due workspace immediately —
    // otherwise a customer who fixed their card stays locked out until the
    // next subscription.updated event happens to arrive.
    const billing = await db.getWorkspaceBilling(workspaceId);
    if (billing.subscriptionStatus === "past_due") {
      await db.updateWorkspaceBilling(workspaceId, { subscriptionStatus: "active" });
    }
  }
}

async function handler(req: Request, _context: Context) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!verifyStripeWebhookSignature(rawBody, signature)) {
    return jsonResponse({ error: "Invalid signature" }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return jsonResponse({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const object = event.data.object;

    if (event.id) {
      try {
        if (await db.isStripeWebhookEventProcessed(event.id)) {
          return jsonResponse({ received: true, duplicate: true });
        }
      } catch (dedupError) {
        console.warn("Stripe webhook dedup check skipped:", dedupError);
      }
    }

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        {
          const workspaceId = await resolveWorkspaceId(object);
          if (workspaceId) await applySubscriptionUpdate(workspaceId, object);
        }
        break;
      case "customer.subscription.deleted":
        {
          const workspaceId = await resolveWorkspaceId(object);
          if (workspaceId) {
            await db.updateWorkspaceBilling(workspaceId, {
              subscriptionStatus: "canceled",
              subscriptionPeriodEnd: periodEndIso(object.current_period_end),
              plan: "free",
            });
          }
        }
        break;
      case "invoice.paid":
      case "invoice.payment_succeeded":
        await handleInvoice(object, true);
        break;
      case "invoice.payment_failed":
        await handleInvoice(object, false);
        break;
      default:
        break;
    }

    if (event.id) {
      try {
        await db.recordStripeWebhookEvent(event.id, event.type);
      } catch (recordError) {
        console.warn("Stripe webhook event record skipped:", recordError);
      }
    }

    return jsonResponse({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return jsonResponse({ error: "Webhook handler failed" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/billing/webhook",
};

export default withObservability(handler);
