/**
 * Two-track retrieval router (Problem 3 §Step 3, the most critical part).
 *
 *   Track 1 (structured DB) → deterministic answer, no AI, zero hallucination.
 *   Track 2 (vector RAG)   → confidence-gated document answer.
 *   Fallback               → human escalation, always available.
 *
 * Structured data ALWAYS wins over RAG on critical fields (refund, hours,
 * pricing, contacts). RAG never gets a chance to compete for those.
 */

import {
  getConversationPinnedVersion,
  getCurrentKbVersion,
  pinConversationToVersion,
} from "../versioning/kb-version-manager.ts";
import { retrieveTrack1 } from "./track1-structured.ts";
import { retrieveTrack2 } from "./track2-vector.ts";
import { listEscalationContacts } from "../business-store.ts";

export type RetrievalTrack = "structured" | "vector" | "fallback";

export interface RetrievalResponse {
  track: RetrievalTrack;
  answer: string;
  source: string;
  confidence: number;
  category?: string;
  escalation?: {
    role: string;
    name: string;
    email: string;
    phone: string;
  } | null;
  kbVersion: number;
}

export async function routeQuery(input: {
  workspaceId: string;
  message: string;
  conversationId?: string;
}): Promise<RetrievalResponse> {
  const { workspaceId, message, conversationId } = input;

  // Version pinning: an ongoing conversation sees the KB version it started on.
  let kbVersion: number;
  if (conversationId) {
    const pinned = await getConversationPinnedVersion(workspaceId, conversationId);
    if (pinned) {
      kbVersion = pinned;
    } else {
      kbVersion = await getCurrentKbVersion(workspaceId);
      await pinConversationToVersion(workspaceId, conversationId, kbVersion);
    }
  } else {
    kbVersion = await getCurrentKbVersion(workspaceId);
  }

  // Track 1.
  const track1 = await retrieveTrack1(workspaceId, message);
  if (track1.matched) {
    return {
      track: "structured",
      answer: track1.answer,
      source: track1.source,
      confidence: 1,
      category: track1.category,
      kbVersion,
    };
  }

  // Track 2.
  const track2 = await retrieveTrack2(workspaceId, message, kbVersion);
  if (track2.matched) {
    return {
      track: "vector",
      answer: track2.answer,
      source: track2.source,
      confidence: track2.score,
      kbVersion,
    };
  }

  // Fallback with escalation contact.
  const contacts = await listEscalationContacts(workspaceId);
  const support = contacts.find((c) => c.role === "support") ?? contacts[0] ?? null;
  const escalationLine = support
    ? ` You can reach ${support.name || "our team"}${support.email ? ` at ${support.email}` : ""}${support.phone ? ` or ${support.phone}` : ""}.`
    : "";
  return {
    track: "fallback",
    answer: `${track2.fallbackAnswer}${escalationLine}`,
    source: "fallback",
    confidence: track2.score,
    escalation: support
      ? {
          role: support.role,
          name: support.name,
          email: support.email,
          phone: support.phone,
        }
      : null,
    kbVersion,
  };
}
