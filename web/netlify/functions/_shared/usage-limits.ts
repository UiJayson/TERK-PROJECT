import {
  hasActiveSubscription,
  PLANS,
  type PlanId,
  type SubscriptionStatus,
} from "./billing-plans.ts";
import * as db from "./db.ts";
import type { AgentId } from "./auth-types.ts";
import type { RuntimeChannel } from "./runtime-store.ts";

export interface UsageSnapshot {
  month: string;
  messagesSent: number;
  messageLimit: number | null;
  agentsUsed: string[];
  leadsCreated: number;
  appointmentsBooked: number;
  aiTokensUsed: number;
  plan: PlanId;
  subscriptionStatus: SubscriptionStatus;
  subscriptionPeriodEnd: string | null;
}

export interface UsageCheckResult {
  allowed: boolean;
  reason?: string;
  upgradePlan?: PlanId;
  usage?: UsageSnapshot;
}

export class UsageLimitError extends Error {
  readonly status = 402;
  readonly upgradePlan?: PlanId;

  constructor(message: string, upgradePlan?: PlanId) {
    super(message);
    this.name = "UsageLimitError";
    this.upgradePlan = upgradePlan;
  }
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function effectivePlan(plan: string, status: string, periodEnd: string | null): PlanId {
  const subscriptionStatus = status as SubscriptionStatus;
  if (hasActiveSubscription(subscriptionStatus, periodEnd)) {
    if (plan === "starter" || plan === "growth" || plan === "pro") return plan;
    return "starter";
  }
  return "free";
}

export async function getUsageSnapshot(workspaceId: string): Promise<UsageSnapshot> {
  const billing = await db.getWorkspaceBilling(workspaceId);
  const month = currentMonth();
  const usage = await db.getUsageLog(workspaceId, month);
  const plan = effectivePlan(billing.plan, billing.subscriptionStatus, billing.subscriptionPeriodEnd);
  const planDef = PLANS[plan];

  return {
    month,
    messagesSent: usage?.messagesSent ?? 0,
    messageLimit: planDef.messageLimit,
    agentsUsed: usage?.agentsUsed ?? [],
    leadsCreated: usage?.leadsCreated ?? 0,
    appointmentsBooked: usage?.appointmentsBooked ?? 0,
    aiTokensUsed: usage?.aiTokensUsed ?? 0,
    plan,
    subscriptionStatus: billing.subscriptionStatus as SubscriptionStatus,
    subscriptionPeriodEnd: billing.subscriptionPeriodEnd,
  };
}

export async function checkUsageLimit(
  workspaceId: string,
  channel: RuntimeChannel,
  agentId?: AgentId,
): Promise<UsageCheckResult> {
  const billing = await db.getWorkspaceBilling(workspaceId);
  const snapshot = await getUsageSnapshot(workspaceId);
  const planDef = PLANS[snapshot.plan];

  if (
    billing.subscriptionStatus === "past_due" ||
    (billing.subscriptionStatus === "canceled" &&
      billing.subscriptionPeriodEnd &&
      new Date(billing.subscriptionPeriodEnd).getTime() <= Date.now())
  ) {
    return {
      allowed: false,
      reason: "Your subscription is inactive. Please update billing to continue.",
      upgradePlan: "starter",
      usage: snapshot,
    };
  }

  if (!planDef.channels.includes(channel)) {
    const upgradePlan: PlanId =
      channel === "whatsapp" ? "growth" : "pro";
    return {
      allowed: false,
      reason: `The ${planDef.name} plan does not include ${channel} messages. Upgrade to continue.`,
      upgradePlan,
      usage: snapshot,
    };
  }

  if (planDef.messageLimit !== null && snapshot.messagesSent >= planDef.messageLimit) {
    const upgradePlan: PlanId =
      snapshot.plan === "free" || snapshot.plan === "starter" ? "growth" : "pro";
    return {
      allowed: false,
      reason: `You've used ${snapshot.messagesSent}/${planDef.messageLimit} messages this month. Upgrade to continue.`,
      upgradePlan,
      usage: snapshot,
    };
  }

  if (agentId && planDef.agentLimit !== null) {
    const workspace = await db.getWorkspace(workspaceId);
    const enabledCount =
      workspace?.agentConfigs.filter((agent) => agent.enabled).length ?? 0;
    if (enabledCount > planDef.agentLimit) {
      return {
        allowed: false,
        reason: `Your ${planDef.name} plan allows ${planDef.agentLimit} agent(s). Disable extra agents or upgrade.`,
        upgradePlan: snapshot.plan === "starter" ? "growth" : "pro",
        usage: snapshot,
      };
    }
  }

  return { allowed: true, usage: snapshot };
}

export async function assertUsageAllowed(
  workspaceId: string,
  channel: RuntimeChannel,
  agentId?: AgentId,
): Promise<void> {
  const check = await checkUsageLimit(workspaceId, channel, agentId);
  if (!check.allowed) {
    throw new UsageLimitError(check.reason ?? "Upgrade to continue.", check.upgradePlan);
  }
}

export async function recordMessageUsage(
  workspaceId: string,
  agentId: AgentId,
): Promise<void> {
  await db.incrementUsageLog(workspaceId, currentMonth(), agentId);
}

export async function incrementLeadUsage(workspaceId: string): Promise<void> {
  await db.incrementLeadUsage(workspaceId, currentMonth());
}

export async function incrementAppointmentUsage(workspaceId: string): Promise<void> {
  await db.incrementAppointmentUsage(workspaceId, currentMonth());
}

export async function incrementAiTokenUsage(workspaceId: string, tokens: number): Promise<void> {
  await db.incrementAiTokenUsage(workspaceId, currentMonth(), tokens);
}

export function upgradePromptReply(reason: string): string {
  return `${reason} Visit your dashboard billing page to upgrade your plan.`;
}
