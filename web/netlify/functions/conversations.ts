import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess, withRole } from "./_shared/auth-http.ts";
import { apiResponseCache, getOrCompute, invalidateWorkspaceCaches, workspaceCacheKey } from "./_shared/cache.ts";
import { cachedJsonResponse } from "./_shared/http-cache.ts";
import * as db from "./_shared/db.ts";
import { listConversationsPage } from "./_shared/runtime-store.ts";

const LIST_CACHE_TTL_MS = 5_000; // dedup window: identical requests within 5s share one DB read

async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const conversationId = context.params?.id;
  const action = context.params?.action;
  const url = new URL(req.url);

  if (req.method === "GET" && !conversationId) {
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const cursor = url.searchParams.get("cursor");
    const status = url.searchParams.get("status");

    const cacheKey = workspaceCacheKey(
      auth.workspace.id,
      "conversations",
      `${limit}:${cursor ?? ""}:${status ?? ""}`,
    );
    const page = await getOrCompute(apiResponseCache, cacheKey, LIST_CACHE_TTL_MS, () =>
      listConversationsPage(auth.workspace.id, { limit, cursor, status }),
    );
    const typed = page as Awaited<ReturnType<typeof listConversationsPage>>;

    return cachedJsonResponse(req, {
      conversations: typed.items,
      nextCursor: typed.nextCursor,
      hasMore: typed.hasMore,
    });
  }

  if (req.method === "GET" && conversationId && action === "messages") {
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const cursor = url.searchParams.get("cursor");
    const page = await db.getConversationMessagesPage(auth.workspace.id, conversationId, {
      limit,
      cursor,
    });
    return cachedJsonResponse(req, {
      messages: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  }

  if (req.method === "POST" && conversationId && action === "resolve") {
    const denied = withRole(auth, ["owner", "admin"]);
    if (denied) return denied;

    await db.setConversationStatus(auth.workspace.id, conversationId, "resolved");
    invalidateWorkspaceCaches(auth.workspace.id);
    return jsonResponse({ ok: true, conversationId, status: "resolved" });
  }

  return jsonResponse({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: ["/api/conversations", "/api/conversations/:id/:action"],
};

export default withObservability(handler);
