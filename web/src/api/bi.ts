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

export interface BIMetrics {
  conversationCount: number;
  leadCount: number;
  qualifiedLeads: number;
  appointmentCount: number;
  negativeConversations: number;
  escalatedConversations: number;
  lostLeads: number;
  complaintMessages: number;
}

export interface CompetitorData {
  id: string;
  sourceUrl: string;
  mentions: string[];
  summary: string;
  scrapedAt: string;
  createdAt: string;
}

export interface BusinessInsight {
  id: string;
  type: "swot" | "growth_report" | "opportunity" | "risk";
  title: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export async function fetchBIDashboard(): Promise<{
  competitors: CompetitorData[];
  insights: BusinessInsight[];
  metrics: BIMetrics;
  competitorUrls: string[];
}> {
  const data = await request("/api/bi");
  return {
    competitors: (data.competitors as CompetitorData[]) ?? [],
    insights: (data.insights as BusinessInsight[]) ?? [],
    metrics: data.metrics as BIMetrics,
    competitorUrls: (data.competitorUrls as string[]) ?? [],
  };
}

export async function saveBICompetitorUrls(urls: string[]): Promise<string[]> {
  const data = await request("/api/bi/competitor-urls", {
    method: "PATCH",
    body: JSON.stringify({ urls }),
  });
  return (data.competitorUrls as string[]) ?? [];
}

export async function scrapeBICompetitors(): Promise<{
  scraped: number;
  errors: string[];
}> {
  const data = await request("/api/bi/scrape", { method: "POST" });
  return {
    scraped: Number(data.scraped ?? 0),
    errors: (data.errors as string[]) ?? [],
  };
}

export async function runBIAnalysis(): Promise<{
  swot: BusinessInsight;
  growth: BusinessInsight;
  opportunities: BusinessInsight[];
  risks: BusinessInsight[];
}> {
  const data = await request("/api/bi/analyze", { method: "POST" });
  const analysis = data.analysis as Record<string, unknown>;
  return {
    swot: analysis.swot as BusinessInsight,
    growth: analysis.growth as BusinessInsight,
    opportunities: (analysis.opportunities as BusinessInsight[]) ?? [],
    risks: (analysis.risks as BusinessInsight[]) ?? [],
  };
}

export async function sendBIWeeklyReport(): Promise<void> {
  await request("/api/bi/weekly-report", { method: "POST" });
}
