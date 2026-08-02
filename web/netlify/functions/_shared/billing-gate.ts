import {
  checkUsageLimit,
  getUsageSnapshot,
  type UsageCheckResult,
  type UsageSnapshot,
} from "./usage-limits.ts";
import type { RuntimeChannel } from "./runtime-store.ts";
import type { AgentId } from "./auth-types.ts";

export interface SubscriptionCheckResult {
  allowed: boolean;
  reason?: string;
  upgradePlan?: UsageCheckResult["upgradePlan"];
  usage?: UsageSnapshot;
}

/** Enforce plan limits before AI processing. */
export async function checkSubscription(
  workspaceId: string,
  channel: RuntimeChannel = "dashboard",
  agentId?: AgentId,
): Promise<SubscriptionCheckResult> {
  const check = await checkUsageLimit(workspaceId, channel, agentId);
  return {
    allowed: check.allowed,
    reason: check.reason,
    upgradePlan: check.upgradePlan,
    usage: check.usage,
  };
}

export { getUsageSnapshot };

export {
  recordMessageUsage,
  upgradePromptReply,
  assertUsageAllowed,
  UsageLimitError,
} from "./usage-limits.ts";
