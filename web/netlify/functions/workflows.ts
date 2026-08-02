import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import {
  jsonResponse,
  optionsResponse,
  requireAuthWithWorkspaceAccess,
  withRole,
} from "./_shared/auth-http.ts";
import * as db from "./_shared/db.ts";
import {
  createWorkflow,
  executeWorkflow,
  getWorkflowStatus,
  seedPrebuiltWorkflows,
} from "./_shared/workflow-engine.ts";

async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const workspaceId = auth.workspace.id;
  const action = context.params?.action;

  try {
    if (req.method === "GET" && !action) {
      const [workflows, executions, stats] = await Promise.all([
        db.listWorkflows(workspaceId),
        db.listWorkflowExecutions(workspaceId, undefined, 30),
        db.getWorkflowStats(workspaceId),
      ]);

      if (workflows.length === 0) {
        await seedPrebuiltWorkflows(workspaceId);
        const seeded = await db.listWorkflows(workspaceId);
        return jsonResponse({ workflows: seeded, executions, stats });
      }

      return jsonResponse({ workflows, executions, stats });
    }

    if (req.method === "GET" && action === "status") {
      const url = new URL(req.url);
      const workflowId = url.searchParams.get("workflowId");
      if (!workflowId) {
        return jsonResponse({ error: "workflowId is required." }, { status: 400 });
      }
      const status = await getWorkflowStatus(workspaceId, workflowId);
      return jsonResponse(status);
    }

    if (req.method === "POST" && !action) {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as {
        name?: string;
        triggers?: db.WorkflowTriggerType[];
        steps?: db.WorkflowStep[];
      };

      if (!body.name?.trim() || !body.triggers?.length || !body.steps?.length) {
        return jsonResponse(
          { error: "name, triggers, and steps are required." },
          { status: 400 },
        );
      }

      const workflow = await createWorkflow(
        workspaceId,
        body.name.trim(),
        body.triggers,
        body.steps,
      );
      return jsonResponse({ workflow });
    }

    if (req.method === "POST" && action === "seed") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const workflows = await seedPrebuiltWorkflows(workspaceId);
      return jsonResponse({ workflows });
    }

    if (req.method === "POST" && action === "execute") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as {
        workflowId?: string;
        context?: Record<string, unknown>;
      };

      if (!body.workflowId) {
        return jsonResponse({ error: "workflowId is required." }, { status: 400 });
      }

      const execution = await executeWorkflow(
        workspaceId,
        body.workflowId,
        body.context ?? {},
      );
      return jsonResponse({ execution });
    }

    if (req.method === "PATCH" && action) {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as {
        name?: string;
        triggers?: db.WorkflowTriggerType[];
        steps?: db.WorkflowStep[];
        status?: "active" | "paused";
      };

      const existing = await db.getWorkflow(workspaceId, action);
      if (!existing) {
        return jsonResponse({ error: "Workflow not found" }, { status: 404 });
      }

      const workflow = await db.saveWorkflow(workspaceId, {
        ...existing,
        name: body.name ?? existing.name,
        triggers: body.triggers ?? existing.triggers,
        steps: body.steps ?? existing.steps,
        status: body.status ?? existing.status,
      });

      return jsonResponse({ workflow });
    }

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("workflows.ts request failed:", error);
    const message = publicErrorMessage(error, "Request failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
}

export const config: Config = {
  path: ["/api/workflows", "/api/workflows/:action"],
};

export default withObservability(handler);
