import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess, withRole } from "./_shared/auth-http.ts";
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  listKnowledgeItems,
  searchKnowledgeItems,
  updateKnowledgeItem,
} from "./_shared/knowledge-items-store.ts";
import {
  CORE_SHARED_FILES,
  getAllKnowledge,
  setKnowledge,
  type CoreSharedFile,
} from "./_shared/knowledge-store.ts";
import { isKnowledgeSection } from "./_shared/knowledge-types.ts";
import { searchKnowledge } from "./_shared/knowledge.ts";
import { sanitizeOptionalText, sanitizeText } from "./_shared/sanitize.ts";

function isCoreSharedFile(path: string): path is CoreSharedFile {
  return (CORE_SHARED_FILES as readonly string[]).includes(path);
}

async function getCoreKnowledgeFiles(workspaceId: string): Promise<Record<string, string>> {
  const all = await getAllKnowledge(workspaceId);
  const files: Record<string, string> = {};
  for (const file of CORE_SHARED_FILES) {
    files[file] = all[file] ?? "";
  }
  return files;
}

async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const workspaceId = auth.workspace.id;
  const itemId = context.params?.id;

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const filesMode = url.searchParams.get("files");

      if (filesMode === "1" || filesMode === "true") {
        const files = await getCoreKnowledgeFiles(workspaceId);
        return jsonResponse({ files });
      }

      const query = url.searchParams.get("q") ?? "";
      const testSearch = url.searchParams.get("test") === "1" || url.searchParams.get("semantic") === "1";

      if (testSearch && query.trim()) {
        const results = await searchKnowledge(workspaceId, query, 5);
        return jsonResponse({ results });
      }

      const section = url.searchParams.get("section") ?? "";
      let items = await listKnowledgeItems(workspaceId);

      if (section && isKnowledgeSection(section)) {
        items = items.filter((item) => item.section === section);
      }

      if (query) {
        items = searchKnowledgeItems(items, query);
      }

      return jsonResponse({ items });
    }

    if (req.method === "POST" && !itemId) {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as {
        path?: string;
        content?: string;
        section?: string;
        title?: string;
        type?: string;
        tags?: string | string[];
        imageUrl?: string | null;
        price?: number | null;
        currency?: string | null;
        stockStatus?: string | null;
      };

      if (body.path !== undefined) {
        if (!isCoreSharedFile(body.path)) {
          return jsonResponse({ error: "Invalid shared file path." }, { status: 400 });
        }
        if (body.content === undefined) {
          return jsonResponse({ error: "Content is required." }, { status: 400 });
        }

        await setKnowledge(body.path, sanitizeText(body.content), workspaceId);
        return jsonResponse({ ok: true, path: body.path });
      }

      if (!body.title?.trim() || !body.content?.trim()) {
        return jsonResponse({ error: "Title and content are required." }, { status: 400 });
      }
      if (!body.type?.trim()) {
        return jsonResponse({ error: "Type is required." }, { status: 400 });
      }

      const { item } = await createKnowledgeItem(workspaceId, {
        section: body.section && isKnowledgeSection(body.section) ? body.section : "company",
        type: body.type,
        tags: body.tags,
        title: sanitizeText(body.title, 500),
        content: sanitizeText(body.content),
        imageUrl: body.imageUrl ?? null,
        price: body.price ?? null,
        currency: body.currency ?? null,
        stockStatus: body.stockStatus ?? null,
      });

      return jsonResponse({ item }, { status: 201 });
    }

    if (req.method === "PATCH" && itemId) {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as {
        section?: string;
        title?: string;
        content?: string;
        type?: string;
        tags?: string | string[];
        imageUrl?: string | null;
        price?: number | null;
        currency?: string | null;
        stockStatus?: string | null;
      };

      if (body.section && !isKnowledgeSection(body.section)) {
        return jsonResponse({ error: "Invalid section." }, { status: 400 });
      }

      const item = await updateKnowledgeItem(workspaceId, itemId, {
        section: body.section && isKnowledgeSection(body.section) ? body.section : undefined,
        type: body.type,
        tags: body.tags,
        title: sanitizeOptionalText(body.title, 500),
        content: sanitizeOptionalText(body.content),
        imageUrl: body.imageUrl,
        price: body.price,
        currency: body.currency,
        stockStatus: body.stockStatus,
      });

      return jsonResponse({ item });
    }

    if (req.method === "DELETE" && itemId) {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      await deleteKnowledgeItem(workspaceId, itemId);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("knowledge.ts request failed:", error);
    const message = publicErrorMessage(error, "Request failed");
    if (message === "ITEM_NOT_FOUND") {
      return jsonResponse({ error: "Knowledge item not found." }, { status: 404 });
    }
    return jsonResponse({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: ["/api/knowledge", "/api/knowledge/:id"],
};

export default withObservability(handler);
