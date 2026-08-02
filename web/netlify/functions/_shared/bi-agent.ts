import { createId } from "./auth-crypto.ts";
import { aiEngine, isAIEngineConfigured } from "./ai-engine.ts";
import * as db from "./db.ts";
import { searchKnowledge } from "./knowledge.ts";
import { log } from "./logger.ts";
import { sendNotification } from "./notifications.ts";
import { isAllowedByRobotsTxt } from "./robots-check.ts";
import { sendEmail } from "./email.ts";
import { getSiteUrl } from "./config.ts";

const COMPETITOR_URLS_KEY = "competitorUrls";

function extractPricingMentions(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const patterns = [
    /(?:£|\$|€)\s?\d[\d,.]*(?:\s*(?:\/mo|per month|monthly|year|annually))?/gi,
    /\b\d+[\d,.]*\s*(?:USD|GBP|EUR)\b/gi,
    /\b(?:from|starting at|plans? from)\s+(?:£|\$|€)?\s?\d[\d,.]*/gi,
  ];

  const mentions = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.match(pattern) ?? []) {
      mentions.add(match.trim());
    }
  }

  return [...mentions].slice(0, 12);
}

export async function getCompetitorUrls(workspaceId: string): Promise<string[]> {
  const profile = await db.getBusinessProfile(workspaceId);
  const urls = profile?.[COMPETITOR_URLS_KEY];
  if (!Array.isArray(urls)) return [];
  return urls.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

export async function saveCompetitorUrls(workspaceId: string, urls: string[]): Promise<string[]> {
  const profile = (await db.getBusinessProfile(workspaceId)) ?? {};
  const cleaned = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  await db.saveBusinessProfile(workspaceId, { ...profile, [COMPETITOR_URLS_KEY]: cleaned });
  return cleaned;
}

async function scrapeCompetitorUrl(
  workspaceId: string,
  competitorUrl: string,
): Promise<db.CompetitorDataRecord> {
  const allowed = await isAllowedByRobotsTxt(competitorUrl);
  if (!allowed) {
    throw new Error(`Scraping blocked by robots.txt for ${competitorUrl}`);
  }

  const response = await fetch(competitorUrl, {
    headers: { "User-Agent": "AIBusinessOS-BIBot/1.0" },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch competitor page (${response.status})`);
  }

  const html = await response.text();
  const mentions = extractPricingMentions(html);
  const summary =
    mentions.length > 0
      ? `Found ${mentions.length} pricing mention(s): ${mentions.slice(0, 5).join("; ")}`
      : "No explicit pricing patterns detected on the page.";

  const scrapedAt = new Date().toISOString();
  return db.saveCompetitorData(workspaceId, {
    id: createId("cd"),
    sourceUrl: competitorUrl,
    mentions,
    summary,
    scrapedAt,
  });
}

export async function monitorCompetitors(workspaceId: string): Promise<{
  scraped: number;
  errors: string[];
}> {
  const urls = await getCompetitorUrls(workspaceId);
  const errors: string[] = [];
  let scraped = 0;

  for (const url of urls) {
    try {
      await scrapeCompetitorUrl(workspaceId, url);
      scraped += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "scrape failed";
      errors.push(`${url}: ${message}`);
      log.warn("competitor_scrape_failed", { workspaceId, url, error: message });
    }
  }

  return { scraped, errors };
}

export async function detectPriceChanges(workspaceId: string): Promise<{
  changes: Array<{ sourceUrl: string; previous: string[]; current: string[] }>;
  alertsSent: number;
}> {
  const urls = await getCompetitorUrls(workspaceId);
  const changes: Array<{ sourceUrl: string; previous: string[]; current: string[] }> = [];
  let alertsSent = 0;

  for (const url of urls) {
    const snapshots = await db.getLatestCompetitorSnapshots(workspaceId, url, 2);
    if (snapshots.length < 2) continue;

    const current = snapshots[0]!;
    const previous = snapshots[1]!;
    const prevSet = new Set(previous.mentions);
    const currSet = new Set(current.mentions);
    const changed =
      current.mentions.length !== previous.mentions.length ||
      current.mentions.some((mention) => !prevSet.has(mention)) ||
      previous.mentions.some((mention) => !currSet.has(mention));

    if (!changed) continue;

    changes.push({
      sourceUrl: url,
      previous: previous.mentions,
      current: current.mentions,
    });

    await sendNotification({
      workspaceId,
      event: "bi_price_change",
      title: "Competitor price change detected",
      message: `Pricing changed for ${new URL(url).hostname}. Previous: ${previous.mentions.slice(0, 3).join(", ") || "none"}. Current: ${current.mentions.slice(0, 3).join(", ") || "none"}.`,
      link: `${getSiteUrl()}/app/agents`,
      metadata: { sourceUrl: url, previous: previous.mentions, current: current.mentions },
    });
    alertsSent += 1;
  }

  return { changes, alertsSent };
}

async function generateWithAI(
  workspaceId: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  if (!isAIEngineConfigured()) return null;

  try {
    const result = await aiEngine.generateResponse({
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      jsonMode: true,
      temperature: 0.4,
      maxTokens: 2000,
      workspaceId,
      operation: "bi_analysis",
    });
    return result.content.trim();
  } catch (error) {
    log.warn("bi_ai_generation_failed", {
      workspaceId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export async function generateSWOT(workspaceId: string): Promise<db.BusinessInsightRecord> {
  const [metrics, competitors, leads, knowledge] = await Promise.all([
    db.getBIMetrics(workspaceId),
    db.listCompetitorData(workspaceId, 10),
    db.getLeads(workspaceId),
    searchKnowledge(workspaceId, "products services pricing", 8),
  ]);

  const productTitles = knowledge.map((item) => item.title).filter(Boolean);
  const competitorSummaries = competitors.map((c) => `${c.sourceUrl}: ${c.summary}`).join("\n");
  const leadSummary = `${metrics.leadCount} leads (${metrics.qualifiedLeads} qualified, ${metrics.lostLeads} lost)`;

  const aiRaw = await generateWithAI(
    workspaceId,
    "You are a business analyst. Return JSON only: {strengths:[], weaknesses:[], opportunities:[], threats:[]}. Use only provided data — never invent metrics.",
    [
      `Metrics: ${JSON.stringify(metrics)}`,
      `Products in KB: ${productTitles.join(", ") || "none"}`,
      `Leads: ${leadSummary}`,
      `Competitor data:\n${competitorSummaries || "none"}`,
    ].join("\n\n"),
  );

  let swot: Record<string, string[]> = {
    strengths: [],
    weaknesses: [],
    opportunities: [],
    threats: [],
  };

  if (aiRaw) {
    try {
      const parsed = JSON.parse(aiRaw.replace(/^```json\s*/i, "").replace(/```$/i, "")) as Record<
        string,
        string[]
      >;
      swot = {
        strengths: parsed.strengths ?? [],
        weaknesses: parsed.weaknesses ?? [],
        opportunities: parsed.opportunities ?? [],
        threats: parsed.threats ?? [],
      };
    } catch {
      // fall through to data-driven defaults
    }
  }

  if (swot.strengths.length === 0) {
    swot = {
      strengths: [
        metrics.qualifiedLeads > 0
          ? `${metrics.qualifiedLeads} qualified lead(s) in pipeline`
          : "Active customer conversations",
        metrics.appointmentCount > 0
          ? `${metrics.appointmentCount} appointment(s) booked`
          : "Appointment booking capability",
        productTitles.length > 0 ? `${productTitles.length} product(s) in knowledge base` : "Knowledge base configured",
      ].filter(Boolean),
      weaknesses: [
        metrics.conversationCount > 0 && metrics.qualifiedLeads === 0
          ? `0% lead conversion from ${metrics.conversationCount} conversation(s)`
          : metrics.leadCount === 0
            ? "No leads captured yet"
            : `${metrics.lostLeads} lost lead(s)`,
        metrics.negativeConversations > 0
          ? `${metrics.negativeConversations} negative conversation(s)`
          : "Limited competitor pricing data",
      ],
      opportunities: [
        metrics.conversationCount > metrics.qualifiedLeads
          ? `Improve conversion: ${metrics.conversationCount} conversations vs ${metrics.qualifiedLeads} qualified leads`
          : "Expand lead capture in conversations",
        competitors.length > 0 ? "Monitor competitor pricing for positioning" : "Add competitor URLs for market monitoring",
      ],
      threats: [
        metrics.escalatedConversations > 0
          ? `${metrics.escalatedConversations} escalated conversation(s) need attention`
          : "Market competition",
        metrics.complaintMessages > 0
          ? `${metrics.complaintMessages} complaint message(s) detected`
          : "Customer churn risk if follow-up is slow",
      ],
    };
  }

  const summary = `SWOT: ${swot.strengths.length} strengths, ${swot.weaknesses.length} weaknesses, ${swot.opportunities.length} opportunities, ${swot.threats.length} threats`;

  return db.saveBusinessInsight(workspaceId, {
    id: createId("bi"),
    type: "swot",
    title: "SWOT Analysis",
    summary,
    data: { swot, metrics, leadCount: leads.length, competitorCount: competitors.length },
  });
}

export async function generateGrowthReport(workspaceId: string): Promise<db.BusinessInsightRecord> {
  const metrics = await db.getBIMetrics(workspaceId);

  const conversionRate =
    metrics.conversationCount > 0
      ? Math.round((metrics.qualifiedLeads / metrics.conversationCount) * 1000) / 10
      : 0;
  const appointmentRate =
    metrics.conversationCount > 0
      ? Math.round((metrics.appointmentCount / metrics.conversationCount) * 1000) / 10
      : 0;
  const churnRate =
    metrics.leadCount > 0 ? Math.round((metrics.lostLeads / metrics.leadCount) * 1000) / 10 : 0;

  const recommendations: Array<{ action: string; metric: string; impact: string }> = [];

  if (metrics.conversationCount > 0 && conversionRate < 10) {
    recommendations.push({
      action: "Add budget/timeline qualification earlier in conversations",
      metric: `${conversionRate}% lead conversion`,
      impact: `Potential +${Math.max(1, Math.round(metrics.conversationCount * 0.1))} qualified leads`,
    });
  }

  if (metrics.conversationCount > 0 && appointmentRate < 5) {
    recommendations.push({
      action: "Proactively offer appointment slots after product interest",
      metric: `${appointmentRate}% appointment rate`,
      impact: `Target ${Math.max(1, Math.round(metrics.conversationCount * 0.05))} bookings`,
    });
  }

  if (churnRate > 20 && metrics.lostLeads > 0) {
    recommendations.push({
      action: "Follow up lost leads within 48 hours with a win-back offer",
      metric: `${churnRate}% churn (${metrics.lostLeads} lost)`,
      impact: `Recover ${Math.max(1, Math.round(metrics.lostLeads * 0.25))} lead(s)`,
    });
  }

  if (metrics.escalatedConversations > 0) {
    recommendations.push({
      action: "Review escalated conversations for process gaps",
      metric: `${metrics.escalatedConversations} escalation(s)`,
      impact: "Reduce response time to improve retention",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      action: "Continue monitoring — metrics are within healthy ranges",
      metric: `${metrics.conversationCount} conversations, ${metrics.qualifiedLeads} qualified leads`,
      impact: "Maintain current engagement strategy",
    });
  }

  const summary = `${recommendations.length} recommendation(s) based on ${metrics.conversationCount} conversations, ${conversionRate}% conversion, ${appointmentRate}% appointment rate, ${churnRate}% churn`;

  return db.saveBusinessInsight(workspaceId, {
    id: createId("bi"),
    type: "growth_report",
    title: "Growth Recommendations",
    summary,
    data: {
      metrics: { ...metrics, conversionRate, appointmentRate, churnRate },
      recommendations,
    },
  });
}

export async function detectOpportunities(workspaceId: string): Promise<db.BusinessInsightRecord[]> {
  const [topics, products] = await Promise.all([
    db.getTopCustomerTopics(workspaceId, 30),
    searchKnowledge(workspaceId, "products services", 20),
  ]);

  const productKeywords = new Set<string>();
  for (const product of products) {
    for (const word of product.title.toLowerCase().split(/\s+/)) {
      if (word.length > 3) productKeywords.add(word);
    }
    for (const word of product.content.toLowerCase().split(/\s+/)) {
      if (word.length > 4) productKeywords.add(word);
    }
  }

  const opportunities: Array<{ topic: string; count: number; reason: string }> = [];

  for (const { topic, count } of topics) {
    if (count < 2) continue;
    const words = topic.split(/\s+/).filter((w) => w.length > 4);
    const matchesProduct = words.some((word) => productKeywords.has(word));
    if (!matchesProduct) {
      opportunities.push({
        topic,
        count,
        reason: "Customers ask about this but no matching product in knowledge base",
      });
    }
  }

  const insights: db.BusinessInsightRecord[] = [];
  for (const opp of opportunities.slice(0, 5)) {
    const insight = await db.saveBusinessInsight(workspaceId, {
      id: createId("bi"),
      type: "opportunity",
      title: `Unmet demand: "${opp.topic.slice(0, 60)}"`,
      summary: `${opp.count} customer message(s) mention this topic without a matching offering`,
      data: opp,
    });
    insights.push(insight);
  }

  if (insights.length === 0) {
    const insight = await db.saveBusinessInsight(workspaceId, {
      id: createId("bi"),
      type: "opportunity",
      title: "No unmet demand patterns detected",
      summary: `Analyzed ${topics.length} customer topic(s) — all match existing knowledge base offerings`,
      data: { topicsAnalyzed: topics.length },
    });
    insights.push(insight);
  }

  return insights;
}

export async function detectRisks(workspaceId: string): Promise<{
  risks: db.BusinessInsightRecord[];
  alertsSent: number;
}> {
  const [metrics, billing] = await Promise.all([
    db.getBIMetrics(workspaceId),
    db.getWorkspaceBilling(workspaceId),
  ]);

  const riskItems: Array<{ severity: "high" | "medium" | "low"; title: string; detail: string }> = [];

  if (metrics.escalatedConversations >= 3) {
    riskItems.push({
      severity: "high",
      title: "Escalation spike",
      detail: `${metrics.escalatedConversations} escalated conversations — review agent responses`,
    });
  }

  if (metrics.complaintMessages >= 2) {
    riskItems.push({
      severity: "high",
      title: "Complaint volume",
      detail: `${metrics.complaintMessages} complaint-related messages detected`,
    });
  }

  if (metrics.lostLeads >= 2) {
    riskItems.push({
      severity: "medium",
      title: "Churn signal",
      detail: `${metrics.lostLeads} lost lead(s) — ${metrics.leadCount > 0 ? Math.round((metrics.lostLeads / metrics.leadCount) * 100) : 0}% of pipeline`,
    });
  }

  if (metrics.negativeConversations >= 2) {
    riskItems.push({
      severity: "medium",
      title: "Negative sentiment",
      detail: `${metrics.negativeConversations} conversation(s) with negative sentiment`,
    });
  }

  if (billing.subscriptionStatus === "inactive" || billing.subscriptionStatus === "canceled") {
    riskItems.push({
      severity: "high",
      title: "Subscription inactive",
      detail: `Workspace subscription status: ${billing.subscriptionStatus}`,
    });
  }

  const risks: db.BusinessInsightRecord[] = [];
  let alertsSent = 0;

  for (const risk of riskItems) {
    const insight = await db.saveBusinessInsight(workspaceId, {
      id: createId("bi"),
      type: "risk",
      title: risk.title,
      summary: risk.detail,
      data: { severity: risk.severity, ...metrics },
    });
    risks.push(insight);

    if (risk.severity === "high") {
      await sendNotification({
        workspaceId,
        event: "bi_risk_alert",
        title: `Risk alert: ${risk.title}`,
        message: risk.detail,
        link: `${getSiteUrl()}/app/agents`,
        metadata: { severity: risk.severity, type: "risk" },
      });
      alertsSent += 1;
    }
  }

  if (risks.length === 0) {
    const insight = await db.saveBusinessInsight(workspaceId, {
      id: createId("bi"),
      type: "risk",
      title: "No critical risks detected",
      summary: `Reviewed ${metrics.conversationCount} conversations, ${metrics.leadCount} leads — all within normal thresholds`,
      data: { severity: "low", ...metrics },
    });
    risks.push(insight);
  }

  return { risks, alertsSent };
}

export async function sendWeeklyBIReport(workspaceId: string): Promise<void> {
  const [competitors, insights, metrics] = await Promise.all([
    db.listCompetitorData(workspaceId, 5),
    db.listBusinessInsights(workspaceId, undefined, 10),
    db.getBIMetrics(workspaceId),
  ]);

  const swot = insights.find((i) => i.type === "swot");
  const growth = insights.find((i) => i.type === "growth_report");
  const risks = insights.filter((i) => i.type === "risk");

  const lines = [
    "Weekly Business Intelligence Report",
    "",
    `Conversations: ${metrics.conversationCount}`,
    `Qualified leads: ${metrics.qualifiedLeads} / ${metrics.leadCount}`,
    `Appointments booked: ${metrics.appointmentCount}`,
    "",
    swot ? `SWOT: ${swot.summary}` : "SWOT: Run analysis to generate",
    growth ? `Growth: ${growth.summary}` : "Growth: Run analysis to generate",
    "",
    `Competitor snapshots: ${competitors.length}`,
    ...competitors.slice(0, 3).map((c) => `- ${c.sourceUrl}: ${c.summary}`),
    "",
    risks.length > 0 ? `Active risks: ${risks.length}` : "No active risks",
    ...risks.slice(0, 3).map((r) => `- [${r.data.severity ?? "medium"}] ${r.title}`),
    "",
    `View full dashboard: ${getSiteUrl()}/app/agents`,
  ];

  const ownerEmail = await db.getWorkspaceOwnerEmail(workspaceId);
  if (ownerEmail) {
    await sendEmail({
      to: ownerEmail,
      subject: "[AI OS] Weekly Business Intelligence Report",
      text: lines.join("\n"),
      html: lines.map((line) => `<p>${line}</p>`).join(""),
    });
  }

  await sendNotification({
    workspaceId,
    event: "bi_weekly_report",
    title: "Weekly BI report sent",
    message: lines.slice(0, 6).join(" | "),
    link: `${getSiteUrl()}/app/agents`,
  });
}

export async function runFullBIAnalysis(workspaceId: string): Promise<{
  swot: db.BusinessInsightRecord;
  growth: db.BusinessInsightRecord;
  opportunities: db.BusinessInsightRecord[];
  risks: db.BusinessInsightRecord[];
}> {
  const [swot, growth, opportunities, riskResult] = await Promise.all([
    generateSWOT(workspaceId),
    generateGrowthReport(workspaceId),
    detectOpportunities(workspaceId),
    detectRisks(workspaceId),
  ]);

  return {
    swot,
    growth,
    opportunities,
    risks: riskResult.risks,
  };
}
