import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import { processWorkspaceMessage } from "./_shared/ai-runtime.ts";
import { isAgentId } from "./_shared/agents-catalog.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess, withRole } from "./_shared/auth-http.ts";

async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const denied = withRole(auth, ["owner", "admin"]);
  if (denied) return denied;

  try {
    const agentId = context.params?.id;
    if (!agentId || !isAgentId(agentId)) {
      return jsonResponse({ error: "Unknown agent." }, { status: 404 });
    }

    const body = (await req.json()) as {
      message?: string;
      conversation_id?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };
    const message = body.message?.trim() ?? "";
    if (!message) {
      return jsonResponse({ error: "Message is required." }, { status: 400 });
    }

    const result = await processWorkspaceMessage({
      workspaceId: auth.workspace.id,
      message,
      history: body.history,
      forceAgent: agentId,
      channel: "dashboard",
      conversationId: body.conversation_id,
    });

    return jsonResponse({
      agent: result.agent,
      reply: result.reply,
      handoff: result.handoff,
      citations: result.citations,
      action_log: result.action_log,
      mode: result.mode,
      routing_reason: result.routing_reason,
      intent: result.intent,
      conversation_id: result.conversation?.id,
      state: result.state,
    });
  } catch (error) {
    console.error("agents-test.ts request failed:", error);
    const message = publicErrorMessage(error, "Test failed");
    if (message === "NO_ACTIVE_AGENTS") {
      return jsonResponse(
        { error: "This agent is paused. Turn it on before testing." },
        { status: 400 },
      );
    }
    return jsonResponse({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/agents/:id/test",
};

export default withObservability(handler);
