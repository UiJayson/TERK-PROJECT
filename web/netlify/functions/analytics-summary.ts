import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess } from "./_shared/auth-http.ts";
import { analyticsCache, getOrCompute, workspaceCacheKey } from "./_shared/cache.ts";
import { cachedJsonResponse } from "./_shared/http-cache.ts";
import { getAnalyticsSummary } from "./_shared/runtime-store.ts";

// The summary aggregates every conversation + lead in the workspace; a 60s
// cache keeps dashboards fresh enough while bounding DB load under fan-out.
const SUMMARY_CACHE_TTL_MS = 60_000;

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const summary = await getOrCompute(
    analyticsCache,
    workspaceCacheKey(auth.workspace.id, "analytics-summary"),
    SUMMARY_CACHE_TTL_MS,
    () => getAnalyticsSummary(auth.workspace.id),
  );
  return cachedJsonResponse(req, { summary }, { maxAgeSeconds: 30 });
};

export const config: Config = {
  path: "/api/analytics/summary",
};

export default withObservability(handler);
