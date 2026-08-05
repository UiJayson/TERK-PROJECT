import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import {
  jsonResponse,
  optionsResponse,
  requireAuthWithWorkspaceAccess,
  withRole,
} from "./_shared/auth-http.ts";
import { getWizardStatus } from "./_shared/onboarding/wizard/wizard-controller.ts";
import { processDocumentUpload } from "./_shared/onboarding/ingestion/pipeline.ts";
import {
  listDocuments,
  listFlaggedChunks,
  resolveChunkContradiction,
} from "./_shared/onboarding/ingestion/document-store.ts";

/**
 * Document upload + contradiction review API (Problem 3 §Step 2). Upload is
 * hard-gated: rejected until the onboarding wizard is 100% complete.
 */
async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;
  const workspaceId = auth.workspace.id;
  const action = context.params?.action;

  try {
    // GET /api/knowledge-onboarding/documents
    if (req.method === "GET" && action === "documents") {
      const documents = await listDocuments(workspaceId);
      return jsonResponse({ documents });
    }

    // GET /api/knowledge-onboarding/contradictions
    if (req.method === "GET" && action === "contradictions") {
      const chunks = await listFlaggedChunks(workspaceId);
      return jsonResponse({ chunks });
    }

    // POST /api/knowledge-onboarding/upload
    if (req.method === "POST" && action === "upload") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const wizard = await getWizardStatus(workspaceId);
      if (!wizard.complete) {
        return jsonResponse(
          {
            error: "WIZARD_INCOMPLETE",
            message: "Complete the onboarding wizard before uploading documents.",
            missing: wizard.sectionsMissing,
          },
          { status: 409 },
        );
      }

      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonResponse({ error: "file field is required (multipart)" }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await processDocumentUpload({
        workspaceId,
        filename: file.name,
        mimeType: file.type,
        buffer,
      });
      return jsonResponse({ ok: true, result });
    }

    // POST /api/knowledge-onboarding/resolve  { chunkId, action, correctedText? }
    if (req.method === "POST" && action === "resolve") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json().catch(() => ({}))) as {
        chunkId?: string;
        action?: "confirm" | "discard" | "edit";
        correctedText?: string;
      };
      if (!body.chunkId || !body.action) {
        return jsonResponse({ error: "chunkId and action are required" }, { status: 400 });
      }
      await resolveChunkContradiction(
        workspaceId,
        body.chunkId,
        body.action,
        body.correctedText,
      );
      const remaining = await listFlaggedChunks(workspaceId);
      return jsonResponse({ ok: true, remaining });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    if (message === "UNSUPPORTED_FILE_TYPE") {
      return jsonResponse(
        { error: "Unsupported file type. Upload PDF, DOCX, or TXT." },
        { status: 400 },
      );
    }
    console.error("knowledge-onboarding.ts request failed:", error);
    return jsonResponse({ error: publicErrorMessage(error, "Request failed") }, { status: 500 });
  }
}

export const config: Config = {
  path: [
    "/api/knowledge-onboarding",
    "/api/knowledge-onboarding/:action",
    "/api/knowledge/onboarding/:action",
  ],
};

export default withObservability(handler);
