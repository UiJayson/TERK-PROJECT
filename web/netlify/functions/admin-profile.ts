import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { getConfig } from "./_shared/config.ts";
import { isAdminAuthorized } from "./_shared/admin-auth.ts";
import * as db from "./_shared/db.ts";
import { setKnowledge, type SharedFile } from "./_shared/knowledge-store.ts";
import {
  generateSharedFromProfile,
  type WorkspaceProfile,
} from "./_shared/profile-generator.ts";

async function handler(req: Request, _context: Context) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (!isAdminAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });
  }

  const workspaceId = getConfig().auth.defaultWorkspaceId;

  try {
    if (req.method === "GET") {
      const profile = (await db.getBusinessProfile(workspaceId)) ?? {};
      return Response.json({ profile }, { headers: cors });
    }

    if (req.method === "PUT") {
      const profile = (await req.json()) as Record<string, unknown>;
      await db.saveBusinessProfile(workspaceId, profile);

      const generated = generateSharedFromProfile(profile as unknown as WorkspaceProfile);
      for (const [filePath, content] of Object.entries(generated)) {
        await setKnowledge(filePath as SharedFile, content, workspaceId);
      }

      return Response.json(
        { ok: true, profile, regenerated: Object.keys(generated) },
        { headers: cors },
      );
    }

    return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500, headers: cors });
  }
};

export const config: Config = {
  path: "/api/admin/profile",
};

export default withObservability(handler);
