import { getStoredToken } from "../auth/api";

export interface PlanDetails {
  id: string;
  name: string;
  priceMonthly: number;
  messageLimit: number | null;
  agentLimit: number | null;
  channels: string[];
  description: string;
}

export interface UsageSnapshot {
  month: string;
  messagesSent: number;
  messageLimit: number | null;
  agentsUsed: string[];
  leadsCreated: number;
  appointmentsBooked: number;
  aiTokensUsed: number;
  plan: string;
  subscriptionStatus: string;
  subscriptionPeriodEnd: string | null;
}

export interface BillingInvoice {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  invoicePdfUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

export interface BillingOverview {
  plan: string;
  planDetails: PlanDetails;
  subscriptionStatus: string;
  subscriptionPeriodEnd: string | null;
  usage: UsageSnapshot;
  invoices: BillingInvoice[];
  plans: PlanDetails[];
}

async function request(path: string, init: RequestInit = {}) {
  const token = getStoredToken();
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error ?? "Request failed"));
  }
  return data;
}

export async function fetchBillingOverview(): Promise<BillingOverview> {
  const data = await request("/api/billing");
  return data as unknown as BillingOverview;
}

export async function startSubscription(plan: string): Promise<string> {
  const data = await request("/api/billing/subscribe", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  const url = (data.authorization_url as string | undefined) ?? (data.url as string | undefined);
  if (typeof url !== "string" || !url) {
    throw new Error("Checkout URL missing");
  }
  return url;
}

export async function verifyPaystackPayment(reference: string): Promise<void> {
  await request(`/.netlify/functions/billing/verify?reference=${encodeURIComponent(reference)}`);
}

export async function cancelSubscription(): Promise<string> {
  const data = await request("/api/billing/cancel", { method: "POST" });
  return String(data.message ?? "Subscription canceled.");
}

export async function openBillingPortal(): Promise<string> {
  const data = await request("/api/billing/portal", { method: "POST" });
  const url = data.url;
  if (typeof url !== "string" || !url) {
    throw new Error("Portal URL missing");
  }
  return url;
}
