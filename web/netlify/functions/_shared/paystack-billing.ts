import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config.ts";
import { PLANS, type PlanId } from "./billing-plans.ts";

const PAYSTACK_API = "https://api.paystack.co";

function secretKey(): string | null {
  const key = getConfig().paystack.secretKey;
  return key && key.length > 0 ? key : null;
}

function paystackPlanCode(planId: PlanId): string | null {
  const { planStarter, planGrowth, planPro } = getConfig().paystack;
  const map: Record<PlanId, string | null | undefined> = {
    free: null,
    starter: planStarter,
    growth: planGrowth,
    pro: planPro,
  };
  return map[planId] ?? null;
}

/**
 * Paystack amounts are in the smallest currency unit (kobo; 100 kobo = ₦1).
 * Plan prices are stored in USD, so convert: USD × usdToNgn = naira, × 100 = kobo.
 * (Previously this used a hardcoded ×10000, i.e. an implicit $1=₦100 rate, which
 * undercharged every plan ~15×.)
 */
export function planAmountKobo(planId: PlanId): number {
  const plan = PLANS[planId];
  const { usdToNgn } = getConfig().paystack;
  return Math.max(100, Math.round(plan.priceMonthly * usdToNgn * 100));
}

async function paystackRequest<T>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: Record<string, unknown> } = {},
): Promise<T> {
  const key = secretKey();
  if (!key) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  }

  const response = await fetch(`${PAYSTACK_API}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const data = (await response.json()) as T & {
    status?: boolean;
    message?: string;
  };

  if (!response.ok || data.status === false) {
    throw new Error(data.message ?? `Paystack error (${response.status})`);
  }

  return data;
}

export function isPaystackConfigured(): boolean {
  return Boolean(secretKey());
}

export async function initializeTransaction(input: {
  email: string;
  planId: PlanId;
  workspaceId: string;
  callbackUrl: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const planCode = paystackPlanCode(input.planId);
  const payload: Record<string, unknown> = {
    email: input.email,
    currency: "NGN",
    callback_url: input.callbackUrl,
    metadata: {
      workspace_id: input.workspaceId,
      plan_id: input.planId,
      custom_fields: [
        { display_name: "Workspace", variable_name: "workspace_id", value: input.workspaceId },
        { display_name: "Plan", variable_name: "plan_id", value: input.planId },
      ],
    },
  };

  if (planCode) {
    payload.plan = planCode;
  } else {
    payload.amount = planAmountKobo(input.planId);
  }

  const result = await paystackRequest<{
    data: { authorization_url: string; reference: string };
  }>("/transaction/initialize", { method: "POST", body: payload });

  return {
    authorizationUrl: result.data.authorization_url,
    reference: result.data.reference,
  };
}

export async function verifyTransaction(reference: string): Promise<{
  status: string;
  amount: number;
  customerCode: string | null;
  subscriptionCode: string | null;
  workspaceId: string | null;
  planId: PlanId | null;
}> {
  const result = await paystackRequest<{
    data: {
      status: string;
      amount: number;
      customer?: { customer_code?: string };
      subscription?: { subscription_code?: string } | null;
      metadata?: { workspace_id?: string; plan_id?: string };
    };
  }>(`/transaction/verify/${encodeURIComponent(reference)}`);

  const metadata = result.data.metadata ?? {};
  const planId = metadata.plan_id;
  const resolvedPlan =
    planId === "starter" || planId === "growth" || planId === "pro" ? planId : null;

  return {
    status: result.data.status,
    amount: result.data.amount,
    customerCode: result.data.customer?.customer_code ?? null,
    subscriptionCode:
      typeof result.data.subscription === "object" && result.data.subscription
        ? (result.data.subscription.subscription_code ?? null)
        : null,
    workspaceId: metadata.workspace_id ?? null,
    planId: resolvedPlan,
  };
}

/**
 * Stops future charges for a subscription. Paystack's disable endpoint needs
 * the subscription's email_token, so fetch the subscription first.
 */
export async function disablePaystackSubscription(subscriptionCode: string): Promise<void> {
  const result = await paystackRequest<{
    data: { email_token?: string };
  }>(`/subscription/${encodeURIComponent(subscriptionCode)}`);

  const token = result.data.email_token;
  if (!token) {
    throw new Error("Paystack subscription has no email token; cannot disable.");
  }

  await paystackRequest("/subscription/disable", {
    method: "POST",
    body: { code: subscriptionCode, token },
  });
}

export function verifyPaystackWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = getConfig().paystack.webhookSecret ?? secretKey();
  if (!secret || !signatureHeader) return false;

  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");

  try {
    return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function mapPaystackSubscriptionStatus(event: string, status?: string): string {
  if (event === "subscription.disable") return "canceled";
  if (status === "active") return "active";
  if (status === "non-renewing") return "canceling";
  return "inactive";
}

export function planFromPaystackMetadata(metadata?: Record<string, unknown>): PlanId | null {
  const planId = metadata?.plan_id;
  if (planId === "starter" || planId === "growth" || planId === "pro") {
    return planId;
  }
  return null;
}
