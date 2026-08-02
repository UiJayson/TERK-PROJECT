import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { getConfig } from "./_shared/config.ts";
import { isAdminAuthorized } from "./_shared/admin-auth.ts";
import {
  getAllKnowledge,
  seedKnowledgeFromBundle,
  setKnowledge,
  SHARED_FILES,
  type SharedFile,
} from "./_shared/knowledge-store.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function getWorkspaceId(): string {
  return getConfig().auth.defaultWorkspaceId;
}

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!isAdminAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const workspaceId = getWorkspaceId();

  try {
    if (req.method === "GET") {
      const files = await getAllKnowledge(workspaceId);
      return Response.json({ files }, { headers: corsHeaders });
    }

    if (req.method === "POST") {
      await seedKnowledgeFromBundle(workspaceId);
      const files = await getAllKnowledge(workspaceId);
      return Response.json({ ok: true, files }, { headers: corsHeaders });
    }

    if (req.method === "PUT") {
      const body = (await req.json()) as { path?: string; content?: string };
      if (!body.path || body.content === undefined) {
        return Response.json({ error: "path and content are required" }, { status: 400, headers: corsHeaders });
      }

      if (!SHARED_FILES.includes(body.path as SharedFile)) {
        return Response.json({ error: "Invalid shared file path" }, { status: 400, headers: corsHeaders });
      }

      await setKnowledge(body.path as SharedFile, body.content, workspaceId);
      return Response.json({ ok: true, path: body.path }, { headers: corsHeaders });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
};

export const config: Config = {
  path: "/api/admin/knowledge",
};

export default withObservability(handler);
