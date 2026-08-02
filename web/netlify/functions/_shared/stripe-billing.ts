import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config.ts";
import {
  planFromStripePriceId,
  type PlanId,
  type SubscriptionStatus,
} from "./billing-plans.ts";

const STRIPE_API = "https://api.stripe.com/v1";

function secretKey(): string {
  const key = getConfig().stripe.secretKey;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  return key;
}

function formBody(params: Record<string, string | undefined>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      body.set(key, value);
    }
  }
  return body.toString();
}

async function stripeRequest<T>(
  path: string,
  init: RequestInit & { form?: Record<string, string | undefined> } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
  };

  let body: string | undefined;
  if (init.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = formBody(init.form);
  }

  const response = await fetch(`${STRIPE_API}${path}`, {
    method: init.method ?? (body ? "POST" : "GET"),
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    body: init.body ?? body,
  });

  const data = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Stripe error (${response.status})`);
  }
  return data;
}

export async function createStripeCustomer(input: {
  email: string;
  name: string;
  workspaceId: string;
}): Promise<string> {
  const customer = await stripeRequest<{ id: string }>("/customers", {
    form: {
      email: input.email,
      name: input.name,
      "metadata[workspace_id]": input.workspaceId,
    },
  });
  return customer.id;
}

export async function createCheckoutSession(input: {
  customerId: string;
  priceId: string;
  workspaceId: string;
  planId: PlanId;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const session = await stripeRequest<{ url: string }>("/checkout/sessions", {
    form: {
      mode: "subscription",
      customer: input.customerId,
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": "1",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "metadata[workspace_id]": input.workspaceId,
      "metadata[plan_id]": input.planId,
      "subscription_data[metadata][workspace_id]": input.workspaceId,
      "subscription_data[metadata][plan_id]": input.planId,
    },
  });
  return session.url;
}

export async function createBillingPortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<string> {
  const session = await stripeRequest<{ url: string }>("/billing_portal/sessions", {
    form: {
      customer: input.customerId,
      return_url: input.returnUrl,
    },
  });
  return session.url;
}

export async function cancelSubscriptionAtPeriodEnd(subscriptionId: string): Promise<void> {
  await stripeRequest("/subscriptions/" + subscriptionId, {
    form: { cancel_at_period_end: "true" },
  });
}

export function mapStripeSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
      return "inactive";
    default:
      if (status === "active") return "active";
      return "inactive";
  }
}

export function extractPlanFromSubscription(subscription: {
  items?: { data?: Array<{ price?: { id?: string } }> };
  metadata?: Record<string, string>;
}): PlanId | null {
  const fromMeta = subscription.metadata?.plan_id;
  if (fromMeta === "starter" || fromMeta === "growth" || fromMeta === "pro") {
    return fromMeta;
  }
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (priceId) {
    return planFromStripePriceId(priceId);
  }
  return null;
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = getConfig().stripe.webhookSecret;
  if (!secret || !signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  ) as Record<string, string>;

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  // Reject stale events: without a tolerance window a captured webhook could
  // be replayed indefinitely. 5 minutes matches Stripe's own SDK default.
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
