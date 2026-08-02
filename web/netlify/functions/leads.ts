import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess } from "./_shared/auth-http.ts";
import { apiResponseCache, getOrCompute, workspaceCacheKey } from "./_shared/cache.ts";
import { cachedJsonResponse } from "./_shared/http-cache.ts";
import { listLeadsPage } from "./_shared/runtime-store.ts";

const LIST_CACHE_TTL_MS = 5_000;

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const cursor = url.searchParams.get("cursor");
  const status = url.searchParams.get("status");

  const cacheKey = workspaceCacheKey(
    auth.workspace.id,
    "leads",
    `${limit}:${cursor ?? ""}:${status ?? ""}`,
  );
  const page = await getOrCompute(apiResponseCache, cacheKey, LIST_CACHE_TTL_MS, () =>
    listLeadsPage(auth.workspace.id, { limit, cursor, status }),
  );
  const typed = page as Awaited<ReturnType<typeof listLeadsPage>>;

  return cachedJsonResponse(req, {
    leads: typed.items,
    nextCursor: typed.nextCursor,
    hasMore: typed.hasMore,
  });
};

export const config: Config = {
  path: "/api/leads",
};

export default withObservability(handler);
