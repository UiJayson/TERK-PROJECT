import { AGENT_CATALOG, type AgentId } from "./agents-catalog.ts";
import { findWorkspaceById } from "./auth-store.ts";
import {
  formatCalendarForPrompt,
  getAvailableSlots,
  processBookingActionLog,
} from "./calendar.ts";
import { retrieveKnowledgeForQuery } from "./knowledge-retrieval.ts";
import {
  boundaryHandoffFromViolation,
  boundarySafeReply,
  detectBoundaryViolation,
} from "./agent-boundaries.ts";
import {
  detectEscalation,
  escalateConversation,
  ESCALATION_REPLY,
  isConversationEscalated,
} from "./escalation.ts";
import {
  formatLeadDataForPrompt,
  processLeadQualification,
  isQualifiedLead,
} from "./lead-qualification.ts";
import {
  loadMemoryContext,
  memoryToChatHistory,
  persistTurn,
  resolveCustomerId,
  resolveSessionId,
  type MemoryContext,
} from "./memory.ts";
import * as db from "./db.ts";
import { calculateHumanDelay } from "./response-delay.ts";
import { detectIntent, mapDetectedIntentToRoutingIntent } from "./intent-detector.ts";
import {
  buildSalesAgentContext,
  collectRecommendedProducts,
} from "./sales-agent.ts";
import type { CatalogProduct } from "./products.ts";
import {
  buildModuleAgentContext,
  ensureKernelBooted,
} from "./kernel/index.ts";
import { retrieveTrack1 } from "./onboarding/retrieval/track1-structured.ts";
import { getWizardStatus } from "./onboarding/wizard/wizard-controller.ts";
import {
  collaborate,
  handoffConversation,
  resolveNextAgent,
  routeMessage,
  runAgentTurn,
  toRoutingDecision,
} from "./orchestrator.ts";
import {
  checkSubscription,
  recordMessageUsage,
  upgradePromptReply,
} from "./billing-gate.ts";
import {
  appendConversationTurn,
  type RuntimeChannel,
  type RuntimeConversation,
} from "./runtime-store.ts";
import type {
  AgentRole,
  ChatMessage,
  ConversationState,
  HandoffRequest,
} from "./types.ts";

export interface ProductCard {
  id: string;
  title: string;
  description: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  stockStatus: string | null;
}

export interface RuntimeChatResult {
  reply: string;
  agent: AgentRole;
  intent: string;
  routing_reason: string;
  handoff: HandoffRequest | null;
  citations: Array<{ source: string; topic?: string }>;
  action_log: string[];
  state: ConversationState;
  mode: "ai" | "demo";
  conversation: RuntimeConversation | null;
  typing_delay_ms: number;
  escalated: boolean;
  products?: ProductCard[];
}

function toProductCards(products: CatalogProduct[]): ProductCard[] {
  return products.map((product) => ({
    id: product.id,
    title: product.title,
    description: product.description,
    price: product.price,
    currency: product.currency,
    imageUrl: product.imageUrl,
    stockStatus: product.stockStatus,
  }));
}

const ESCALATED_HOLD_REPLY =
  "A team member will continue this conversation shortly. Thank you for your patience.";

function isEnabledAgent(
  agent: AgentRole,
  enabled: Set<string>,
): agent is AgentId {
  return agent !== "human_review" && enabled.has(agent);
}

async function buildReceptionExtraContext(
  workspaceId: string,
  memoryContext: MemoryContext | null,
): Promise<string> {
  const slots = await getAvailableSlots(workspaceId);
  const calendarBlock = formatCalendarForPrompt(slots);
  const leadBlock = memoryContext
    ? formatLeadDataForPrompt(memoryContext.profile.leadData)
    : "";
  return [calendarBlock, leadBlock].filter(Boolean).join("\n\n");
}

export async function processWorkspaceMessage(input: {
  workspaceId: string;
  message: string;
  history?: ChatMessage[];
  state?: ConversationState;
  pageUrl?: string;
  channel?: RuntimeChannel;
  forceAgent?: AgentId;
  conversationId?: string;
  collectedFields?: Record<string, string>;
}): Promise<RuntimeChatResult> {
  const workspace = await findWorkspaceById(input.workspaceId);
  if (!workspace) {
    throw new Error("WORKSPACE_NOT_FOUND");
  }

  const enabled = new Set(
    workspace.agentConfigs.filter((agent) => agent.enabled).map((agent) => agent.id),
  );

  if (enabled.size === 0) {
    throw new Error("NO_ACTIVE_AGENTS");
  }

  const channel = input.channel ?? "dashboard";

  const usageCheck = await checkSubscription(input.workspaceId, channel);
  if (!usageCheck.allowed) {
    const reply = upgradePromptReply(usageCheck.reason ?? "Upgrade to continue.");
    return {
      reply,
      agent: input.state?.active_agent ?? "reception",
      intent: "billing_limit",
      routing_reason: usageCheck.reason ?? "Usage limit reached",
      handoff: null,
      citations: [],
      action_log: ["Usage limit reached"],
      state: {
        active_agent: input.state?.active_agent ?? "reception",
        last_intent: "billing_limit",
      },
      mode: "ai",
      conversation: null,
      typing_delay_ms: calculateHumanDelay(reply.length),
      escalated: false,
    };
  }

  let customerId = resolveCustomerId({
    workspaceId: input.workspaceId,
    channel,
    collectedFields: input.collectedFields,
    conversationId: input.conversationId,
  });

  let memoryContext: MemoryContext | null = null;
  if (customerId) {
    const sessionId = resolveSessionId({
      channel,
      customerId,
      conversationId: input.conversationId,
    });
    memoryContext = await loadMemoryContext({
      workspaceId: input.workspaceId,
      customerId,
      channel,
      sessionId,
      collectedFields: input.collectedFields,
      recentLimit: 24,
    });
  }

  if (await isConversationEscalated(input.workspaceId, input.conversationId)) {
    return {
      reply: ESCALATED_HOLD_REPLY,
      agent: input.state?.active_agent ?? "reception",
      intent: "human_request",
      routing_reason: "Conversation escalated — awaiting human agent.",
      handoff: null,
      citations: [],
      action_log: ["Escalated conversation — AI paused"],
      state: {
        active_agent: input.state?.active_agent ?? "reception",
        last_intent: "human_request",
        escalated: true,
      },
      mode: "ai",
      conversation: null,
      typing_delay_ms: calculateHumanDelay(ESCALATED_HOLD_REPLY.length),
      escalated: true,
    };
  }

  const memoryHistory = memoryContext
    ? memoryToChatHistory(memoryContext.recentMessages)
    : [];
  const history =
    memoryHistory.length > 0 ? memoryHistory : (input.history ?? []);

  const intentResult = detectIntent(input.message, history);
  const detectedIntent = intentResult.intent;

  const initialState: ConversationState = input.state ?? {
    active_agent: "reception",
    last_intent: mapDetectedIntentToRoutingIntent(detectedIntent),
  };

  const orchestratorRoute = routeMessage(
    input.workspaceId,
    input.message,
    history,
    { pageUrl: input.pageUrl, state: initialState },
  );

  let routing = toRoutingDecision(orchestratorRoute);

  console.log(
    `Routed to ${orchestratorRoute.agent} with confidence ${orchestratorRoute.confidence.toFixed(2)} because ${orchestratorRoute.reason}`,
  );

  if (detectedIntent !== "general") {
    routing = {
      ...routing,
      primary_intent: mapDetectedIntentToRoutingIntent(detectedIntent),
      confidence: Math.max(routing.confidence, intentResult.confidence),
      reason: `${routing.reason} Intent detector: ${detectedIntent} (${intentResult.confidence.toFixed(2)}).`,
    };
  }

  let activeAgent = routing.selected_agent;

  if (input.forceAgent) {
    if (!enabled.has(input.forceAgent)) {
      throw new Error("NO_ACTIVE_AGENTS");
    }
    activeAgent = input.forceAgent;
    routing = {
      selected_agent: input.forceAgent,
      confidence: 1,
      primary_intent: "unknown",
      reason: `Manual test of ${AGENT_CATALOG[input.forceAgent].name}`,
      knowledge_files: AGENT_CATALOG[input.forceAgent].knowledgeSources,
    };
  } else if (activeAgent === "human_review") {
    // keep human_review path
  } else if (!isEnabledAgent(activeAgent, enabled)) {
    const fallback =
      (enabled.has("reception") && "reception") ||
      ([...enabled][0] as AgentId | undefined);
    if (!fallback) throw new Error("NO_ACTIVE_AGENTS");
    activeAgent = fallback;
    routing = {
      ...routing,
      selected_agent: fallback,
      reason: `${routing.reason} Active agent unavailable; using ${fallback}.`,
    };
  } else if (
    initialState.active_agent === "sales" &&
    enabled.has("sales") &&
    routing.selected_agent === "reception"
  ) {
    activeAgent = "sales";
  }

  const preEscalation = detectEscalation({
    message: input.message,
    history,
    phase: "pre",
    detectedIntent,
  });

  if (preEscalation) {
    await escalateConversation({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      customerId: customerId ?? undefined,
      channel,
      trigger: preEscalation,
      customerMessage: input.message,
      customerName: memoryContext?.profile.name ?? input.collectedFields?.name,
    });

    const conversation = await appendConversationTurn({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      channel,
      agentUsed: "human_review",
      intent: "human_request",
      routingReason: preEscalation.detail,
      customerMessage: input.message,
      agentReply: ESCALATION_REPLY,
      collectedFields: input.collectedFields,
      conversationStatus: "escalated",
    });

    if (!customerId && conversation.id) {
      customerId = `${input.workspaceId}:conv:${conversation.id}`;
    }

    if (customerId) {
      await persistTurn({
        workspaceId: input.workspaceId,
        customerId,
        channel,
        sessionId: resolveSessionId({
          channel,
          customerId,
          conversationId: conversation.id,
        }),
        userMessage: input.message,
        assistantMessage: ESCALATION_REPLY,
        agent: "human_review",
        intent: "human_request",
        collectedFields: input.collectedFields,
      });
    }

    return {
      reply: ESCALATION_REPLY,
      agent: "human_review",
      intent: "human_request",
      routing_reason: preEscalation.detail,
      handoff: null,
      citations: [],
      action_log: [`Escalated: ${preEscalation.reason}`],
      state: {
        active_agent: "human_review",
        last_intent: "human_request",
        escalated: true,
      },
      mode: "ai",
      conversation,
      typing_delay_ms: calculateHumanDelay(ESCALATION_REPLY.length),
      escalated: true,
    };
  }

  // Two-track retrieval — Track 1 (structured DB) short-circuit.
  // Hard rule: refund policy, business hours, pricing, and contacts are ALWAYS
  // answered from the verified structured DB. No AI, no hallucination. Skipped
  // on human_review path and while onboarding is incomplete (no data to answer
  // from yet — falls through to the existing pipeline).
  if (activeAgent !== "human_review") {
    try {
      const wizard = await getWizardStatus(input.workspaceId);
      if (wizard.complete) {
        const track1 = await retrieveTrack1(input.workspaceId, input.message);
        if (track1.matched) {
          const conversation = await appendConversationTurn({
            workspaceId: input.workspaceId,
            conversationId: input.conversationId,
            channel,
            agentUsed: activeAgent,
            intent: routing.primary_intent,
            routingReason: `Track 1 (structured DB): ${track1.category}`,
            customerMessage: input.message,
            agentReply: track1.answer,
            collectedFields: input.collectedFields,
          });
          if (customerId) {
            await persistTurn({
              workspaceId: input.workspaceId,
              customerId,
              channel,
              sessionId: resolveSessionId({
                channel,
                customerId,
                conversationId: conversation.id,
              }),
              userMessage: input.message,
              assistantMessage: track1.answer,
              agent: activeAgent,
              intent: routing.primary_intent,
              collectedFields: input.collectedFields,
            });
          }
          return {
            reply: track1.answer,
            agent: activeAgent,
            intent: routing.primary_intent,
            routing_reason: `Track 1 (structured DB): ${track1.category}`,
            handoff: null,
            citations: [{ source: "structured_db", topic: track1.category }],
            action_log: [`Answered from verified structured data (${track1.category})`],
            state: {
              active_agent: activeAgent,
              last_intent: routing.primary_intent,
            },
            mode: "ai",
            conversation,
            typing_delay_ms: calculateHumanDelay(track1.answer.length),
            escalated: false,
          };
        }
      }
    } catch (error) {
      console.warn("Track 1 retrieval failed, falling through to RAG:", error);
    }
  }

  let retrievedKnowledge: Awaited<ReturnType<typeof retrieveKnowledgeForQuery>> = [];
  try {
    retrievedKnowledge = await retrieveKnowledgeForQuery(
      input.workspaceId,
      input.message,
      5,
    );
  } catch (error) {
    console.warn("Knowledge retrieval failed:", error);
  }

  const extraContext =
    activeAgent === "reception"
      ? await buildReceptionExtraContext(input.workspaceId, memoryContext)
      : undefined;

  let salesExtraContext = extraContext;
  let recommendedProducts: ProductCard[] = [];
  let collaborationBlock = "";

  const collaboration = await collaborate({
    workspaceId: input.workspaceId,
    primaryAgent: activeAgent,
    task: input.message,
    customerMessage: input.message,
    customerProfile: memoryContext?.profile ?? null,
  });
  if (collaboration) {
    collaborationBlock = collaboration.contextBlock;
  }

  if (activeAgent === "sales") {
    const salesContext = await buildSalesAgentContext({
      workspaceId: input.workspaceId,
      message: input.message,
      customerProfile: memoryContext?.profile ?? null,
    });
    salesExtraContext = [extraContext, collaborationBlock, salesContext.promptBlock]
      .filter(Boolean)
      .join("\n\n");
    recommendedProducts = toProductCards(collectRecommendedProducts(salesContext));
  } else if (collaborationBlock) {
    salesExtraContext = [extraContext, collaborationBlock].filter(Boolean).join("\n\n");
  }

  // Agent context routing (kernel spec §4): inject the combined system-prompt
  // fragment for the modules this tenant has installed. Additive — a tenant
  // with no installed modules contributes nothing, so existing behavior is
  // unchanged. Modules the tenant has NOT installed never contribute context.
  ensureKernelBooted();
  const moduleContext = await buildModuleAgentContext(input.workspaceId, activeAgent);

  const baseExtra =
    activeAgent === "sales"
      ? salesExtraContext
      : [extraContext, collaborationBlock].filter(Boolean).join("\n\n");

  const promptExtra =
    [baseExtra, moduleContext.promptBlock].filter(Boolean).join("\n\n") || undefined;

  const { result, mode } = await runAgentTurn({
    agent: activeAgent,
    routing: { ...routing, selected_agent: activeAgent },
    history,
    userMessage: input.message,
    workspaceId: input.workspaceId,
    channel,
    memoryContext,
    retrievedKnowledge,
    extraContext: promptExtra,
  });

  const boundaryViolation = detectBoundaryViolation(
    activeAgent,
    result.response,
    input.message,
  );
  let boundaryHandoff = result.handoff_request;
  let boundaryAdjustedReply = result.response;
  if (boundaryViolation.violated && !boundaryHandoff?.handoff_requested) {
    const suggested = boundaryHandoffFromViolation(boundaryViolation, input.message);
    if (suggested) {
      boundaryHandoff = suggested;
      boundaryAdjustedReply = boundarySafeReply(activeAgent, boundaryViolation);
    }
  }

  const postEscalation = detectEscalation({
    message: input.message,
    history,
    agentConfidence: result.confidence,
    phase: "post",
  });

  let handoff = boundaryHandoff;
  let reply = boundaryAdjustedReply;
  let finalAgent = activeAgent;
  let citations = result.citations;
  let actionLog = result.action_log;
  let escalated = false;
  let handoffMeta: import("./runtime-store.ts").MessageHandoffMeta | undefined;

  if (postEscalation) {
    await escalateConversation({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      customerId: customerId ?? undefined,
      channel,
      trigger: postEscalation,
      customerMessage: input.message,
      customerName: memoryContext?.profile.name ?? input.collectedFields?.name,
    });
    reply = ESCALATION_REPLY;
    finalAgent = "human_review";
    escalated = true;
    actionLog = [...actionLog, `Escalated: ${postEscalation.reason}`];
  }

  if (!escalated && handoff?.handoff_requested && handoff.target_agent !== activeAgent) {
    let nextAgent = resolveNextAgent(activeAgent, handoff);
    if (nextAgent !== "human_review" && !isEnabledAgent(nextAgent, enabled)) {
      nextAgent = activeAgent;
    }

    if (nextAgent === "human_review") {
      await escalateConversation({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        customerId: customerId ?? undefined,
        channel,
        trigger: {
          reason: "human_request",
          detail: handoff.reason || "Agent requested human handoff.",
        },
        customerMessage: input.message,
        customerName: memoryContext?.profile.name ?? input.collectedFields?.name,
      });
      reply = ESCALATION_REPLY;
      finalAgent = "human_review";
      escalated = true;
    } else if (nextAgent !== activeAgent) {
      let handoffContextBlock = `Handoff context: ${handoff.conversation_summary || input.message}. Continue helping the customer.`;

      if (customerId) {
        const sessionId = resolveSessionId({
          channel,
          customerId,
          conversationId: input.conversationId,
        });
        const handoffResult = await handoffConversation({
          workspaceId: input.workspaceId,
          customerId,
          channel,
          sessionId,
          fromAgent: activeAgent,
          toAgent: nextAgent,
          reason: handoff.reason,
          context: handoff.conversation_summary || input.message,
        });

        if (!handoffResult.allowed) {
          actionLog = [...actionLog, handoffResult.message];
        } else {
          handoffContextBlock = handoffResult.contextBlock;
          handoffMeta = {
            from: activeAgent,
            to: nextAgent,
            reason: handoff.reason,
          };
          actionLog = [...actionLog, handoffResult.message];
        }
      }

      const followUp = await runAgentTurn({
        agent: nextAgent,
        routing: {
          ...routing,
          selected_agent: nextAgent,
          reason: `Handoff from ${activeAgent}: ${handoff.reason}`,
          knowledge_files: AGENT_CATALOG[nextAgent as AgentId].knowledgeSources,
        },
        history: [...history, { role: "user", content: input.message }],
        userMessage: `${handoffContextBlock}. Continue helping the customer.`,
        workspaceId: input.workspaceId,
        channel,
        memoryContext,
        retrievedKnowledge,
        extraContext: handoffContextBlock,
      });

      reply = followUp.result.response;
      finalAgent = nextAgent;
      handoff = followUp.result.handoff_request;
      citations = followUp.result.citations;
      actionLog = [...actionLog, ...followUp.result.action_log];
    }
  }

  if (customerId && !escalated) {
    const bookingConfirmation = await processBookingActionLog(
      input.workspaceId,
      actionLog,
      {
        customerId,
        name: memoryContext?.profile.name ?? input.collectedFields?.name,
        phone: memoryContext?.profile.phone ?? input.collectedFields?.phone,
        email: memoryContext?.profile.email ?? input.collectedFields?.email,
      },
    );
    if (bookingConfirmation) {
      reply = bookingConfirmation;
    }
  }

  const conversation = await appendConversationTurn({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    channel,
    agentUsed: finalAgent,
    intent: routing.primary_intent,
    routingReason: routing.reason,
    customerMessage: input.message,
    agentReply: reply,
    handoffReason: handoff?.reason,
    handoffMeta,
    collectedFields: input.collectedFields ?? handoff?.collected_fields,
    conversationStatus: escalated ? "escalated" : undefined,
  });

  const isFirstMessage = history.filter((m) => m.role === "user").length === 0;
  if (isFirstMessage) {
    const { publish } = await import("./event-bus.ts");
    await publish(input.workspaceId, "conversation.started", {
      conversationId: conversation.id,
      channel,
      customerId: customerId ?? undefined,
      intent: routing.primary_intent,
    });
  }

  if (handoffMeta) {
    const { publish } = await import("./event-bus.ts");
    await publish(input.workspaceId, "agent.handoff", {
      conversationId: conversation.id,
      from: handoffMeta.from,
      to: handoffMeta.to,
      reason: handoffMeta.reason,
      channel,
    });
  }

  if (escalated && conversation.conversationStatus !== "escalated") {
    await db.setConversationStatus(input.workspaceId, conversation.id, "escalated");
    conversation.conversationStatus = "escalated";
  }

  if (!customerId && conversation.id) {
    customerId = `${input.workspaceId}:conv:${conversation.id}`;
    if (!memoryContext) {
      memoryContext = await loadMemoryContext({
        workspaceId: input.workspaceId,
        customerId,
        channel,
        sessionId: resolveSessionId({ channel, customerId, conversationId: conversation.id }),
        collectedFields: input.collectedFields,
        recentLimit: 24,
      });
    }
  }

  if (customerId) {
    await persistTurn({
      workspaceId: input.workspaceId,
      customerId,
      channel,
      sessionId: resolveSessionId({
        channel,
        customerId,
        conversationId: conversation.id,
      }),
      userMessage: input.message,
      assistantMessage: reply,
      agent: finalAgent,
      intent: routing.primary_intent,
      collectedFields: input.collectedFields ?? handoff?.collected_fields,
    });

    if (!escalated) {
      const userMessageCount =
        history.filter((message) => message.role === "user").length + 1;
      const wasQualified = isQualifiedLead(
        (memoryContext?.profile.leadData ?? {}) as import("./lead-qualification.ts").LeadFields,
      );
      const qualification = await processLeadQualification({
        workspaceId: input.workspaceId,
        customerId,
        message: input.message,
        channel,
        conversationId: conversation.id,
        agentUsed: finalAgent,
        collectedFields: input.collectedFields,
        existingLeadData: memoryContext?.profile.leadData,
        previouslyQualified: wasQualified,
        userMessageCount,
      });

      if (qualification.qualified && memoryContext) {
        memoryContext.profile.leadData = {
          ...qualification.fields,
          qualified: true,
        };
      }
    }
  }

  if (finalAgent !== "human_review") {
    await recordMessageUsage(input.workspaceId, finalAgent);
  }

  return {
    reply,
    agent: finalAgent,
    intent: routing.primary_intent,
    routing_reason: routing.reason,
    handoff,
    citations,
    action_log: actionLog,
    state: {
      active_agent: finalAgent,
      last_intent: routing.primary_intent,
      escalated,
    },
    mode,
    conversation,
    typing_delay_ms: calculateHumanDelay(reply.length),
    escalated,
    products: finalAgent === "sales" && recommendedProducts.length > 0 ? recommendedProducts : undefined,
  };
}
