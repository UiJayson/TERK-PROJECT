import {
  fetchBillingOverview,
  type BillingOverview,
  type UsageSnapshot,
} from "../../api/billing";

/**
 * Client-side usage tracking service: one place that turns the raw billing
 * snapshot into thresholds and human-readable alerts, so every surface
 * (billing page, dashboard banner, agent settings) reports usage identically.
 */

export type UsageLevel = "ok" | "warning" | "critical" | "over";

export interface UsageStatus {
  level: UsageLevel;
  /** 0–100, or null when the plan is unlimited. */
  percentUsed: number | null;
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface BillingAlert {
  kind: "limit_reached" | "approaching_limit" | "payment_failed" | "canceling" | "inactive";
  severity: "info" | "warning" | "error";
  message: string;
  action: "upgrade" | "update_payment" | "none";
}

const WARNING_THRESHOLD = 0.8;
const CRITICAL_THRESHOLD = 0.95;

export function messageUsageStatus(usage: UsageSnapshot): UsageStatus {
  const { messagesSent: used, messageLimit: limit } = usage;

  if (limit === null) {
    return { level: "ok", percentUsed: null, used, limit, remaining: null };
  }

  const ratio = limit > 0 ? used / limit : 1;
  const level: UsageLevel =
    used >= limit
      ? "over"
      : ratio >= CRITICAL_THRESHOLD
        ? "critical"
        : ratio >= WARNING_THRESHOLD
          ? "warning"
          : "ok";

  return {
    level,
    percentUsed: Math.min(100, Math.round(ratio * 100)),
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

export function billingAlerts(overview: BillingOverview): BillingAlert[] {
  const alerts: BillingAlert[] = [];
  const status = messageUsageStatus(overview.usage);

  if (overview.subscriptionStatus === "past_due") {
    alerts.push({
      kind: "payment_failed",
      severity: "error",
      message:
        "Your last payment failed and your agents are paused. Update your payment method to restore service.",
      action: "update_payment",
    });
  }

  if (status.level === "over") {
    alerts.push({
      kind: "limit_reached",
      severity: "error",
      message: `You've used all ${status.limit?.toLocaleString()} messages in your ${overview.planDetails.name} plan this month. Upgrade to keep your agents responding.`,
      action: "upgrade",
    });
  } else if (status.level === "critical" || status.level === "warning") {
    alerts.push({
      kind: "approaching_limit",
      severity: status.level === "critical" ? "error" : "warning",
      message: `You've used ${status.used.toLocaleString()} of ${status.limit?.toLocaleString()} messages (${status.percentUsed}%) this month. Consider upgrading before your agents pause.`,
      action: "upgrade",
    });
  }

  if (overview.subscriptionStatus === "canceling" && overview.subscriptionPeriodEnd) {
    alerts.push({
      kind: "canceling",
      severity: "info",
      message: `Your subscription ends on ${new Date(overview.subscriptionPeriodEnd).toLocaleDateString()}. You keep full access until then.`,
      action: "none",
    });
  }

  if (
    overview.subscriptionStatus === "canceled" &&
    overview.subscriptionPeriodEnd &&
    new Date(overview.subscriptionPeriodEnd).getTime() <= Date.now()
  ) {
    alerts.push({
      kind: "inactive",
      severity: "error",
      message: "Your subscription has ended. Choose a plan to reactivate your agents.",
      action: "upgrade",
    });
  }

  return alerts;
}

export interface AgentUsageStatus extends UsageStatus {
  enabledAgents: number;
  agentLimit: number | null;
}

export function agentUsageStatus(
  usage: UsageSnapshot,
  enabledAgentCount: number,
): AgentUsageStatus {
  const agentLimit = usage.plan === "free" || usage.plan === "starter"
    ? 1
    : usage.plan === "growth"
      ? 3
      : null;

  const base = messageUsageStatus(usage);
  let level = base.level;

  if (agentLimit !== null && enabledAgentCount > agentLimit) {
    level = "over";
  } else if (
    agentLimit !== null &&
    enabledAgentCount === agentLimit &&
    base.level === "ok"
  ) {
    level = "warning";
  }

  return {
    ...base,
    level,
    enabledAgents: enabledAgentCount,
    agentLimit,
  };
}

export function knowledgeItemLimit(plan: UsageSnapshot["plan"]): number | null {
  switch (plan) {
    case "free":
      return 10;
    case "starter":
      return 50;
    case "growth":
      return 500;
    case "pro":
      return null;
    default:
      return 10;
  }
}

export function knowledgeUsageStatus(
  plan: UsageSnapshot["plan"],
  itemCount: number,
): UsageStatus {
  const limit = knowledgeItemLimit(plan);
  if (limit === null) {
    return { level: "ok", percentUsed: null, used: itemCount, limit, remaining: null };
  }

  const ratio = limit > 0 ? itemCount / limit : 1;
  const level: UsageLevel =
    itemCount >= limit
      ? "over"
      : ratio >= CRITICAL_THRESHOLD
        ? "critical"
        : ratio >= WARNING_THRESHOLD
          ? "warning"
          : "ok";

  return {
    level,
    percentUsed: Math.min(100, Math.round(ratio * 100)),
    used: itemCount,
    limit,
    remaining: Math.max(0, limit - itemCount),
  };
}

export async function loadUsageStatus(): Promise<{
  overview: BillingOverview;
  status: UsageStatus;
  alerts: BillingAlert[];
}> {
  const overview = await fetchBillingOverview();
  return {
    overview,
    status: messageUsageStatus(overview.usage),
    alerts: billingAlerts(overview),
  };
}
