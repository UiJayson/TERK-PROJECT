export type ConversationAgent = "reception" | "sales" | "marketing" | "human_review";
export type ConversationChannel =
  | "website"
  | "whatsapp"
  | "instagram"
  | "email"
  | "dashboard";
export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal"
  | "won"
  | "lost";
export type Sentiment = "positive" | "neutral" | "negative";

export interface ConversationMessage {
  id: string;
  role: "customer" | "agent" | "system";
  agent?: ConversationAgent;
  content: string;
  sentAt: string;
  handoff?: {
    from: ConversationAgent;
    to: ConversationAgent;
    reason: string;
  };
}

export interface Conversation {
  id: string;
  customer: {
    name: string;
    email?: string;
    phone?: string;
    handle?: string;
  };
  channel: ConversationChannel;
  agentUsed: ConversationAgent;
  conversationStatus?: "open" | "escalated" | "resolved";
  leadStatus: LeadStatus;
  sentiment: Sentiment;
  updatedAt: string;
  preview: string;
  unread: boolean;
  messages: ConversationMessage[];
}

export type ConversationChannelFilter = "all" | "whatsapp" | "instagram" | "web";

export const AGENT_FILTERS: ConversationAgent[] = ["reception", "sales", "marketing"];

export const CONVERSATION_CHANNEL_FILTERS: Array<{
  id: ConversationChannelFilter;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "web", label: "Web" },
];

export function channelFilterGroup(
  channel: ConversationChannel,
): Exclude<ConversationChannelFilter, "all"> {
  if (channel === "whatsapp") return "whatsapp";
  if (channel === "instagram") return "instagram";
  return "web";
}

export function matchesChannelFilter(
  channel: ConversationChannel,
  filter: ConversationChannelFilter,
): boolean {
  if (filter === "all") return true;
  return channelFilterGroup(channel) === filter;
}

export const AGENT_LABELS: Record<ConversationAgent, string> = {
  reception: "Reception",
  sales: "Sales",
  marketing: "Marketing",
  human_review: "Human review",
};

export const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  email: "Email",
  dashboard: "Dashboard",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

export const PLACEHOLDER_CONVERSATIONS: Conversation[] = [
  {
    id: "conv_01",
    customer: {
      name: "Avery Chen",
      email: "avery@northwind.co",
      phone: "+44 7700 900111",
    },
    channel: "website",
    agentUsed: "reception",
    leadStatus: "new",
    sentiment: "positive",
    updatedAt: "2026-07-04T13:42:00Z",
    preview: "Can someone help me book a tour for next week?",
    unread: true,
    messages: [
      {
        id: "m1",
        role: "customer",
        content: "Hi — can someone help me book a tour for next week?",
        sentAt: "2026-07-04T13:40:00Z",
      },
      {
        id: "m2",
        role: "agent",
        agent: "reception",
        content:
          "Happy to help. What day works best, and should we reach you by email or phone?",
        sentAt: "2026-07-04T13:41:00Z",
      },
      {
        id: "m3",
        role: "customer",
        content: "Tuesday afternoon works. Email is fine — avery@northwind.co",
        sentAt: "2026-07-04T13:42:00Z",
      },
    ],
  },
  {
    id: "conv_02",
    customer: {
      name: "Jordan Blake",
      email: "jordan@blake.studio",
    },
    channel: "email",
    agentUsed: "sales",
    leadStatus: "qualified",
    sentiment: "neutral",
    updatedAt: "2026-07-04T12:18:00Z",
    preview: "Which package fits a team of 8?",
    unread: true,
    messages: [
      {
        id: "m1",
        role: "customer",
        content:
          "Subject: Package question\n\nWhich package fits a team of 8? We need private space and meeting rooms.",
        sentAt: "2026-07-04T12:10:00Z",
      },
      {
        id: "m2",
        role: "agent",
        agent: "sales",
        content:
          "For a team of 8, a Private Office is usually the best fit. Do you have a timeline and budget range I can work with?",
        sentAt: "2026-07-04T12:18:00Z",
      },
    ],
  },
  {
    id: "conv_03",
    customer: {
      name: "Sam Okonkwo",
      phone: "+44 7700 900222",
    },
    channel: "whatsapp",
    agentUsed: "reception",
    leadStatus: "new",
    sentiment: "neutral",
    updatedAt: "2026-07-04T11:05:00Z",
    preview: "What are your opening hours?",
    unread: false,
    messages: [
      {
        id: "m1",
        role: "customer",
        content: "What are your opening hours?",
        sentAt: "2026-07-04T11:04:00Z",
      },
      {
        id: "m2",
        role: "agent",
        agent: "reception",
        content:
          "We're open Monday–Friday 8 AM–8 PM and Saturday 9 AM–5 PM. Closed Sunday. Want to book a tour?",
        sentAt: "2026-07-04T11:05:00Z",
      },
    ],
  },
  {
    id: "conv_04",
    customer: {
      name: "Riley Santos",
      handle: "@rileysantos",
    },
    channel: "instagram",
    agentUsed: "marketing",
    leadStatus: "new",
    sentiment: "positive",
    updatedAt: "2026-07-03T18:22:00Z",
    preview: "Love the space — can you share a caption for our collab post?",
    unread: false,
    messages: [
      {
        id: "m1",
        role: "customer",
        content: "Love the space — can you share a caption for our collab post?",
        sentAt: "2026-07-03T18:20:00Z",
      },
      {
        id: "m2",
        role: "agent",
        agent: "marketing",
        content:
          "Draft: “A calm, professional home for growing teams. Flexible desks, private offices, and rooms ready when you are.” Want a shorter version?",
        sentAt: "2026-07-03T18:22:00Z",
      },
    ],
  },
  {
    id: "conv_05",
    customer: {
      name: "Morgan Lee",
      email: "morgan@leeandco.com",
      phone: "+44 7700 900333",
    },
    channel: "website",
    agentUsed: "sales",
    leadStatus: "proposal",
    sentiment: "positive",
    updatedAt: "2026-07-03T16:40:00Z",
    preview: "Can you send pricing for the 6-person office?",
    unread: false,
    messages: [
      {
        id: "m1",
        role: "customer",
        content: "Can you send pricing for the 6-person office?",
        sentAt: "2026-07-03T16:30:00Z",
      },
      {
        id: "m2",
        role: "agent",
        agent: "sales",
        content:
          "Private Office (6-person) is £1,650/month excl. VAT, with a 3-month minimum. I can prepare a short proposal if helpful.",
        sentAt: "2026-07-03T16:35:00Z",
      },
      {
        id: "m3",
        role: "customer",
        content: "Yes please — include meeting room hours.",
        sentAt: "2026-07-03T16:40:00Z",
      },
    ],
  },
  {
    id: "conv_06",
    customer: {
      name: "Casey Nguyen",
      email: "casey@example.com",
    },
    channel: "email",
    agentUsed: "reception",
    leadStatus: "lost",
    sentiment: "negative",
    updatedAt: "2026-07-02T09:15:00Z",
    preview: "I'm unhappy about the tour no-show policy.",
    unread: false,
    messages: [
      {
        id: "m1",
        role: "customer",
        content: "I'm unhappy about the tour no-show policy. This feels unfair.",
        sentAt: "2026-07-02T09:10:00Z",
      },
      {
        id: "m2",
        role: "agent",
        agent: "reception",
        content:
          "I'm sorry this has been frustrating. I'll escalate this to our team for a personal review and follow-up.",
        sentAt: "2026-07-02T09:12:00Z",
      },
      {
        id: "m3",
        role: "system",
        content: "Handoff requested → Human review",
        sentAt: "2026-07-02T09:15:00Z",
      },
    ],
  },
  {
    id: "conv_07",
    customer: {
      name: "Priya Shah",
      phone: "+44 7700 900444",
    },
    channel: "whatsapp",
    agentUsed: "sales",
    leadStatus: "qualified",
    sentiment: "positive",
    updatedAt: "2026-07-02T08:50:00Z",
    preview: "We need hot desks for 3 freelancers starting August.",
    unread: false,
    messages: [
      {
        id: "m1",
        role: "customer",
        content: "We need hot desks for 3 freelancers starting August.",
        sentAt: "2026-07-02T08:45:00Z",
      },
      {
        id: "m2",
        role: "agent",
        agent: "sales",
        content:
          "Hot Desk is £199/month excl. VAT per person. I can reserve interest for August — shall I collect names and emails?",
        sentAt: "2026-07-02T08:50:00Z",
      },
    ],
  },
  {
    id: "conv_08",
    customer: {
      name: "Studio North",
      handle: "@studionorth",
    },
    channel: "instagram",
    agentUsed: "marketing",
    leadStatus: "new",
    sentiment: "neutral",
    updatedAt: "2026-07-01T20:05:00Z",
    preview: "Any promo ideas for a summer membership push?",
    unread: false,
    messages: [
      {
        id: "m1",
        role: "customer",
        content: "Any promo ideas for a summer membership push?",
        sentAt: "2026-07-01T20:00:00Z",
      },
      {
        id: "m2",
        role: "agent",
        agent: "marketing",
        content:
          "Idea: “Summer focus month” — highlight flexible desks and free tours. I can draft 3 captions if you share the offer details from approved pricing.",
        sentAt: "2026-07-01T20:05:00Z",
      },
    ],
  },
];
