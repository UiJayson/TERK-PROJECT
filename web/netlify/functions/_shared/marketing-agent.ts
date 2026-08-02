import { createId } from "./auth-crypto.ts";
import { aiEngine, isAIEngineConfigured } from "./ai-engine.ts";
import * as db from "./db.ts";
import { formatKnowledgeForPrompt, searchKnowledge } from "./knowledge.ts";
import { getProductById, searchProducts } from "./products.ts";
import { isAllowedByRobotsTxt } from "./robots-check.ts";

export interface LeadMagnet {
  title: string;
  format: "checklist" | "guide";
  content: string;
  topic: string;
}

export interface LandingPageCopy {
  headline: string;
  body: string;
  cta: string;
  product: string;
}

export interface EmailSequenceItem {
  day: number;
  subject: string;
  body: string;
}

export interface EmailSequence {
  leadType: string;
  emails: EmailSequenceItem[];
}

export interface CompetitorPricingInsight {
  competitorUrl: string;
  mentions: string[];
  summary: string;
}

export interface IndustryNewsInsight {
  feedUrl: string;
  stories: Array<{ title: string; summary: string; link?: string }>;
}

async function knowledgeContext(workspaceId: string, query: string): Promise<string> {
  const results = await searchKnowledge(workspaceId, query, 5);
  if (results.length === 0) return "No knowledge base entries found.";
  return formatKnowledgeForPrompt(results);
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
      jsonMode: false,
      temperature: 0.5,
      maxTokens: 1500,
      workspaceId,
      operation: "marketing",
    });
    return result.content.trim();
  } catch (error) {
    console.warn("Marketing AI generation failed:", error);
    return null;
  }
}

function parseJsonBlock<T>(raw: string): T | null {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

export async function generateLeadMagnet(
  workspaceId: string,
  topic: string,
): Promise<LeadMagnet> {
  const kb = await knowledgeContext(workspaceId, topic);
  const aiRaw = await generateWithAI(
    workspaceId,
    "You create lead magnets from company knowledge. Return JSON only: {title, format, content, topic}. format is checklist or guide.",
    `Topic: ${topic}\n\nKnowledge base:\n${kb}`,
  );

  const parsed = aiRaw
    ? parseJsonBlock<LeadMagnet>(aiRaw)
    : null;

  if (parsed?.title && parsed.content) {
    return {
      title: parsed.title,
      format: parsed.format === "guide" ? "guide" : "checklist",
      content: parsed.content,
      topic,
    };
  }

  return {
    title: `${topic} Checklist`,
    format: "checklist",
    topic,
    content: [
      `# ${topic} Checklist`,
      "",
      "1. Define your goal and audience",
      "2. Review our core offerings from the knowledge base",
      "3. Identify your top 3 pain points",
      "4. Map solutions to each pain point",
      "5. Schedule a consultation",
      "",
      kb.slice(0, 600),
    ].join("\n"),
  };
}

export async function createLandingPageCopy(
  workspaceId: string,
  product: string,
): Promise<LandingPageCopy> {
  const matches = await searchProducts(workspaceId, product, 1);
  const catalogProduct = matches[0] ?? null;
  const kb = await knowledgeContext(workspaceId, product);

  const aiRaw = await generateWithAI(
    workspaceId,
    "You write landing page copy grounded in catalog/knowledge data. Return JSON: {headline, body, cta, product}.",
    `Product: ${product}\nCatalog: ${catalogProduct ? JSON.stringify(catalogProduct) : "none"}\n\nKnowledge:\n${kb}`,
  );

  const parsed = aiRaw ? parseJsonBlock<LandingPageCopy>(aiRaw) : null;
  if (parsed?.headline && parsed.body && parsed.cta) {
    return { ...parsed, product };
  }

  const priceLine =
    catalogProduct?.price !== null && catalogProduct?.price !== undefined
      ? ` Starting at ${catalogProduct.currency} ${catalogProduct.price}.`
      : "";

  return {
    product,
    headline: `Get more from ${catalogProduct?.title ?? product}`,
    body: `${catalogProduct?.description ?? "Discover how we help customers succeed."}${priceLine}`,
    cta: "Book a free consultation",
  };
}

export async function generateEmailSequence(
  workspaceId: string,
  leadType: string,
): Promise<EmailSequence> {
  const kb = await knowledgeContext(workspaceId, leadType);

  const aiRaw = await generateWithAI(
    workspaceId,
    "Create a 5-email nurture sequence. Return JSON: {leadType, emails:[{day, subject, body}]}. Days 1,3,5,7,10.",
    `Lead type: ${leadType}\n\nKnowledge:\n${kb}`,
  );

  const parsed = aiRaw ? parseJsonBlock<EmailSequence>(aiRaw) : null;
  if (parsed?.emails?.length === 5) {
    return { leadType, emails: parsed.emails };
  }

  const templates = [
    { day: 1, subject: `Welcome — here's your ${leadType} starter kit`, body: "Thanks for your interest. Here is a quick overview of how we help." },
    { day: 3, subject: "A quick win you can try today", body: "Based on what similar customers do, here is one actionable step." },
    { day: 5, subject: "How others solved this", body: "See how peers in your situation achieved results with us." },
    { day: 7, subject: "Your questions answered", body: "We compiled the top FAQs for leads like you." },
    { day: 10, subject: "Ready for the next step?", body: "Book a call or reply to this email — we are here to help." },
  ];

  return { leadType, emails: templates };
}

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

function parseRssItems(xml: string, limit = 3): Array<{ title: string; summary: string; link?: string }> {
  const items: Array<{ title: string; summary: string; link?: string }> = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  for (const block of itemBlocks.slice(0, limit)) {
    const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() ?? "Untitled";
    const description =
      block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]
        ?.replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim() ?? "";
    const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
    items.push({
      title,
      summary: description.slice(0, 280),
      link,
    });
  }

  return items;
}

export async function scrapeCompetitorPricing(
  workspaceId: string,
  competitorUrl: string,
): Promise<CompetitorPricingInsight> {
  const allowed = await isAllowedByRobotsTxt(competitorUrl);
  if (!allowed) {
    throw new Error("Scraping blocked by robots.txt for this URL.");
  }

  const response = await fetch(competitorUrl, {
    headers: { "User-Agent": "AIBusinessOS-MarketingBot/1.0" },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch competitor page (${response.status}).`);
  }

  const html = await response.text();
  const mentions = extractPricingMentions(html);
  const summary =
    mentions.length > 0
      ? `Found ${mentions.length} pricing mention(s): ${mentions.slice(0, 5).join("; ")}`
      : "No explicit pricing patterns detected on the page.";

  const insight = {
    id: createId("mi"),
    type: "competitor_pricing" as const,
    sourceUrl: competitorUrl,
    title: `Competitor pricing — ${new URL(competitorUrl).hostname}`,
    summary,
    data: { mentions },
  };

  await db.saveMarketingInsight(workspaceId, insight);

  return { competitorUrl, mentions, summary };
}

export async function scrapeIndustryNews(
  workspaceId: string,
  rssFeedUrl: string,
): Promise<IndustryNewsInsight> {
  const allowed = await isAllowedByRobotsTxt(rssFeedUrl);
  if (!allowed) {
    throw new Error("Fetching blocked by robots.txt for this feed URL.");
  }

  const response = await fetch(rssFeedUrl, {
    headers: { "User-Agent": "AIBusinessOS-MarketingBot/1.0" },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch RSS feed (${response.status}).`);
  }

  const xml = await response.text();
  const stories = parseRssItems(xml, 3);
  const summary = stories.map((story, index) => `${index + 1}. ${story.title}`).join(" | ");

  await db.saveMarketingInsight(workspaceId, {
    id: createId("mi"),
    type: "industry_news",
    sourceUrl: rssFeedUrl,
    title: "Industry news digest",
    summary,
    data: { stories },
  });

  return { feedUrl: rssFeedUrl, stories };
}

export async function generateFullCampaign(input: {
  workspaceId: string;
  productId?: string;
  productName: string;
  leadType?: string;
}): Promise<db.MarketingCampaignRecord> {
  const productRef = input.productId
    ? await getProductById(input.workspaceId, input.productId)
    : null;
  const productName = productRef?.title ?? input.productName;
  const topic = productName;
  const leadType = input.leadType ?? "interested prospect";

  const [leadMagnet, landingCopy, emailSequence] = await Promise.all([
    generateLeadMagnet(input.workspaceId, topic),
    createLandingPageCopy(input.workspaceId, productName),
    generateEmailSequence(input.workspaceId, leadType),
  ]);

  return db.saveMarketingCampaign(input.workspaceId, {
    id: createId("mc"),
    name: `${productName} Campaign`,
    productId: input.productId ?? productRef?.id ?? null,
    status: "active",
    leadMagnet: leadMagnet as unknown as Record<string, unknown>,
    landingCopy: landingCopy as unknown as Record<string, unknown>,
    emailSequence: emailSequence as unknown as Record<string, unknown>,
    leadsGenerated: 0,
  });
}
