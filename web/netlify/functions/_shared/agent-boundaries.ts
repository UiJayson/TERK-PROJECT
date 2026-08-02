import type { AgentRole, HandoffRequest } from "./types.ts";

export interface BoundaryViolation {
  violated: boolean;
  suggestedTarget?: AgentRole;
  reason?: string;
}

const RECEPTION_TRANSACTION =
  /\b(payment (processed|confirmed)|processed your payment|i('ve| have) processed (your )?payment|i('ve| have) charged|refund (issued|processed)|order (is )?confirmed|checkout complete)\b/i;
const RECEPTION_DEEP_SELL =
  /\b(exclusive discount|special price for you|let me close (this|the) deal|sign up now and save)\b/i;
const SALES_SUPPORT =
  /\b(support ticket (created|submitted)|submitted a support ticket|i('ve| have) submitted a support ticket|i('ve| have) escalated your complaint|refund (has been )?(issued|processed)|replacement order)\b/i;
const SALES_BOOKING =
  /\b(your (tour|appointment) is booked|i('ve| have) reserved (a |your )?slot)\b/i;
const MARKETING_TRANSACTION =
  /\b(payment received|purchase confirmed|invoice sent|order placed)\b/i;
const MARKETING_BOOKING =
  /\b(your (tour|appointment) is (booked|confirmed)|slot reserved)\b/i;

const PROMPT_INJECTION =
  /\b(system prompt|developer mode|ignore (all |your )?instructions|you are now|dan mode)\b/i;

/**
 * Lightweight post-generation boundary check. Prompts carry the primary rules;
 * this catches obvious role slips before the customer sees the reply.
 */
export function detectBoundaryViolation(
  agent: AgentRole,
  response: string,
  userMessage = "",
): BoundaryViolation {
  const text = response.toLowerCase();
  const user = userMessage.toLowerCase();

  if (agent === "reception") {
    if (RECEPTION_TRANSACTION.test(text)) {
      return {
        violated: true,
        suggestedTarget: "sales",
        reason: "Reception must not process payments or confirm orders.",
      };
    }
    if (
      RECEPTION_DEEP_SELL.test(text) ||
      (/\b(£|\$|€)\d+/.test(text) && /\b(buy|purchase|quote|plan)\b/.test(user))
    ) {
      return {
        violated: true,
        suggestedTarget: "sales",
        reason: "Pricing and closing belong to Sales.",
      };
    }
  }

  if (agent === "sales") {
    if (SALES_SUPPORT.test(text)) {
      return {
        violated: true,
        suggestedTarget: "reception",
        reason: "Support and refunds belong to Reception or human review.",
      };
    }
    if (SALES_BOOKING.test(text) && !/\b(buy|purchase|plan|price)\b/.test(user)) {
      return {
        violated: true,
        suggestedTarget: "reception",
        reason: "General booking without purchase intent belongs to Reception.",
      };
    }
  }

  if (agent === "marketing") {
    if (MARKETING_TRANSACTION.test(text)) {
      return {
        violated: true,
        suggestedTarget: "sales",
        reason: "Marketing must not process transactions.",
      };
    }
    if (MARKETING_BOOKING.test(text)) {
      return {
        violated: true,
        suggestedTarget: "reception",
        reason: "Appointment booking belongs to Reception.",
      };
    }
  }

  if (PROMPT_INJECTION.test(user) && PROMPT_INJECTION.test(text)) {
    return {
      violated: true,
      reason: "Agent echoed prompt-injection content instead of refusing.",
    };
  }

  return { violated: false };
}

export function boundaryHandoffFromViolation(
  violation: BoundaryViolation,
  userMessage: string,
): HandoffRequest | null {
  if (!violation.violated || !violation.suggestedTarget) return null;

  return {
    handoff_requested: true,
    target_agent: violation.suggestedTarget,
    reason: violation.reason ?? "Role boundary exceeded.",
    conversation_summary: userMessage,
    recommended_next_action: `${violation.suggestedTarget} should continue this thread.`,
  };
}

export function boundarySafeReply(
  agent: AgentRole,
  violation: BoundaryViolation,
): string {
  const target = violation.suggestedTarget;
  if (target === "sales") {
    return "I'll connect you with our Sales team — they're best placed to help with pricing and purchases.";
  }
  if (target === "reception") {
    return "Let me bring in our Reception team to help with booking and general support.";
  }
  if (target === "marketing") {
    return "Our Marketing team can help with campaigns and content — I'll arrange that handoff.";
  }
  if (agent === "reception" || agent === "sales" || agent === "marketing") {
    return "I want to make sure you get the right help. Let me connect you with the right specialist.";
  }
  return "A team member will follow up shortly.";
}
