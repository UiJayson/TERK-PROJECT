import { createId } from "./auth-crypto.ts";
import { PLANS, planMrr, type PlanId } from "./billing-plans.ts";
import { invalidateWorkspaceCaches } from "./cache.ts";
import * as db from "./db.ts";
import { getUsageSnapshot } from "./usage-limits.ts";
import type { AgentRole, Intent } from "./types.ts";

export type RuntimeChannel = "website" | "whatsapp" | "instagram" | "email" | "dashboard";

const AGENT_DISPLAY_NAMES: Record<AgentRole, string> = {
  reception: "Receptionist",
  sales: "Sales",
  marketing: "Marketing",
  human_review: "Human review",
};

export interface MessageHandoffMeta {
  from: AgentRole;
  to: AgentRole;
  reason: string;
}

export interface RuntimeMessage {
  id: string;
  role: "customer" | "agent" | "system";
  agent?: AgentRole;
  content: string;
  sentAt: string;
  handoff?: MessageHandoffMeta;
}

export interface RuntimeConversation {
  id: string;
  workspaceId: string;
  customer: {
    name: string;
    email?: string;
    phone?: string;
    handle?: string;
  };
  channel: RuntimeChannel;
  agentUsed: AgentRole;
  conversationStatus: "open" | "escalated" | "resolved";
  leadStatus: "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";
  sentiment: "positive" | "neutral" | "negative";
  updatedAt: string;
  createdAt: string;
  preview: string;
  unread: boolean;
  intent?: Intent;
  routingReason?: string;
  messages: RuntimeMessage[];
}

export interface RuntimeLead {
  id: string;
  workspaceId: string;
  name: string;
  phone: string;
  email: string;
  productInterest: string;
  leadScore: number;
  assignedAgent: AgentRole;
  status: RuntimeConversation["leadStatus"];
  notes: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  conversationId?: string;
}

const BUYING_SIGNAL_PATTERN =
  /\b(buy|purchase|order|price|pricing|quote|book|booking|tour|interested|sign up|signup|plan|office|desk|membership|demo|trial)\b/i;

function inferSentiment(text: string): RuntimeConversation["sentiment"] {
  const lower = text.toLowerCase();
  if (/\b(angry|unhappy|terrible|awful|refund|complaint|unfair)\b/.test(lower)) {
    return "negative";
  }
  if (/\b(thanks|great|love|perfect|awesome|happy)\b/.test(lower)) {
    return "positive";
  }
  return "neutral";
}

function scoreLead(input: {
  email?: string;
  phone?: string;
  productInterest?: string;
  agent: AgentRole;
}): number {
  let score = 35;
  if (input.email) score += 15;
  if (input.phone) score += 10;
  if (input.productInterest) score += 20;
  if (input.agent === "sales") score += 15;
  if (input.agent === "marketing") score += 5;
  return Math.min(score, 99);
}

export async function listConversations(
  workspaceId: string,
): Promise<RuntimeConversation[]> {
  return db.getConversations(workspaceId);
}

export async function listConversationsPage(
  workspaceId: string,
  options: { limit?: number; cursor?: string | null; status?: string | null } = {},
): Promise<db.Page<RuntimeConversation>> {
  return db.getConversationsPage(workspaceId, options);
}

export async function listLeads(workspaceId: string): Promise<RuntimeLead[]> {
  return db.getLeads(workspaceId);
}

export async function listLeadsPage(
  workspaceId: string,
  options: { limit?: number; cursor?: string | null; status?: string | null } = {},
): Promise<db.Page<RuntimeLead>> {
  return db.getLeadsPage(workspaceId, options);
}

export async function upsertLeadFromCapture(input: {
  workspaceId: string;
  leadId: string;
  name: string;
  email: string;
  phone: string;
  channel: RuntimeChannel;
  sourceMessage: string;
  timestamp: string;
  conversationId?: string;
  agentUsed: AgentRole;
  status?: RuntimeLead["status"];
}): Promise<RuntimeLead> {
  const channelLabel =
    input.channel === "dashboard"
      ? "Dashboard agent test"
      : input.channel.charAt(0).toUpperCase() + input.channel.slice(1);

  const productInterest = BUYING_SIGNAL_PATTERN.test(input.sourceMessage)
    ? "Buying interest"
    : "General inquiry";

  const lead: RuntimeLead = {
    id: input.leadId,
    workspaceId: input.workspaceId,
    name: input.name,
    phone: input.phone,
    email: input.email,
    productInterest,
    leadScore: scoreLead({
      email: input.email,
      phone: input.phone,
      productInterest,
      agent: input.agentUsed,
    }),
    assignedAgent: input.agentUsed,
    status: input.status ?? "new",
    notes: input.sourceMessage.slice(0, 240),
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    source: channelLabel,
    conversationId: input.conversationId,
  };

  await db.upsertLead(input.workspaceId, lead);
  return lead;
}

export async function appendConversationTurn(input: {
  workspaceId: string;
  conversationId?: string;
  channel: RuntimeChannel;
  agentUsed: AgentRole;
  intent?: Intent;
  routingReason?: string;
  customerMessage: string;
  agentReply: string;
  handoffReason?: string;
  handoffMeta?: MessageHandoffMeta;
  collectedFields?: Record<string, string>;
  conversationStatus?: RuntimeConversation["conversationStatus"];
}): Promise<RuntimeConversation> {
  const now = new Date().toISOString();

  const customerName =
    input.collectedFields?.name ||
    input.collectedFields?.full_name ||
    "Website visitor";
  const customerEmail = input.collectedFields?.email;
  const customerPhone = input.collectedFields?.phone;

  let conversation = input.conversationId
    ? await db.getConversationById(input.workspaceId, input.conversationId)
    : null;

  if (!conversation) {
    conversation = {
      id: createId("conv"),
      workspaceId: input.workspaceId,
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
      },
      channel: input.channel,
      agentUsed: input.agentUsed,
      conversationStatus: input.conversationStatus ?? "open",
      leadStatus: input.agentUsed === "sales" ? "qualified" : "new",
      sentiment: inferSentiment(input.customerMessage),
      updatedAt: now,
      createdAt: now,
      preview: input.customerMessage.slice(0, 120),
      unread: true,
      intent: input.intent,
      routingReason: input.routingReason,
      messages: [],
    };
  }

  conversation.customer = {
    name: customerName !== "Website visitor" ? customerName : conversation.customer.name,
    email: customerEmail ?? conversation.customer.email,
    phone: customerPhone ?? conversation.customer.phone,
  };
  conversation.agentUsed = input.agentUsed;
  conversation.intent = input.intent ?? conversation.intent;
  conversation.routingReason = input.routingReason ?? conversation.routingReason;
  conversation.sentiment = inferSentiment(input.customerMessage);
  conversation.preview = input.customerMessage.slice(0, 120);
  conversation.updatedAt = now;
  conversation.unread = true;
  if (input.conversationStatus) {
    conversation.conversationStatus = input.conversationStatus;
  }

  if (input.agentUsed === "sales") {
    conversation.leadStatus =
      conversation.leadStatus === "new" ? "qualified" : conversation.leadStatus;
  }

  const newMessages: RuntimeMessage[] = [
    {
      id: createId("msg"),
      role: "customer",
      content: input.customerMessage,
      sentAt: now,
    },
    {
      id: createId("msg"),
      role: "agent",
      agent: input.agentUsed,
      content: input.agentReply,
      sentAt: now,
    },
  ];

  if (input.handoffReason || input.handoffMeta) {
    const fromAgent = input.handoffMeta?.from ?? input.agentUsed;
    const toAgent = input.handoffMeta?.to ?? "reception";
    const reason = input.handoffMeta?.reason ?? input.handoffReason ?? "Agent handoff";
    newMessages.push({
      id: createId("msg"),
      role: "system",
      content: `${AGENT_DISPLAY_NAMES[fromAgent]} handed off to ${AGENT_DISPLAY_NAMES[toAgent]}: ${reason}`,
      sentAt: now,
      handoff: input.handoffMeta ?? { from: fromAgent, to: toAgent, reason },
    });
  }

  conversation.messages.push(...newMessages);

  await db.saveConversation(conversation);
  for (const message of newMessages) {
    await db.saveMessage({
      id: message.id,
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      role: message.role,
      content: message.content,
      timestamp: message.sentAt,
      agent: message.agent,
      handoff: message.handoff,
    });
  }

  const productInterest =
    input.collectedFields?.interest ||
    input.collectedFields?.product ||
    input.intent?.replaceAll("_", " ") ||
    "General inquiry";

  const hasLeadSignal =
    Boolean(customerEmail || customerPhone) ||
    input.agentUsed === "sales" ||
    /\b(book|tour|price|plan|quote|office|desk)\b/i.test(input.customerMessage);

  if (hasLeadSignal) {
    const existingLead = await db.findLeadByEmailOrConversation(
      input.workspaceId,
      customerEmail,
      conversation.id,
    );

    const lead: RuntimeLead = existingLead
      ? {
          ...existingLead,
          name: conversation.customer.name,
          email: conversation.customer.email ?? existingLead.email,
          phone: conversation.customer.phone ?? existingLead.phone,
          productInterest,
          assignedAgent: input.agentUsed,
          status: conversation.leadStatus,
          notes: input.customerMessage.slice(0, 240),
          updatedAt: now,
          leadScore: scoreLead({
            email: conversation.customer.email ?? existingLead.email,
            phone: conversation.customer.phone ?? existingLead.phone,
            productInterest,
            agent: input.agentUsed,
          }),
        }
      : {
          id: createId("lead"),
          workspaceId: input.workspaceId,
          name: conversation.customer.name,
          phone: conversation.customer.phone ?? "",
          email: conversation.customer.email ?? "",
          productInterest,
          leadScore: scoreLead({
            email: conversation.customer.email,
            phone: conversation.customer.phone,
            productInterest,
            agent: input.agentUsed,
          }),
          assignedAgent: input.agentUsed,
          status: conversation.leadStatus,
          notes: input.customerMessage.slice(0, 240),
          createdAt: now,
          updatedAt: now,
          source:
            input.channel === "dashboard"
              ? "Dashboard agent test"
              : `${input.channel} chat`,
          conversationId: conversation.id,
        };

    await db.upsertLead(input.workspaceId, lead);
  }

  // New turn changes conversations/leads/analytics — drop this instance's
  // cached list payloads so the dashboard sees it on the next poll.
  invalidateWorkspaceCaches(input.workspaceId);

  return conversation;
}

export async function getAnalyticsSummary(workspaceId: string) {
  const conversations = await db.getConversations(workspaceId);
  const leads = await db.getLeads(workspaceId);
  const totalConversations = conversations.length;
  const agentReplies = conversations.reduce(
    (sum, conversation) =>
      sum + conversation.messages.filter((message) => message.role === "agent").length,
    0,
  );
  const customerMessages = conversations.reduce(
    (sum, conversation) =>
      sum + conversation.messages.filter((message) => message.role === "customer").length,
    0,
  );
  const aiResponseRate =
    customerMessages === 0
      ? 100
      : Math.round((agentReplies / customerMessages) * 1000) / 10;

  const agentCounts = {
    reception: 0,
    sales: 0,
    marketing: 0,
    human_review: 0,
  } as Record<AgentRole, number>;

  for (const conversation of conversations) {
    agentCounts[conversation.agentUsed] =
      (agentCounts[conversation.agentUsed] ?? 0) + 1;
  }

  const mostActiveAgent =
    (Object.entries(agentCounts)
      .filter(([agent]) => agent !== "human_review")
      .sort((a, b) => b[1] - a[1])[0]?.[0] as AgentRole | undefined) ?? "reception";

  const qualifiedLeads = leads.filter((lead) =>
    ["qualified", "proposal", "won"].includes(lead.status),
  ).length;
  const leadConversion =
    totalConversations === 0
      ? 0
      : Math.round((qualifiedLeads / totalConversations) * 1000) / 10;

  const questionMap = new Map<string, number>();
  for (const conversation of conversations) {
    const firstCustomer = conversation.messages.find(
      (message) => message.role === "customer",
    );
    if (!firstCustomer) continue;
    const key = firstCustomer.content.slice(0, 80);
    questionMap.set(key, (questionMap.get(key) ?? 0) + 1);
  }

  const topQuestions = [...questionMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([question, count]) => ({ question, count }));

  // --- Real derived time series (replaces former hardcoded fixtures) ---
  const now = Date.now();

  // Average response time: mean customer→agent reply gap, ignoring gaps over an
  // hour so an overnight reply doesn't skew the figure. Messages are already
  // ordered chronologically by db.getConversations.
  let responseGapTotal = 0;
  let responseGapCount = 0;
  for (const conversation of conversations) {
    let pendingCustomerAt: number | null = null;
    for (const message of conversation.messages) {
      const at = new Date(message.sentAt).getTime();
      if (Number.isNaN(at)) continue;
      if (message.role === "customer") {
        pendingCustomerAt = at;
      } else if (message.role === "agent" && pendingCustomerAt !== null) {
        const deltaSeconds = (at - pendingCustomerAt) / 1000;
        if (deltaSeconds > 0 && deltaSeconds < 3600) {
          responseGapTotal += deltaSeconds;
          responseGapCount += 1;
        }
        pendingCustomerAt = null;
      }
    }
  }
  const averageResponseTimeSeconds =
    responseGapCount === 0 ? 0 : Math.round((responseGapTotal / responseGapCount) * 10) / 10;

  // Channel mix: real share of conversations per channel.
  const channelCounts = new Map<string, number>();
  for (const conversation of conversations) {
    const channel = conversation.channel ?? "website";
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
  }
  const channelMix = [...channelCounts.entries()]
    .map(([channel, count]) => ({
      channel: channel.charAt(0).toUpperCase() + channel.slice(1),
      value: totalConversations === 0 ? 0 : Math.round((count / totalConversations) * 100),
    }))
    .sort((a, b) => b.value - a.value);

  // Monthly activity: conversations + leads bucketed into the last 6 months.
  const monthBuckets: Array<{ key: string; month: string; conversations: number; leads: number }> = [];
  const monthIndex = new Map<string, number>();
  const monthBase = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(monthBase.getFullYear(), monthBase.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthIndex.set(key, monthBuckets.length);
    monthBuckets.push({
      key,
      month: d.toLocaleString("en", { month: "short" }),
      conversations: 0,
      leads: 0,
    });
  }
  const bucketByMonth = (dateStr: string, field: "conversations" | "leads") => {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return;
    const idx = monthIndex.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (idx !== undefined) monthBuckets[idx][field] += 1;
  };
  for (const conversation of conversations) bucketByMonth(conversation.createdAt, "conversations");
  for (const lead of leads) bucketByMonth(lead.createdAt, "leads");
  const monthlyActivity = monthBuckets.map(({ month, conversations: c, leads: l }) => ({
    month,
    conversations: c,
    leads: l,
  }));

  // Response-quality trend: real AI response rate per week for the last 4 weeks.
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weekBuckets = [0, 1, 2, 3].map((i) => ({
    week: `W${i + 1}`,
    start: now - (4 - i) * weekMs,
    end: now - (3 - i) * weekMs,
    agent: 0,
    customer: 0,
  }));
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const at = new Date(message.sentAt).getTime();
      if (Number.isNaN(at)) continue;
      const bucket = weekBuckets.find((b) => at >= b.start && at < b.end);
      if (!bucket) continue;
      if (message.role === "agent") bucket.agent += 1;
      else if (message.role === "customer") bucket.customer += 1;
    }
  }
  const responseTrend = weekBuckets.map((b) => ({
    week: b.week,
    rate: b.customer === 0 ? 0 : Math.round((b.agent / b.customer) * 1000) / 10,
  }));

  const aiUsage = await db.getAIUsageSummary(workspaceId);
  const usage = await getUsageSnapshot(workspaceId);
  const billing = await db.getWorkspaceBilling(workspaceId);
  const planId = billing.plan in PLANS ? (billing.plan as PlanId) : "free";

  return {
    totalConversations,
    aiResponseRate,
    averageResponseTimeSeconds,
    monthlyActivity,
    channelMix,
    responseTrend,
    leadConversion,
    salesInfluenced: leads.filter((lead) => lead.assignedAgent === "sales").length * 1200,
    mostActiveAgent,
    mostActiveAgentShare:
      totalConversations === 0
        ? 0
        : Math.round((agentCounts[mostActiveAgent] / totalConversations) * 100),
    agentActivity: [
      {
        agent: "Reception",
        conversations: agentCounts.reception,
        share:
          totalConversations === 0
            ? 0
            : Math.round((agentCounts.reception / totalConversations) * 100),
      },
      {
        agent: "Sales",
        conversations: agentCounts.sales,
        share:
          totalConversations === 0
            ? 0
            : Math.round((agentCounts.sales / totalConversations) * 100),
      },
      {
        agent: "Marketing",
        conversations: agentCounts.marketing,
        share:
          totalConversations === 0
            ? 0
            : Math.round((agentCounts.marketing / totalConversations) * 100),
      },
    ],
    topQuestions,
    leadsCount: leads.length,
    aiUsage,
    billing: {
      plan: planId,
      planName: PLANS[planId].name,
      monthlyRecurringRevenue: planMrr(planId),
      subscriptionStatus: billing.subscriptionStatus,
      messagesUsed: usage.messagesSent,
      messageLimit: usage.messageLimit,
    },
    // NOTE: platform-wide MRR (aggregated across every tenant) must never be
    // returned on a per-workspace endpoint — it leaks other customers' revenue.
    // Platform operators read it via the admin-gated /api/admin/health dashboard.
  };
}
