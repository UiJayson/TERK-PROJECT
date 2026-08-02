import type { PlanId } from "../../../netlify/functions/_shared/billing-plans.ts";
import { PLANS } from "../../../netlify/functions/_shared/billing-plans.ts";

export type GatedFeature =
  | "whatsapp_channel"
  | "instagram_channel"
  | "email_channel"
  | "multi_agent"
  | "unlimited_messages"
  | "knowledge_base"
  | "team_seats";

export interface PlanGateResult {
  allowed: boolean;
  reason?: string;
  upgradePlan?: PlanId;
}

const FEATURE_MIN_PLAN: Record<GatedFeature, PlanId> = {
  whatsapp_channel: "growth",
  instagram_channel: "pro",
  email_channel: "pro",
  multi_agent: "growth",
  unlimited_messages: "pro",
  knowledge_base: "free",
  team_seats: "growth",
};

const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  starter: 1,
  growth: 2,
  pro: 3,
};

function planRank(plan: PlanId): number {
  return PLAN_RANK[plan] ?? 0;
}

/**
 * Client and server-shared plan enforcement helper. Server-side AI runtime
 * uses usage-limits.ts; this gates UI features and API routes consistently.
 */
export function checkPlanFeature(plan: PlanId, feature: GatedFeature): PlanGateResult {
  const required = FEATURE_MIN_PLAN[feature];
  if (planRank(plan) >= planRank(required)) {
    return { allowed: true };
  }

  const requiredPlan = PLANS[required];
  return {
    allowed: false,
    reason: `The ${PLANS[plan].name} plan does not include ${feature.replace(/_/g, " ")}. Upgrade to ${requiredPlan.name}.`,
    upgradePlan: required,
  };
}

export function agentLimitForPlan(plan: PlanId): number | null {
  return PLANS[plan]?.agentLimit ?? null;
}

export function messageLimitForPlan(plan: PlanId): number | null {
  return PLANS[plan]?.messageLimit ?? null;
}

export function channelsForPlan(plan: PlanId): string[] {
  return PLANS[plan]?.channels ?? ["website", "dashboard"];
}

/** HTTP status when a plan limit blocks an API call. */
export const PLAN_GATE_STATUS = 402;

export function planGateErrorBody(result: PlanGateResult): {
  error: string;
  upgrade_plan?: PlanId;
} {
  return {
    error: result.reason ?? "Plan limit exceeded.",
    upgrade_plan: result.upgradePlan,
  };
}
