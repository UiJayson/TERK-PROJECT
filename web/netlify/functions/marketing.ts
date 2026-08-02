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
import { getCrmConfig, saveCrmConfig, syncLeadsToCRM } from "./_shared/crm-sync.ts";
import {
  generateFullCampaign,
  scrapeCompetitorPricing,
  scrapeIndustryNews,
} from "./_shared/marketing-agent.ts";

async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const workspaceId = auth.workspace.id;
  const action = context.params?.action;

  try {
    if (req.method === "GET" && !action) {
      const [stats, campaigns, insights] = await Promise.all([
        db.getMarketingStats(workspaceId),
        db.listMarketingCampaigns(workspaceId),
        db.listMarketingInsights(workspaceId, 10),
      ]);

      return jsonResponse({
        stats,
        campaigns,
        insights,
        crm: await getCrmConfig(workspaceId),
      });
    }

    if (req.method === "POST" && action === "campaign") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as {
        productId?: string;
        productName?: string;
        leadType?: string;
      };

      const productName = body.productName?.trim();
      if (!productName && !body.productId) {
        return jsonResponse({ error: "productName or productId is required." }, { status: 400 });
      }

      const campaign = await generateFullCampaign({
        workspaceId,
        productId: body.productId,
        productName: productName ?? "Product",
        leadType: body.leadType,
      });

      return jsonResponse({ campaign });
    }

    if (req.method === "POST" && action === "scrape-competitor") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as { url?: string };
      if (!body.url?.trim()) {
        return jsonResponse({ error: "url is required." }, { status: 400 });
      }

      const insight = await scrapeCompetitorPricing(workspaceId, body.url.trim());
      return jsonResponse({ insight });
    }

    if (req.method === "POST" && action === "scrape-news") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as { feedUrl?: string };
      if (!body.feedUrl?.trim()) {
        return jsonResponse({ error: "feedUrl is required." }, { status: 400 });
      }

      const insight = await scrapeIndustryNews(workspaceId, body.feedUrl.trim());
      return jsonResponse({ insight });
    }

    if (req.method === "POST" && action === "crm-sync") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const result = await syncLeadsToCRM(workspaceId);
      return jsonResponse({ result });
    }

    if (req.method === "PATCH" && action === "crm-config") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as {
        provider?: string;
        webhookUrl?: string;
        apiKey?: string;
        enabled?: boolean;
      };

      if (!body.provider || !body.webhookUrl) {
        return jsonResponse({ error: "provider and webhookUrl are required." }, { status: 400 });
      }

      const config = await saveCrmConfig(workspaceId, {
        provider: body.provider as "hubspot" | "salesforce" | "zoho" | "webhook",
        webhookUrl: body.webhookUrl,
        apiKey: body.apiKey,
        enabled: body.enabled,
      });

      return jsonResponse({ crm: config });
    }

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("marketing.ts request failed:", error);
    const message = publicErrorMessage(error, "Request failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
}

export const config: Config = {
  path: ["/api/marketing", "/api/marketing/:action"],
};

export default withObservability(handler);
