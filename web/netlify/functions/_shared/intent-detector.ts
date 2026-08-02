import type { ChatMessage } from "./types.ts";

export type DetectedIntent =
  | "greeting"
  | "pricing"
  | "appointment"
  | "escalation"
  | "product_question"
  | "complaint"
  | "general";

export interface IntentDetectionResult {
  intent: DetectedIntent;
  confidence: number;
}

const RULES: Array<{
  intent: DetectedIntent;
  confidence: number;
  pattern: RegExp;
}> = [
  {
    intent: "escalation",
    confidence: 0.93,
    pattern:
      /\b(angry|frustrated|talk to human|speak to human|manager|supervisor)\b/i,
  },
  {
    intent: "complaint",
    confidence: 0.9,
    pattern: /\b(bad|terrible|worst|hate)\b/i,
  },
  {
    intent: "appointment",
    confidence: 0.88,
    pattern: /\b(book|schedule|appointment|reserve)\b/i,
  },
  {
    intent: "pricing",
    confidence: 0.87,
    pattern: /\b(how much|price|cost|pricing)\b/i,
  },
  {
    intent: "product_question",
    confidence: 0.85,
    pattern: /\b(buy|interested|quote|purchase)\b/i,
  },
  {
    intent: "greeting",
    confidence: 0.82,
    pattern: /\b(hello|hi|hey)\b/i,
  },
];

/**
 * Rule-based intent detection (no LLM).
 */
export function detectIntent(
  message: string,
  _conversationHistory: ChatMessage[] = [],
): IntentDetectionResult {
  const text = message.trim();
  if (!text) {
    return { intent: "general", confidence: 0.4 };
  }

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { intent: rule.intent, confidence: rule.confidence };
    }
  }

  return { intent: "general", confidence: 0.55 };
}

export function mapDetectedIntentToRoutingIntent(
  detected: DetectedIntent,
): import("./types.ts").Intent {
  switch (detected) {
    case "greeting":
      return "greeting";
    case "pricing":
      return "pricing";
    case "appointment":
      return "appointment_intake";
    case "escalation":
      return "human_request";
    case "product_question":
      return "lead_qualification";
    case "complaint":
      return "complaint";
    case "general":
    default:
      return "unknown";
  }
}
