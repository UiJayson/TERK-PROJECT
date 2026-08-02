import { getConfig } from "./config.ts";

export type PlanId = "free" | "starter" | "growth" | "pro";

export type SubscriptionStatus =
  | "inactive"
  | "trialing"
  | "active"
  | "past_due"
  | "canceling"
  | "canceled";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceMonthly: number;
  messageLimit: number | null;
  agentLimit: number | null;
  channels: Array<"website" | "whatsapp" | "instagram" | "email" | "dashboard">;
  description: string;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free trial",
    priceMonthly: 0,
    messageLimit: 50,
    agentLimit: 1,
    channels: ["website", "dashboard"],
    description: "Try AI Business OS with limited messages.",
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceMonthly: 9,
    messageLimit: 500,
    agentLimit: 1,
    channels: ["website", "dashboard"],
    description: "1 agent, 500 messages/mo, website chat only.",
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceMonthly: 29,
    messageLimit: 5000,
    agentLimit: 3,
    channels: ["website", "whatsapp", "dashboard"],
    description: "3 agents, 5,000 messages/mo, WhatsApp + website.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 79,
    messageLimit: null,
    agentLimit: null,
    channels: ["website", "whatsapp", "instagram", "email", "dashboard"],
    description: "All agents, unlimited messages, all channels, priority support.",
  },
};

export const PAID_PLANS: PlanId[] = ["starter", "growth", "pro"];

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

export function stripePriceIdForPlan(planId: PlanId): string | null {
  const { priceStarter, priceGrowth, pricePro } = getConfig().stripe;
  const envMap: Record<PlanId, string | null | undefined> = {
    free: undefined,
    starter: priceStarter,
    growth: priceGrowth,
    pro: pricePro,
  };
  return envMap[planId] ?? null;
}

export function planFromStripePriceId(priceId: string): PlanId | null {
  const { priceStarter, priceGrowth, pricePro } = getConfig().stripe;
  if (priceId === priceStarter) return "starter";
  if (priceId === priceGrowth) return "growth";
  if (priceId === pricePro) return "pro";
  return null;
}

export function planMrr(planId: PlanId): number {
  return PLANS[planId]?.priceMonthly ?? 0;
}

export function hasActiveSubscription(status: SubscriptionStatus, periodEnd: string | null): boolean {
  if (status === "active" || status === "trialing" || status === "canceling") {
    if (!periodEnd) return true;
    return new Date(periodEnd).getTime() > Date.now();
  }
  return false;
}
