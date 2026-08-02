import * as db from "./db.ts";
import type { RuntimeLead } from "./runtime-store.ts";

export type CrmProvider = "hubspot" | "salesforce" | "zoho" | "webhook";

export interface CrmConfig {
  provider: CrmProvider;
  webhookUrl: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface CrmSyncResult {
  provider: CrmProvider;
  method: "csv" | "webhook";
  exportedCount: number;
  csv?: string;
  webhookStatus?: number;
  webhookResponse?: string;
}

function parseCrmConfig(profile: Record<string, unknown> | null): CrmConfig | null {
  const raw = profile?.crmConfig;
  if (!raw || typeof raw !== "object") return null;

  const config = raw as Record<string, unknown>;
  const provider = config.provider;
  const webhookUrl = config.webhookUrl;

  if (
    provider !== "hubspot" &&
    provider !== "salesforce" &&
    provider !== "zoho" &&
    provider !== "webhook"
  ) {
    return null;
  }

  if (typeof webhookUrl !== "string" || !webhookUrl.trim()) {
    return null;
  }

  return {
    provider,
    webhookUrl: webhookUrl.trim(),
    apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
    enabled: config.enabled !== false,
  };
}

function leadToCsvRow(lead: RuntimeLead): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [
    escape(lead.id),
    escape(lead.name),
    escape(lead.email),
    escape(lead.phone),
    escape(lead.productInterest),
    escape(String(lead.leadScore)),
    escape(lead.status),
    escape(lead.source),
    escape(lead.createdAt),
  ].join(",");
}

function leadsToCsv(leads: RuntimeLead[]): string {
  const header = "id,name,email,phone,product_interest,lead_score,status,source,created_at";
  return [header, ...leads.map(leadToCsvRow)].join("\n");
}

function providerHeaders(config: CrmConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-CRM-Provider": config.provider,
  };

  if (config.apiKey) {
    switch (config.provider) {
      case "hubspot":
        headers.Authorization = `Bearer ${config.apiKey}`;
        break;
      case "salesforce":
        headers.Authorization = `Bearer ${config.apiKey}`;
        break;
      case "zoho":
        headers.Authorization = `Zoho-oauthtoken ${config.apiKey}`;
        break;
      default:
        headers["X-API-Key"] = config.apiKey;
    }
  }

  return headers;
}

export async function syncLeadsToCRM(workspaceId: string): Promise<CrmSyncResult> {
  const profile = await db.getBusinessProfile(workspaceId);
  const config = parseCrmConfig(profile);

  const qualifiedLeads = await db.listQualifiedLeads(workspaceId);

  if (!config || !config.enabled) {
    return {
      provider: "webhook",
      method: "csv",
      exportedCount: qualifiedLeads.length,
      csv: leadsToCsv(qualifiedLeads),
    };
  }

  const payload = {
    provider: config.provider,
    workspaceId,
    exportedAt: new Date().toISOString(),
    leads: qualifiedLeads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      productInterest: lead.productInterest,
      leadScore: lead.leadScore,
      status: lead.status,
      source: lead.source,
      createdAt: lead.createdAt,
    })),
  };

  const response = await fetch(config.webhookUrl, {
    method: "POST",
    headers: providerHeaders(config),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  const responseText = await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error(
      `CRM webhook failed (${response.status}): ${responseText.slice(0, 200) || "no body"}`,
    );
  }

  return {
    provider: config.provider,
    method: "webhook",
    exportedCount: qualifiedLeads.length,
    webhookStatus: response.status,
    webhookResponse: responseText.slice(0, 500),
  };
}

export async function saveCrmConfig(
  workspaceId: string,
  config: CrmConfig,
): Promise<CrmConfig> {
  const profile = (await db.getBusinessProfile(workspaceId)) ?? {};
  await db.saveBusinessProfile(workspaceId, {
    ...profile,
    crmConfig: config,
  });
  return config;
}

export async function getCrmConfig(workspaceId: string): Promise<CrmConfig | null> {
  const profile = await db.getBusinessProfile(workspaceId);
  return parseCrmConfig(profile);
}
