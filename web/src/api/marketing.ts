import { getStoredToken } from "../auth/api";

async function request(path: string, init: RequestInit = {}) {
  const token = getStoredToken();
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error ?? "Request failed"));
  }
  return data;
}

export interface MarketingStats {
  leadMagnetsCreated: number;
  campaignsActive: number;
  leadsGenerated: number;
  competitorInsights: number;
}

export interface MarketingCampaign {
  id: string;
  name: string;
  productId: string | null;
  status: "draft" | "active" | "completed";
  leadMagnet: Record<string, unknown> | null;
  landingCopy: Record<string, unknown> | null;
  emailSequence: Record<string, unknown> | null;
  leadsGenerated: number;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingInsight {
  id: string;
  type: "competitor_pricing" | "industry_news";
  sourceUrl: string;
  title: string | null;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface CrmConfig {
  provider: "hubspot" | "salesforce" | "zoho" | "webhook";
  webhookUrl: string;
  apiKey?: string;
  enabled?: boolean;
}

export async function fetchMarketingDashboard(): Promise<{
  stats: MarketingStats;
  campaigns: MarketingCampaign[];
  insights: MarketingInsight[];
  crm: CrmConfig | null;
}> {
  const data = await request("/api/marketing");
  return {
    stats: data.stats as MarketingStats,
    campaigns: (data.campaigns as MarketingCampaign[]) ?? [],
    insights: (data.insights as MarketingInsight[]) ?? [],
    crm: (data.crm as CrmConfig | null) ?? null,
  };
}

export async function generateMarketingCampaign(input: {
  productId?: string;
  productName: string;
  leadType?: string;
}): Promise<MarketingCampaign> {
  const data = await request("/api/marketing/campaign", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.campaign as MarketingCampaign;
}

export async function syncMarketingCrm(): Promise<{
  exportedCount: number;
  method: string;
  provider: string;
}> {
  const data = await request("/api/marketing/crm-sync", { method: "POST" });
  const result = data.result as Record<string, unknown>;
  return {
    exportedCount: Number(result.exportedCount ?? 0),
    method: String(result.method ?? "csv"),
    provider: String(result.provider ?? "webhook"),
  };
}
