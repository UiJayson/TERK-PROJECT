import { createId } from "./auth-crypto.ts";
import * as db from "./db.ts";
import { notifyBusinessOwner } from "./notifications.ts";
import type { DetectedIntent } from "./intent-detector.ts";
import type { ChatMessage } from "./types.ts";

export const ESCALATION_REPLY =
  "I'm connecting you with a human. Someone will be with you shortly.";

export type EscalationReason =
  | "human_request"
  | "low_confidence"
  | "repeated_question"
  | "profanity"
  | "escalation_intent";

export interface EscalationTrigger {
  reason: EscalationReason;
  detail: string;
}

const HUMAN_REQUEST_PATTERN =
  /\b(talk to (a )?human|speak to (a )?(human|person|agent|manager|supervisor)|real person|live agent|customer support|human support)\b/i;

const SUPPORT_PATTERN = /\b(need (a )?human|get me (a )?human|agent please)\b/i;

const PROFANITY_PATTERN =
  /\b(damn|hell|stupid|idiot|useless|worst|scam|fraud|bullshit|shit|hate you|terrible service)\b/i;

const ANGER_PATTERN =
  /\b(so angry|furious|ridiculous|unacceptable|never again|sue you|lawyer|angry|frustrated)\b/i;

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countSimilarUserQuestions(history: ChatMessage[], currentMessage: string): number {
  const current = normalizeForComparison(currentMessage);
  if (!current || current.length < 8) return 0;

  const userMessages = history
    .filter((message) => message.role === "user")
    .map((message) => normalizeForComparison(message.content));

  let count = 0;
  for (const prior of userMessages) {
    if (!prior) continue;
    if (prior === current) {
      count += 1;
      continue;
    }
    if (prior.includes(current) || current.includes(prior)) {
      count += 1;
    }
  }
  return count;
}

export function detectEscalation(input: {
  message: string;
  history: ChatMessage[];
  agentConfidence?: number;
  phase: "pre" | "post";
  detectedIntent?: DetectedIntent;
}): EscalationTrigger | null {
  const text = input.message.trim();
  if (!text) return null;

  if (input.phase === "pre") {
    if (input.detectedIntent === "escalation") {
      return {
        reason: "escalation_intent",
        detail: "Escalation intent detected (frustration or human request).",
      };
    }

    if (HUMAN_REQUEST_PATTERN.test(text) || SUPPORT_PATTERN.test(text)) {
      return {
        reason: "human_request",
        detail: "Customer requested a human agent.",
      };
    }

    if (PROFANITY_PATTERN.test(text) || ANGER_PATTERN.test(text)) {
      return {
        reason: "profanity",
        detail: "Profanity or anger indicators detected.",
      };
    }

    const repeats = countSimilarUserQuestions(input.history, text);
    if (repeats >= 2) {
      return {
        reason: "repeated_question",
        detail: "Same question repeated 3+ times (frustration signal).",
      };
    }

    return null;
  }

  if (input.agentConfidence !== undefined && input.agentConfidence < 0.6) {
    return {
      reason: "low_confidence",
      detail: `AI confidence below threshold (${input.agentConfidence.toFixed(2)}).`,
    };
  }

  return null;
}

export async function isConversationEscalated(
  workspaceId: string,
  conversationId?: string,
): Promise<boolean> {
  if (!conversationId) return false;
  const status = await db.getConversationStatus(workspaceId, conversationId);
  return status === "escalated";
}

export async function escalateConversation(input: {
  workspaceId: string;
  conversationId?: string;
  customerId?: string;
  channel: string;
  trigger: EscalationTrigger;
  customerMessage: string;
  customerName?: string;
}): Promise<void> {
  if (input.conversationId) {
    await db.setConversationStatus(input.workspaceId, input.conversationId, "escalated");
  }

  await notifyBusinessOwner({
    workspaceId: input.workspaceId,
    type: "escalation",
    title: "Conversation escalated to human",
    customerName: input.customerName,
    channel: input.channel,
    body: input.customerMessage.slice(0, 200),
    metadata: {
      conversationId: input.conversationId,
      customerId: input.customerId,
      trigger: input.trigger,
    },
  });

  const { publish } = await import("./event-bus.ts");
  const { triggerWorkflowsByEvent } = await import("./workflow-engine.ts");
  await publish(input.workspaceId, "conversation.ended", {
    conversationId: input.conversationId,
    customerId: input.customerId,
    status: "escalated",
    channel: input.channel,
    trigger: input.trigger,
  });
  await triggerWorkflowsByEvent(input.workspaceId, "conversation_escalated", {
    conversationId: input.conversationId,
    customerId: input.customerId,
    channel: input.channel,
    trigger: input.trigger,
  });
}
