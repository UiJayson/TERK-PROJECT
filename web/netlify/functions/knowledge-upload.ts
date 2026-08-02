import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess, withRole } from "./_shared/auth-http.ts";
import { extractDocumentText, isSupportedDocument } from "./_shared/document-extract.ts";
import { createKnowledgeItem } from "./_shared/knowledge-items-store.ts";
import { isKnowledgeItemType } from "./_shared/knowledge.ts";
import { sanitizeText } from "./_shared/sanitize.ts";
import { scanExtractedText, validateUploadFile } from "./_shared/upload-validation.ts";

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const denied = withRole(auth, ["owner", "admin"]);
  if (denied) return denied;

  try {
    const form = await req.formData();
    const file = form.get("file");
    const titleInput = form.get("title");
    const typeInput = form.get("type");
    const tagsInput = form.get("tags");

    if (!(file instanceof File)) {
      return jsonResponse({ error: "File is required." }, { status: 400 });
    }

    if (typeof titleInput !== "string" || !titleInput.trim()) {
      return jsonResponse({ error: "Title is required." }, { status: 400 });
    }

    if (typeof typeInput !== "string" || !isKnowledgeItemType(typeInput)) {
      return jsonResponse(
        { error: "Valid type is required (product, service, pricing, faq, policy, document)." },
        { status: 400 },
      );
    }

    const maxBytes = 8 * 1024 * 1024;
    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateUploadFile({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      maxBytes,
      buffer,
    });

    if (!validation.ok) {
      return jsonResponse({ error: validation.error ?? "Invalid file." }, { status: 400 });
    }

    if (!isSupportedDocument(file.name, file.type || "application/octet-stream")) {
      return jsonResponse(
        { error: "Unsupported file type. Upload PDF, DOCX, or TXT." },
        { status: 400 },
      );
    }

    const text = await extractDocumentText({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      buffer,
    });

    if (!text) {
      return jsonResponse(
        { error: "Could not extract text from that document." },
        { status: 400 },
      );
    }

    const textScan = scanExtractedText(text);
    if (!textScan.ok) {
      return jsonResponse({ error: textScan.error ?? "Invalid file content." }, { status: 400 });
    }

    const title = sanitizeText(titleInput.trim(), 500);
    const { item, chunksIndexed } = await createKnowledgeItem(auth.workspace.id, {
      section: "documents",
      type: typeInput,
      tags: typeof tagsInput === "string" ? tagsInput : "",
      title,
      content: sanitizeText(text),
      document: {
        filename: sanitizeText(file.name, 255),
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      },
    });

    return jsonResponse({ item, indexed: { chunksIndexed } }, { status: 201 });
  } catch (error) {
    console.error("knowledge-upload.ts request failed:", error);
    const message = publicErrorMessage(error, "Upload failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/knowledge/upload",
};

export default withObservability(handler);
