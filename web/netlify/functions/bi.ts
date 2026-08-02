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
  detectOpportunities,
  detectPriceChanges,
  detectRisks,
  generateGrowthReport,
  generateSWOT,
  getCompetitorUrls,
  monitorCompetitors,
  runFullBIAnalysis,
  saveCompetitorUrls,
  sendWeeklyBIReport,
} from "./_shared/bi-agent.ts";

async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const workspaceId = auth.workspace.id;
  const action = context.params?.action;

  try {
    if (req.method === "GET" && !action) {
      const [competitors, insights, metrics, competitorUrls] = await Promise.all([
        db.listCompetitorData(workspaceId, 20),
        db.listBusinessInsights(workspaceId, undefined, 20),
        db.getBIMetrics(workspaceId),
        getCompetitorUrls(workspaceId),
      ]);

      return jsonResponse({
        competitors,
        insights,
        metrics,
        competitorUrls,
      });
    }

    if (req.method === "PATCH" && action === "competitor-urls") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as { urls?: string[] };
      const urls = await saveCompetitorUrls(workspaceId, body.urls ?? []);
      return jsonResponse({ competitorUrls: urls });
    }

    if (req.method === "POST" && action === "scrape") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const result = await monitorCompetitors(workspaceId);
      const changes = await detectPriceChanges(workspaceId);
      return jsonResponse({ ...result, priceChanges: changes });
    }

    if (req.method === "POST" && action === "analyze") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const analysis = await runFullBIAnalysis(workspaceId);
      return jsonResponse({ analysis });
    }

    if (req.method === "POST" && action === "swot") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const swot = await generateSWOT(workspaceId);
      return jsonResponse({ swot });
    }

    if (req.method === "POST" && action === "growth") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const growth = await generateGrowthReport(workspaceId);
      return jsonResponse({ growth });
    }

    if (req.method === "POST" && action === "opportunities") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const opportunities = await detectOpportunities(workspaceId);
      return jsonResponse({ opportunities });
    }

    if (req.method === "POST" && action === "risks") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const result = await detectRisks(workspaceId);
      return jsonResponse({ result });
    }

    if (req.method === "POST" && action === "weekly-report") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      await sendWeeklyBIReport(workspaceId);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("bi.ts request failed:", error);
    const message = publicErrorMessage(error, "Request failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
}

export const config: Config = {
  path: ["/api/bi", "/api/bi/:action"],
};

export default withObservability(handler);
