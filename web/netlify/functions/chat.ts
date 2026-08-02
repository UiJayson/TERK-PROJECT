import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { processWorkspaceMessage } from "./_shared/ai-runtime.ts";
import { optionalAuth } from "./_shared/auth-http.ts";
import { findWorkspaceByPublicKey } from "./_shared/auth-store.ts";
import { resolveNextAgent, runAgentTurn } from "./_shared/orchestrator.ts";
import { routeMessage } from "./_shared/router.ts";
import {
  checkEmbedIpLimit,
  checkEmbedKeyLimit,
  recordInvalidKeyProbe,
} from "./_shared/embed-rate-limit.ts";
import { log } from "./_shared/logger.ts";
import type { ChatRequest, ChatResponse, ConversationState } from "./_shared/types.ts";

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Public endpoint that spends AI credits — throttle per client IP.
  const limit = checkEmbedIpLimit(req);
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many messages. Please wait a moment and try again." },
      {
        status: 429,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Retry-After": String(limit.retryAfterSeconds),
        },
      },
    );
  }

  try {
    const body = (await req.json()) as ChatRequest & {
      conversation_id?: string;
      channel?: "website" | "whatsapp" | "instagram" | "email" | "dashboard";
      public_key?: string;
    };

    if (!body.message?.trim()) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    // Bound every user-supplied field: oversized payloads inflate AI cost
    // and can be used to abuse the model context window.
    if (typeof body.message !== "string" || body.message.length > 4000) {
      return Response.json(
        { error: "Message must be 4000 characters or fewer." },
        { status: 400 },
      );
    }
    if (body.history && (!Array.isArray(body.history) || body.history.length > 40)) {
      return Response.json({ error: "Invalid history." }, { status: 400 });
    }
    if (body.history?.some((turn) => typeof turn?.content !== "string" || turn.content.length > 4000)) {
      return Response.json({ error: "Invalid history entry." }, { status: 400 });
    }
    if (body.public_key !== undefined && (typeof body.public_key !== "string" || body.public_key.length > 100)) {
      return Response.json({ error: "Invalid workspace key." }, { status: 400 });
    }

    const auth = await optionalAuth(req);
    let workspaceId: string | null = auth?.workspace.id ?? null;
    let channel = body.channel ?? (auth ? "dashboard" : "website");

    if (!workspaceId && body.public_key) {
      const workspace = await findWorkspaceByPublicKey(body.public_key);
      if (!workspace) {
        // Starve key-enumeration scripts: after a few misses the prober only
        // ever sees 429, never the 404 signal that distinguishes keys.
        const probe = recordInvalidKeyProbe(req);
        if (!probe.allowed) {
          return Response.json(
            { error: "Too many requests. Please wait and try again." },
            {
              status: 429,
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Retry-After": String(probe.retryAfterSeconds),
              },
            },
          );
        }
        return Response.json({ error: "Invalid workspace key." }, { status: 404 });
      }

      // Cap total spend per widget key, independent of how many IPs the
      // traffic comes from.
      const keyLimit = checkEmbedKeyLimit(body.public_key);
      if (!keyLimit.allowed) {
        return Response.json(
          { error: "This chat is receiving a lot of messages. Please try again shortly." },
          {
            status: 429,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Retry-After": String(keyLimit.retryAfterSeconds),
            },
          },
        );
      }

      workspaceId = workspace.id;
      channel = body.channel ?? "website";
    }

    // Workspace chat (authenticated or public key) uses the full AI runtime.
    if (workspaceId) {
      try {
        const result = await processWorkspaceMessage({
          workspaceId,
          message: body.message,
          history: body.history,
          state: body.state,
          pageUrl: body.page_url,
          channel,
          conversationId: body.conversation_id,
        });

        const response: ChatResponse & {
          conversation_id?: string;
          typing_delay_ms?: number;
          escalated?: boolean;
          products?: import("./_shared/ai-runtime.ts").ProductCard[];
        } = {
          reply: result.reply,
          agent: result.agent,
          intent: result.intent as ChatResponse["intent"],
          routing_reason: result.routing_reason,
          handoff: result.handoff,
          citations: result.citations,
          action_log: result.action_log,
          state: result.state,
          mode: result.mode,
          conversation_id: result.conversation?.id,
          typing_delay_ms: result.typing_delay_ms,
          escalated: result.escalated,
          products: result.products,
        };

        return Response.json(response, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Chat failed";
        if (message === "NO_ACTIVE_AGENTS") {
          return Response.json(
            { error: "No active agents. Turn on an agent in My Agents." },
            { status: 400 },
          );
        }
        throw error;
      }
    }

    // Legacy public demo path — bundled sample knowledge only.
    const history = body.history ?? [];
    const initialState: ConversationState = body.state ?? {
      active_agent: "reception",
      last_intent: "greeting",
    };

    const routing = routeMessage(body.message, {
      pageUrl: body.page_url,
      state: initialState,
    });

    let activeAgent = routing.selected_agent;
    if (initialState.active_agent === "sales" && routing.selected_agent === "reception") {
      activeAgent = "sales";
    }

    const { result, mode } = await runAgentTurn({
      agent: activeAgent,
      routing: { ...routing, selected_agent: activeAgent },
      history,
      userMessage: body.message,
    });

    let handoff = result.handoff_request;
    let reply = result.response;
    let finalAgent = activeAgent;

    if (handoff?.handoff_requested && handoff.target_agent !== activeAgent) {
      const nextAgent = resolveNextAgent(activeAgent, handoff);
      if (nextAgent !== activeAgent) {
        const followUp = await runAgentTurn({
          agent: nextAgent,
          routing: {
            ...routing,
            selected_agent: nextAgent,
            reason: `Handoff from ${activeAgent}: ${handoff.reason}`,
          },
          history: [...history, { role: "user", content: body.message }],
          userMessage: `Handoff context: ${handoff.conversation_summary || body.message}. Continue helping the customer.`,
        });

        reply = followUp.result.response;
        finalAgent = nextAgent;
        handoff = followUp.result.handoff_request;
      }
    }

    const response: ChatResponse = {
      reply,
      agent: finalAgent,
      intent: routing.primary_intent,
      routing_reason: routing.reason,
      handoff,
      citations: result.citations,
      action_log: result.action_log,
      state: {
        active_agent: finalAgent,
        last_intent: routing.primary_intent,
      },
      mode,
    };

    return Response.json(response, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    log.error("chat_request_failed", {
      function: "chat",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
};

export const config: Config = {
  path: "/api/chat",
};

export default withObservability(handler);
