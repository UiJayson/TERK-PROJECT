/*
 * Dev-only mock API — lets the app render every authenticated screen without
 * a database. Never bundled in production: the import in main.tsx is guarded
 * by `import.meta.env.DEV`, so Rollup drops this file from the build.
 *
 * Enable:  localStorage.setItem("harbor:preview", "1"); location.reload()
 * Disable: localStorage.removeItem("harbor:preview"); location.reload()
 */

type Json = Record<string, unknown>;

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

const session = {
  user: { id: "user_mock_1", email: "amara@bloomvine.studio", name: "Amara Okafor" },
  workspace: {
    id: "ws_mock_1",
    name: "Bloom & Vine Studio",
    ownerId: "user_mock_1",
    createdAt: daysAgo(64),
    publicKey: "pk_demo_bloomvine",
    resources: { agents: [], knowledge: [], conversations: [], analytics: [], leads: [] },
    agentConfigs: [
      { id: "reception", enabled: true, lastUpdated: daysAgo(2), notes: "" },
      { id: "sales", enabled: true, lastUpdated: daysAgo(5), notes: "" },
      { id: "marketing", enabled: false, lastUpdated: daysAgo(9), notes: "" },
    ],
  },
  role: "owner",
  token: "mock-token",
};

const agents = [
  {
    id: "reception",
    name: "Reception Agent",
    role: "Front desk & scheduling",
    description:
      "Greets customers, answers FAQs from the knowledge base, and books appointments.",
    status: "active",
    enabled: true,
    model: "claude-sonnet-5",
    knowledgeSources: ["company", "faqs", "policies"],
    channelsConnected: ["website", "whatsapp"],
    lastUpdated: daysAgo(2),
    notes: "",
    prompt:
      "You are the reception agent for Bloom & Vine Studio. Greet warmly, answer from approved knowledge only, and book consultations from real availability.",
  },
  {
    id: "sales",
    name: "Sales Agent",
    role: "Quotes & product fit",
    description:
      "Recommends arrangements and subscription plans from the approved catalog, and captures lead details.",
    status: "active",
    enabled: true,
    model: "claude-sonnet-5",
    knowledgeSources: ["products", "pricing"],
    channelsConnected: ["website", "whatsapp"],
    lastUpdated: daysAgo(5),
    notes: "",
    prompt:
      "You are the sales agent for Bloom & Vine Studio. Quote only from the approved price list. Capture budget, timeline, and occasion for every lead.",
  },
  {
    id: "marketing",
    name: "Marketing Agent",
    role: "Campaigns & brand voice",
    description:
      "Drafts campaigns and lead magnets in the studio's voice. Never replies to inbound customer messages.",
    status: "paused",
    enabled: false,
    model: "claude-sonnet-5",
    knowledgeSources: ["brand_voice", "products"],
    channelsConnected: [],
    lastUpdated: daysAgo(9),
    notes: "Paused until spring campaign brief is approved.",
    prompt:
      "You are the marketing agent for Bloom & Vine Studio. Draft campaigns in the studio voice. Do not answer inbound customer messages.",
  },
];

const mkMsg = (
  id: string,
  role: "customer" | "agent",
  content: string,
  h: number,
  agent?: string,
) => ({ id, role, ...(agent ? { agent } : {}), content, sentAt: hoursAgo(h) });

const conversations = [
  {
    id: "conv_01",
    customer: { name: "Tunde Alabi", phone: "+234 803 221 4187" },
    channel: "whatsapp",
    agentUsed: "sales",
    conversationStatus: "open",
    leadStatus: "qualified",
    sentiment: "positive",
    createdAt: hoursAgo(1.2),
    updatedAt: hoursAgo(0.3),
    preview: "Could you do a standing lobby arrangement every Monday?",
    unread: true,
    intent: "recurring order",
    routingReason: "Pricing question about a recurring corporate order",
    messages: [
      mkMsg("m1", "customer", "Hi, we're opening a boutique hotel in Lekki. Could you do a standing lobby arrangement every Monday?", 1.2),
      mkMsg("m2", "agent", "Congratulations on the opening! Yes — our corporate subscription covers weekly lobby installs. For a lobby of your size most clients pick the Signature tier at ₦85,000/week. Want me to book a site visit?", 1.1, "sales"),
      mkMsg("m3", "customer", "Yes please, Thursday afternoon works.", 0.3),
    ],
  },
  {
    id: "conv_02",
    customer: { name: "Chidinma Eze", email: "chidinma.eze@gmail.com" },
    channel: "website",
    agentUsed: "reception",
    conversationStatus: "resolved",
    leadStatus: "won",
    sentiment: "positive",
    createdAt: hoursAgo(3.4),
    updatedAt: hoursAgo(2.8),
    preview: "Perfect, see you Saturday at 10.",
    unread: false,
    intent: "appointment",
    routingReason: "Booking request within opening hours",
    messages: [
      mkMsg("m1", "customer", "Do you do bridal bouquet consultations on weekends?", 3.4),
      mkMsg("m2", "agent", "We do! Saturday slots are 10:00, 11:30, and 14:00. Consultations run 45 minutes at our Victoria Island studio.", 3.3, "reception"),
      mkMsg("m3", "customer", "Perfect, see you Saturday at 10.", 2.8),
    ],
  },
  {
    id: "conv_03",
    customer: { name: "Bisi Adewale", handle: "@bisi.a" },
    channel: "instagram",
    agentUsed: "reception",
    conversationStatus: "escalated",
    leadStatus: "contacted",
    sentiment: "negative",
    createdAt: hoursAgo(5.1),
    updatedAt: hoursAgo(4.6),
    preview: "This is the second time my delivery arrived wilted.",
    unread: true,
    intent: "complaint",
    routingReason: "Frustration detected — escalated to human with context",
    messages: [
      mkMsg("m1", "customer", "This is the second time my delivery arrived wilted. Not acceptable for the price.", 5.1),
      mkMsg("m2", "agent", "I'm really sorry, Bisi — that's not the standard we hold ourselves to. I've flagged this to our team lead with your order history; someone will call you within the hour. Your redelivery is on us.", 5.0, "reception"),
    ],
  },
  {
    id: "conv_04",
    customer: { name: "Emeka Nwosu", email: "e.nwosu@stellarbank.ng" },
    channel: "email",
    agentUsed: "sales",
    conversationStatus: "open",
    leadStatus: "proposal",
    sentiment: "neutral",
    createdAt: hoursAgo(8.9),
    updatedAt: hoursAgo(6.2),
    preview: "Please send the corporate gifting catalogue and volume pricing.",
    unread: false,
    intent: "quote",
    routingReason: "Corporate pricing request",
    messages: [
      mkMsg("m1", "customer", "Please send the corporate gifting catalogue and volume pricing for ~120 staff.", 8.9),
      mkMsg("m2", "agent", "Sent! For 120 recipients the Amber box lands at ₦18,500/unit including delivery within Lagos. I've attached the full catalogue and a draft timeline for December dispatch.", 6.2, "sales"),
    ],
  },
  {
    id: "conv_05",
    customer: { name: "Funke Ojo", phone: "+234 815 990 2216" },
    channel: "whatsapp",
    agentUsed: "reception",
    conversationStatus: "resolved",
    leadStatus: "new",
    sentiment: "positive",
    createdAt: hoursAgo(11.5),
    updatedAt: hoursAgo(11.1),
    preview: "Great, thanks for the quick answer!",
    unread: false,
    intent: "faq",
    routingReason: "Opening-hours question",
    messages: [
      mkMsg("m1", "customer", "Are you open on public holidays?", 11.5),
      mkMsg("m2", "agent", "We're open 10:00–16:00 on most public holidays, and closed Christmas Day and New Year's Day. Same-day delivery cutoff is 13:00 on those days.", 11.4, "reception"),
      mkMsg("m3", "customer", "Great, thanks for the quick answer!", 11.1),
    ],
  },
  {
    id: "conv_06",
    customer: { name: "Ngozi Umeh", email: "ngozi@luxeevents.ng" },
    channel: "website",
    agentUsed: "sales",
    conversationStatus: "open",
    leadStatus: "qualified",
    sentiment: "positive",
    createdAt: daysAgo(1.2),
    updatedAt: hoursAgo(20),
    preview: "Budget is around ₦2.4m for the full installation.",
    unread: false,
    intent: "event quote",
    routingReason: "Event installation inquiry with stated budget",
    messages: [
      mkMsg("m1", "customer", "We're planning a product launch for 300 guests in March. Do you handle full-venue installations?", 30),
      mkMsg("m2", "agent", "We do — full-venue installs are our specialty. Could you share the venue and rough budget so I can suggest the right tier?", 29, "sales"),
      mkMsg("m3", "customer", "Budget is around ₦2.4m for the full installation.", 20),
    ],
  },
  {
    id: "conv_07",
    customer: { name: "Kelechi Obi", handle: "@kelechi.obi" },
    channel: "instagram",
    agentUsed: "reception",
    conversationStatus: "resolved",
    leadStatus: "new",
    sentiment: "neutral",
    createdAt: daysAgo(1.8),
    updatedAt: daysAgo(1.7),
    preview: "Do you deliver to Abuja?",
    unread: false,
    intent: "delivery",
    routingReason: "Delivery coverage question",
    messages: [
      mkMsg("m1", "customer", "Do you deliver to Abuja?", 43),
      mkMsg("m2", "agent", "Lagos same-day, Abuja next-day via our cold-chain partner (₦4,500 flat). Order before 15:00 for next-day arrival.", 42, "reception"),
    ],
  },
  {
    id: "conv_08",
    customer: { name: "Adaeze Kalu", phone: "+234 902 114 7733" },
    channel: "whatsapp",
    agentUsed: "sales",
    conversationStatus: "resolved",
    leadStatus: "won",
    sentiment: "positive",
    createdAt: daysAgo(2.5),
    updatedAt: daysAgo(2.4),
    preview: "Order confirmed — anniversary bouquet for Friday.",
    unread: false,
    intent: "order",
    routingReason: "Direct purchase intent",
    messages: [
      mkMsg("m1", "customer", "I need an anniversary bouquet delivered Friday, something with peonies.", 60),
      mkMsg("m2", "agent", "Lovely choice — peonies are in season. The Blush Peony set is ₦42,000 with a handwritten card included. Shall I confirm for Friday delivery to Ikoyi?", 59.5, "sales"),
      mkMsg("m3", "customer", "Order confirmed — anniversary bouquet for Friday.", 58),
    ],
  },
];

const leads = [
  { id: "lead_01", name: "Tunde Alabi", phone: "+234 803 221 4187", email: "", productInterest: "Corporate weekly subscription", leadScore: 87, assignedAgent: "sales", status: "qualified", notes: "Boutique hotel, Lekki. Site visit Thursday.", createdAt: hoursAgo(1.2), updatedAt: hoursAgo(0.3), source: "whatsapp", conversationId: "conv_01" },
  { id: "lead_02", name: "Ngozi Umeh", phone: "", email: "ngozi@luxeevents.ng", productInterest: "Event installation (March launch)", leadScore: 92, assignedAgent: "sales", status: "qualified", notes: "₦2.4m budget, 300 guests.", createdAt: daysAgo(1.2), updatedAt: hoursAgo(20), source: "website", conversationId: "conv_06" },
  { id: "lead_03", name: "Emeka Nwosu", phone: "", email: "e.nwosu@stellarbank.ng", productInterest: "Corporate gifting (120 units)", leadScore: 74, assignedAgent: "sales", status: "proposal", notes: "December dispatch. Catalogue sent.", createdAt: hoursAgo(8.9), updatedAt: hoursAgo(6.2), source: "email", conversationId: "conv_04" },
  { id: "lead_04", name: "Chidinma Eze", phone: "", email: "chidinma.eze@gmail.com", productInterest: "Bridal package", leadScore: 81, assignedAgent: "reception", status: "won", notes: "Consultation booked Saturday 10:00.", createdAt: hoursAgo(3.4), updatedAt: hoursAgo(2.8), source: "website", conversationId: "conv_02" },
  { id: "lead_05", name: "Adaeze Kalu", phone: "+234 902 114 7733", email: "", productInterest: "Blush Peony set", leadScore: 68, assignedAgent: "sales", status: "won", notes: "Anniversary order delivered.", createdAt: daysAgo(2.5), updatedAt: daysAgo(2.4), source: "whatsapp", conversationId: "conv_08" },
  { id: "lead_06", name: "Kelechi Obi", phone: "", email: "", productInterest: "Abuja delivery", leadScore: 41, assignedAgent: "reception", status: "new", notes: "Asked about delivery coverage.", createdAt: daysAgo(1.8), updatedAt: daysAgo(1.7), source: "instagram", conversationId: "conv_07" },
];

const analyticsSummary = {
  totalConversations: 176,
  aiResponseRate: 93.4,
  averageResponseTimeSeconds: 7.8,
  monthlyActivity: [
    { month: "Feb", conversations: 14, leads: 4 },
    { month: "Mar", conversations: 21, leads: 6 },
    { month: "Apr", conversations: 26, leads: 8 },
    { month: "May", conversations: 33, leads: 9 },
    { month: "Jun", conversations: 39, leads: 7 },
    { month: "Jul", conversations: 43, leads: 8 },
  ],
  channelMix: [
    { channel: "Website", value: 58 },
    { channel: "Whatsapp", value: 27 },
    { channel: "Instagram", value: 15 },
  ],
  responseTrend: [
    { week: "W1", rate: 91.2 },
    { week: "W2", rate: 92.4 },
    { week: "W3", rate: 93.0 },
    { week: "W4", rate: 93.4 },
  ],
  leadConversion: 27.3,
  salesInfluenced: 1240000,
  mostActiveAgent: "reception",
  mostActiveAgentShare: 54,
  agentActivity: [
    { agent: "reception", conversations: 95, share: 54 },
    { agent: "sales", conversations: 61, share: 35 },
    { agent: "marketing", conversations: 20, share: 11 },
  ],
  topQuestions: [
    { question: "Do you deliver same-day in Lagos?", count: 23 },
    { question: "What's included in the bridal package?", count: 17 },
    { question: "Can I set up a weekly office subscription?", count: 12 },
    { question: "Do you take custom color palettes?", count: 9 },
  ],
  leadsCount: 42,
  aiUsage: {
    totalInputTokens: 1_284_300,
    totalOutputTokens: 412_760,
    totalCostUsd: 18.42,
    activeProvider: "anthropic",
    byProvider: [
      { provider: "anthropic", inputTokens: 1_112_900, outputTokens: 371_200, costUsd: 16.61, requests: 1240 },
      { provider: "openai", inputTokens: 171_400, outputTokens: 41_560, costUsd: 1.81, requests: 96 },
    ],
  },
  billing: {
    plan: "starter",
    planName: "Starter",
    monthlyRecurringRevenue: 29,
    subscriptionStatus: "active",
    messagesUsed: 1418,
    messageLimit: 2000,
  },
};

const knowledgeItems = [
  { id: "k_01", section: "company", type: "faq", tags: ["hours"], title: "Opening hours & location", content: "Studio: 14 Adeola Odeku St, Victoria Island, Lagos. Mon–Sat 9:00–18:00. Public holidays 10:00–16:00 (closed Dec 25 & Jan 1).", createdAt: daysAgo(60), updatedAt: daysAgo(12) },
  { id: "k_02", section: "products", type: "product", tags: ["bouquet", "seasonal"], title: "Blush Peony set", content: "Seasonal peony bouquet with eucalyptus and a handwritten card. Available Oct–Feb.", price: 42000, currency: "NGN", stockStatus: "in_stock", createdAt: daysAgo(55), updatedAt: daysAgo(8) },
  { id: "k_03", section: "products", type: "product", tags: ["corporate"], title: "Signature lobby subscription", content: "Weekly statement arrangement for hotel and office lobbies, includes Monday install and mid-week refresh.", price: 85000, currency: "NGN", stockStatus: "in_stock", createdAt: daysAgo(50), updatedAt: daysAgo(20) },
  { id: "k_04", section: "pricing", type: "pricing", tags: ["delivery"], title: "Delivery pricing", content: "Lagos same-day ₦2,500 (order before 13:00). Abuja next-day ₦4,500 via cold-chain partner, order before 15:00.", createdAt: daysAgo(48), updatedAt: daysAgo(15) },
  { id: "k_05", section: "policies", type: "policy", tags: ["refunds"], title: "Freshness guarantee", content: "If an arrangement arrives below standard, we redeliver free within 24 hours. Photo required within 4 hours of delivery.", createdAt: daysAgo(45), updatedAt: daysAgo(45) },
  { id: "k_06", section: "faqs", type: "faq", tags: ["bridal"], title: "Bridal consultations", content: "45-minute consultations at the VI studio, Sat 10:00 / 11:30 / 14:00. Bring venue photos and color palette.", createdAt: daysAgo(40), updatedAt: daysAgo(6) },
  { id: "k_07", section: "brand_voice", type: "faq", tags: ["voice"], title: "Tone of voice", content: "Warm, knowledgeable, unhurried. Use botanical names sparingly. Never pressure; always suggest the seasonal option first.", createdAt: daysAgo(38), updatedAt: daysAgo(38) },
  { id: "k_08", section: "documents", type: "document", tags: ["catalogue"], title: "Corporate gifting catalogue 2026", content: "Full corporate catalogue with volume pricing tiers.", document: { filename: "corporate-catalogue-2026.pdf", mimeType: "application/pdf", size: 2_431_812 }, createdAt: daysAgo(21), updatedAt: daysAgo(21) },
];

const sharedFiles: Record<string, string> = {
  "shared/company.md": "# Bloom & Vine Studio\nFloral design studio in Victoria Island, Lagos.\nHours: Mon–Sat 9:00–18:00.",
  "shared/products.md": "# Products\n- Blush Peony set — ₦42,000\n- Signature lobby subscription — ₦85,000/week\n- Amber corporate gift box — ₦18,500/unit",
  "shared/pricing.md": "# Delivery\nLagos same-day ₦2,500 (before 13:00). Abuja next-day ₦4,500.",
  "shared/faq.md": "# FAQ\nQ: Same-day delivery? A: Yes, Lagos, order before 13:00.",
  "shared/brand_voice.md": "# Voice\nWarm, knowledgeable, unhurried.",
  "shared/policies.md": "# Freshness guarantee\nFree redelivery within 24h with photo proof.",
};

const channels = {
  whatsapp: {
    connected: true,
    status: "connected",
    phoneNumberId: "1049 2211 8834",
    wabaId: "2210 4471 90",
    accessTokenMasked: "EAAG•••••kZC",
    webhookVerifyTokenMasked: "hbr•••••42",
    connectedAt: daysAgo(30),
    webhookUrl: "https://harbor-ai-business-os.netlify.app/api/whatsapp/webhook",
    lastWebhookAt: hoursAgo(0.4),
    lastError: null,
  },
  instagram: {
    connected: false,
    businessAccountId: null,
    accessTokenMasked: null,
    webhookVerifyTokenMasked: null,
    webhookUrl: "https://harbor-ai-business-os.netlify.app/api/instagram/webhook",
    connectedAt: null,
    lastError: null,
  },
};

const billingOverview = {
  plan: "starter",
  planDetails: { id: "starter", name: "Starter", priceMonthly: 29, messageLimit: 2000, agentLimit: 2, channels: ["website", "whatsapp"], description: "For small teams getting their first agents live." },
  subscriptionStatus: "active",
  subscriptionPeriodEnd: daysAgo(-17),
  usage: { month: new Date(now).toISOString().slice(0, 7), messagesSent: 1418, messageLimit: 2000, agentsUsed: ["reception", "sales"], leadsCreated: 42, appointmentsBooked: 11, aiTokensUsed: 1_697_060, plan: "starter", subscriptionStatus: "active", subscriptionPeriodEnd: daysAgo(-17) },
  invoices: [
    { id: "inv_0448", amountCents: 2900, currency: "USD", status: "paid", invoicePdfUrl: null, periodStart: daysAgo(43), periodEnd: daysAgo(13), createdAt: daysAgo(13) },
    { id: "inv_0391", amountCents: 2900, currency: "USD", status: "paid", invoicePdfUrl: null, periodStart: daysAgo(73), periodEnd: daysAgo(43), createdAt: daysAgo(43) },
  ],
  plans: [
    { id: "free", name: "Free", priceMonthly: 0, messageLimit: 200, agentLimit: 1, channels: ["website"], description: "Try one agent on your website." },
    { id: "starter", name: "Starter", priceMonthly: 29, messageLimit: 2000, agentLimit: 2, channels: ["website", "whatsapp"], description: "For small teams getting their first agents live." },
    { id: "growth", name: "Growth", priceMonthly: 79, messageLimit: 10000, agentLimit: 3, channels: ["website", "whatsapp", "instagram", "email"], description: "Every agent, every channel, priority support." },
  ],
};

let notifications = [
  { id: "n_01", workspaceId: "ws_mock_1", type: "escalation", title: "Conversation escalated", message: "Bisi Adewale's Instagram thread was escalated: repeated delivery complaint.", isRead: false, link: "/app/conversations", metadata: {}, createdAt: hoursAgo(4.6) },
  { id: "n_02", workspaceId: "ws_mock_1", type: "lead", title: "High-score lead captured", message: "Ngozi Umeh (₦2.4m event budget) qualified by the sales agent.", isRead: false, link: "/app/leads", metadata: {}, createdAt: hoursAgo(20) },
  { id: "n_03", workspaceId: "ws_mock_1", type: "usage", title: "Message usage at 70%", message: "1,418 of 2,000 monthly messages used. Consider the Growth plan.", isRead: true, link: "/app/billing", metadata: {}, createdAt: daysAgo(1) },
];

const settings = {
  notificationPreferences: { emailEnabled: true, whatsappEnabled: false, adminEmail: "amara@bloomvine.studio", adminWhatsApp: null },
};

const marketingDashboard = {
  stats: { leadMagnetsCreated: 3, campaignsActive: 1, leadsGenerated: 27, competitorInsights: 6 },
  campaigns: [
    { id: "c_01", name: "Valentine pre-orders", productId: "k_02", status: "active", leadMagnet: { title: "Peony care guide" }, landingCopy: { headline: "Lagos' most-loved Valentine bouquets" }, emailSequence: { emails: 3 }, leadsGenerated: 27, createdAt: daysAgo(18), updatedAt: daysAgo(2) },
    { id: "c_02", name: "Corporate gifting Q4", productId: null, status: "draft", leadMagnet: null, landingCopy: null, emailSequence: null, leadsGenerated: 0, createdAt: daysAgo(6), updatedAt: daysAgo(6) },
  ],
  insights: [
    { id: "i_01", type: "competitor_pricing", sourceUrl: "https://example-florist.ng/pricing", title: "Competitor raised delivery fees", summary: "Main VI competitor now charges ₦3,500 for same-day delivery — ₦1,000 above ours.", data: {}, createdAt: daysAgo(3) },
    { id: "i_02", type: "industry_news", sourceUrl: "https://floralweekly.com/trends-2026", title: "Dried-flower installs trending", summary: "Dried and preserved installations are up 40% YoY in event design.", data: {}, createdAt: daysAgo(7) },
  ],
  crm: { provider: "hubspot", webhookUrl: "https://api.hubspot.com/crm/v3/webhook", enabled: true },
};

const biDashboard = {
  metrics: { conversationCount: 176, leadCount: 42, qualifiedLeads: 17, appointmentCount: 11, negativeConversations: 6, escalatedConversations: 4, lostLeads: 5, complaintMessages: 8 },
  competitors: [
    { id: "comp_01", sourceUrl: "https://example-florist.ng", mentions: ["same-day delivery", "bridal"], summary: "Strong on bridal SEO; weaker corporate offering.", scrapedAt: daysAgo(3), createdAt: daysAgo(3) },
  ],
  insights: [
    { id: "bi_01", type: "opportunity", title: "Corporate subscriptions under-promoted", summary: "35% of sales conversations mention offices, but the subscription page gets 4% of traffic.", data: {}, createdAt: daysAgo(2) },
    { id: "bi_02", type: "risk", title: "Delivery complaints clustering", summary: "3 of 4 recent escalations cite wilted arrivals on the Ikoyi route.", data: {}, createdAt: daysAgo(1) },
  ],
  competitorUrls: ["https://example-florist.ng"],
};

const workflowsDashboard = {
  workflows: [
    { id: "wf_01", name: "Lead → nurture → book", triggers: ["lead_created"], steps: [{ type: "send_message", config: {} }, { type: "wait", config: { hours: 24 } }, { type: "book_appointment", config: {} }], status: "active", isPrebuilt: true, createdAt: daysAgo(20), updatedAt: daysAgo(4) },
    { id: "wf_02", name: "Escalation follow-up", triggers: ["conversation_escalated"], steps: [{ type: "notify_admin", config: {} }, { type: "create_task", config: {} }], status: "active", isPrebuilt: true, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  ],
  executions: [
    { id: "ex_01", workflowId: "wf_01", status: "completed", currentStepIndex: 3, context: {}, result: { booked: true }, error: null, scheduledAt: null, startedAt: hoursAgo(20), completedAt: hoursAgo(19.4), createdAt: hoursAgo(20) },
    { id: "ex_02", workflowId: "wf_02", status: "completed", currentStepIndex: 2, context: {}, result: {}, error: null, scheduledAt: null, startedAt: hoursAgo(4.6), completedAt: hoursAgo(4.5), createdAt: hoursAgo(4.6) },
    { id: "ex_03", workflowId: "wf_01", status: "running", currentStepIndex: 1, context: {}, result: null, error: null, scheduledAt: null, startedAt: hoursAgo(0.5), completedAt: null, createdAt: hoursAgo(0.5) },
  ],
  stats: { activeWorkflows: 2, totalExecutions: 48, completedExecutions: 44, failedExecutions: 2, successRate: 91.7 },
};

const observabilityHealth = {
  summary: {
    requestCount: 4182,
    errorCount: 23,
    errorRate: 0.55,
    avgLatencyMs: 142,
    p95LatencyMs: 480,
    ai: { count: 1336, avgMs: 1840, p95Ms: 4200 },
    db: { count: 3901, avgMs: 38, p95Ms: 122 },
    webhook: { count: 214, avgMs: 96, failures: 3 },
  },
  generatedAt: new Date(now).toISOString(),
};

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function installMockApi() {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
    const query = url.includes("?") ? new URLSearchParams(url.split("?")[1]) : new URLSearchParams();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (!path.startsWith("/api/")) return realFetch(input, init);

    // Simulate a short network delay so skeletons are visible.
    await new Promise((r) => setTimeout(r, 220));

    // --- auth ---
    if (path === "/api/auth/me" || path === "/api/auth/login" || path === "/api/auth/register") {
      return json(session as unknown as Json);
    }
    if (path === "/api/auth/logout") return json({ ok: true });
    if (path === "/api/auth/forgot-password") {
      return json({ message: "Check your email for reset instructions.", resetUrl: "/reset-password?token=mock" });
    }
    if (path === "/api/auth/reset-password") return json({ message: "Password updated." });

    // --- agents ---
    if (path === "/api/agents") return json({ agents });
    const agentPatch = path.match(/^\/api\/agents\/(\w+)$/);
    if (agentPatch && method === "PATCH") {
      const agent = agents.find((a) => a.id === agentPatch[1]);
      if (agent && init?.body) {
        const patch = JSON.parse(String(init.body)) as { enabled?: boolean; notes?: string };
        if (typeof patch.enabled === "boolean") {
          agent.enabled = patch.enabled;
          agent.status = patch.enabled ? "active" : "paused";
        }
        if (typeof patch.notes === "string") agent.notes = patch.notes;
        agent.lastUpdated = new Date().toISOString();
      }
      return json({ agent: agent as unknown as Json });
    }
    if (/^\/api\/agents\/\w+\/test$/.test(path)) {
      return json({
        reply:
          "Thanks for reaching out! We're open Mon–Sat 9:00–18:00 at 14 Adeola Odeku St, Victoria Island. Would you like me to book you a consultation?",
        mode: "mock",
        citations: [{ source: "company", topic: "Opening hours & location" }],
        action_log: ["retrieved 2 knowledge chunks", "no handoff needed"],
        handoff: null,
        routing_reason: "FAQ about opening hours",
        conversation_id: "conv_test_mock",
      });
    }

    // --- conversations / leads / analytics ---
    if (path === "/api/conversations") return json({ conversations });
    if (/^\/api\/conversations\/[\w-]+\/resolve$/.test(path)) {
      const id = path.split("/")[3];
      const conv = conversations.find((c) => c.id === id);
      if (conv) conv.conversationStatus = "resolved";
      return json({ ok: true });
    }
    if (path === "/api/leads") return json({ leads });
    if (path === "/api/analytics/summary") return json({ summary: analyticsSummary });
    if (path === "/api/chat") {
      return json({
        reply: "Happy to help with that! (mock preview reply)",
        agent: "reception",
        intent: "faq",
        routing_reason: "General question",
        mode: "mock",
        citations: [],
        action_log: [],
      });
    }

    // --- knowledge ---
    if (path === "/api/knowledge" && method === "GET") {
      if (query.get("files") === "1") return json({ files: sharedFiles });
      if (query.get("test") === "1") {
        const q = (query.get("q") ?? "").toLowerCase();
        return json({
          results: knowledgeItems
            .filter((k) => (k.title + k.content).toLowerCase().includes(q))
            .slice(0, 5)
            .map((k) => ({ id: k.id, title: k.title, content: k.content, type: k.type, relevanceScore: 0.82 })),
        });
      }
      const section = query.get("section");
      const q = (query.get("q") ?? "").toLowerCase();
      let items = knowledgeItems;
      if (section) items = items.filter((k) => k.section === section);
      if (q) items = items.filter((k) => (k.title + k.content).toLowerCase().includes(q));
      return json({ items });
    }
    if (path === "/api/knowledge" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Json;
      if (typeof body.path === "string") {
        sharedFiles[body.path] = String(body.content ?? "");
        return json({ ok: true });
      }
      const item = {
        id: `k_${Math.random().toString(36).slice(2, 8)}`,
        section: (body.section as string) ?? "company",
        type: (body.type as string) ?? "faq",
        tags: typeof body.tags === "string" ? body.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        title: String(body.title ?? "Untitled"),
        content: String(body.content ?? ""),
        imageUrl: (body.imageUrl as string) ?? null,
        price: (body.price as number) ?? null,
        currency: (body.currency as string) ?? null,
        stockStatus: (body.stockStatus as string) ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      knowledgeItems.unshift(item as (typeof knowledgeItems)[number]);
      return json({ item });
    }
    const kMatch = path.match(/^\/api\/knowledge\/([\w-]+)$/);
    if (kMatch) {
      const idx = knowledgeItems.findIndex((k) => k.id === kMatch[1]);
      if (method === "DELETE") {
        if (idx >= 0) knowledgeItems.splice(idx, 1);
        return json({ ok: true });
      }
      if (method === "PATCH" && idx >= 0) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Json;
        const existing = knowledgeItems[idx] as unknown as Json;
        Object.assign(existing, body, {
          tags: typeof body.tags === "string" ? body.tags.split(",").map((t) => t.trim()).filter(Boolean) : existing.tags,
          updatedAt: new Date().toISOString(),
        });
        return json({ item: existing });
      }
    }
    if (path === "/api/knowledge/upload") {
      return json({ item: knowledgeItems[7] as unknown as Json, indexed: { chunksIndexed: 14 } });
    }

    // --- channels ---
    if (path === "/api/channels") return json({ channels });
    if (path.startsWith("/api/channels/whatsapp/logs")) {
      return json({
        logs: [
          { id: "wl_01", workspaceId: "ws_mock_1", phoneNumberId: "1049", messageId: "wamid.1", eventType: "message", direction: "inbound", status: "processed", payload: {}, errorMessage: null, createdAt: hoursAgo(0.4) },
          { id: "wl_02", workspaceId: "ws_mock_1", phoneNumberId: "1049", messageId: "wamid.2", eventType: "status", direction: "outbound", status: "delivered", payload: {}, errorMessage: null, createdAt: hoursAgo(1.1) },
        ],
      });
    }
    if (path.startsWith("/api/channels/")) return json({ channels });

    // --- billing ---
    if (path === "/api/billing") return json(billingOverview as unknown as Json);
    if (path === "/api/billing/subscribe") return json({ authorization_url: "#mock-checkout" });
    if (path === "/api/billing/cancel") return json({ message: "Subscription canceled (mock)." });
    if (path === "/api/billing/portal") return json({ url: "#mock-portal" });

    // --- notifications / settings ---
    if (path === "/api/notifications") {
      return json({ notifications, unreadCount: notifications.filter((n) => !n.isRead).length });
    }
    if (path === "/api/notifications/unread-count") {
      return json({ unreadCount: notifications.filter((n) => !n.isRead).length });
    }
    if (path === "/api/notifications/read-all") {
      notifications = notifications.map((n) => ({ ...n, isRead: true }));
      return json({ unreadCount: 0 });
    }
    const nRead = path.match(/^\/api\/notifications\/([\w-]+)\/read$/);
    if (nRead) {
      notifications = notifications.map((n) => (n.id === nRead[1] ? { ...n, isRead: true } : n));
      return json({ unreadCount: notifications.filter((n) => !n.isRead).length });
    }
    if (path === "/api/settings") {
      if (method === "PATCH" && init?.body) {
        const body = JSON.parse(String(init.body)) as { notificationPreferences?: Json };
        Object.assign(settings.notificationPreferences, body.notificationPreferences ?? {});
      }
      return json(settings as unknown as Json);
    }

    // --- marketing / bi / workflows / observability ---
    if (path === "/api/marketing") return json(marketingDashboard as unknown as Json);
    if (path === "/api/marketing/campaign") return json({ campaign: marketingDashboard.campaigns[0] as unknown as Json });
    if (path === "/api/marketing/crm-sync") return json({ synced: 6, message: "6 leads synced (mock)." });
    if (path === "/api/bi") return json(biDashboard as unknown as Json);
    if (path === "/api/bi/competitor-urls") return json({ competitorUrls: biDashboard.competitorUrls });
    if (path === "/api/bi/scrape") return json({ scraped: 1, competitors: biDashboard.competitors });
    if (path === "/api/bi/analyze") return json({ insights: biDashboard.insights });
    if (path === "/api/bi/weekly-report") return json({ ok: true });
    if (path === "/api/workflows" && method === "GET") return json(workflowsDashboard as unknown as Json);
    if (path === "/api/workflows" && method === "POST") return json({ workflow: workflowsDashboard.workflows[0] as unknown as Json });
    if (path === "/api/workflows/execute") return json({ execution: workflowsDashboard.executions[0] as unknown as Json });
    if (path === "/api/workflows/seed") return json({ workflows: workflowsDashboard.workflows });
    if (/^\/api\/workflows\/[\w-]+$/.test(path)) return json({ workflow: workflowsDashboard.workflows[0] as unknown as Json });
    if (path === "/api/observability/health") return json(observabilityHealth as unknown as Json);
    if (path === "/api/admin/health") {
      return json({
        dashboard: {
          totalWorkspaces: 38,
          activeConversationsToday: 214,
          avgAiLatencyMs: 1840,
          errorRate: 0.55,
          webhookSuccessRate: 98.6,
          topErrors: [
            { endpoint: "/api/chat", count: 9, lastSeen: hoursAgo(2) },
            { endpoint: "/api/whatsapp/webhook", count: 3, lastSeen: hoursAgo(6) },
          ],
          summary: observabilityHealth.summary,
        },
        generatedAt: observabilityHealth.generatedAt,
      });
    }

    // Unknown /api route: fall through to the real backend.
    return realFetch(input, init);
  };

  console.info("[harbor] Mock API active — dev preview mode. Disable: localStorage.removeItem('harbor:preview')");
}
