import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import { AGENT_CATALOG, AGENT_IDS, isAgentId } from "./_shared/agents-catalog.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess, withRole } from "./_shared/auth-http.ts";
import { updateWorkspaceAgent, findWorkspaceById } from "./_shared/auth-store.ts";
import { bundledContent } from "./_shared/content-bundle.ts";
import { sanitizeOptionalText } from "./_shared/sanitize.ts";
function buildAgentViews(workspace: {
  agentConfigs: Array<{
    id: "reception" | "sales" | "marketing";
    enabled: boolean;
    lastUpdated: string;
    notes: string;
  }>;
}) {
  return AGENT_IDS.map((id) => {
    const definition = AGENT_CATALOG[id];
    const config = workspace.agentConfigs.find((agent) => agent.id === id) ?? {
      id,
      enabled: id === "reception",
      lastUpdated: new Date().toISOString(),
      notes: "",
    };

    return {
      id: definition.id,
      name: definition.name,
      role: definition.role,
      description: definition.description,
      status: config.enabled ? "active" : "paused",
      enabled: config.enabled,
      model: definition.model,
      knowledgeSources: definition.knowledgeSources,
      channelsConnected: definition.channels,
      lastUpdated: config.lastUpdated,
      notes: config.notes,
      prompt: bundledContent[definition.promptPath] ?? "",
    };
  });
}

async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  try {
    if (req.method === "GET") {
      return jsonResponse({ agents: buildAgentViews(auth.workspace) });
    }

    if (req.method === "PATCH") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;
      const agentId = context.params?.id;
      if (!agentId || !isAgentId(agentId)) {
        return jsonResponse({ error: "Unknown agent." }, { status: 404 });
      }

      const body = (await req.json()) as { enabled?: boolean; notes?: string };
      if (body.enabled === undefined && body.notes === undefined) {
        return jsonResponse({ error: "Nothing to update." }, { status: 400 });
      }

      // Plan gate: enabling an agent beyond the plan's agent limit is the
      // enforcement point — the chat runtime never re-counts agents.
      if (body.enabled === true) {
        const { getUsageSnapshot } = await import("./_shared/billing-gate.ts");
        const { PLANS } = await import("./_shared/billing-plans.ts");
        const snapshot = await getUsageSnapshot(auth.workspace.id);
        const agentLimit = PLANS[snapshot.plan].agentLimit;
        const enabledCount = auth.workspace.agentConfigs.filter(
          (agent) => agent.enabled && agent.id !== agentId,
        ).length;
        if (agentLimit !== null && enabledCount + 1 > agentLimit) {
          return jsonResponse(
            {
              error: `Your ${PLANS[snapshot.plan].name} plan allows ${agentLimit} active agent(s). Upgrade to enable more.`,
              upgradePlan: snapshot.plan === "free" || snapshot.plan === "starter" ? "growth" : "pro",
            },
            { status: 402 },
          );
        }
      }

      await updateWorkspaceAgent(auth.workspace.id, agentId, {
        enabled: body.enabled,
        notes: sanitizeOptionalText(body.notes, 2000),
      });

      const refreshed = await findWorkspaceById(auth.workspace.id);
      const agents = buildAgentViews(refreshed ?? auth.workspace);
      const agent = agents.find((item) => item.id === agentId);
      return jsonResponse({ agent, agents });
    }

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("agents.ts request failed:", error);
    const message = publicErrorMessage(error, "Request failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: ["/api/agents", "/api/agents/:id"],
};

export default withObservability(handler);
