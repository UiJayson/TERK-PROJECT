export type LeadAgent = "reception" | "sales" | "marketing" | "human_review";
export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal"
  | "won"
  | "lost";

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  productInterest: string;
  leadScore: number;
  assignedAgent: LeadAgent;
  status: LeadStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  source: string;
}

export const LEAD_AGENT_LABELS: Record<LeadAgent, string> = {
  reception: "Reception",
  sales: "Sales",
  marketing: "Marketing",
  human_review: "Human review",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
];

export const LEAD_AGENTS: LeadAgent[] = ["reception", "sales", "marketing"];

export type LeadSortKey =
  | "name"
  | "leadScore"
  | "status"
  | "assignedAgent"
  | "updatedAt";

export const PLACEHOLDER_LEADS: Lead[] = [
  {
    id: "lead_01",
    name: "Avery Chen",
    phone: "+44 7700 900111",
    email: "avery@northwind.co",
    productInterest: "Private Office (6-person)",
    leadScore: 86,
    assignedAgent: "sales",
    status: "qualified",
    notes: "Booked a tour for Tuesday. Team of 8, needs meeting rooms.",
    createdAt: "2026-07-04T13:40:00Z",
    updatedAt: "2026-07-04T13:42:00Z",
    source: "Website chat",
  },
  {
    id: "lead_02",
    name: "Jordan Blake",
    phone: "+44 7700 900555",
    email: "jordan@blake.studio",
    productInterest: "Private Office",
    leadScore: 78,
    assignedAgent: "sales",
    status: "proposal",
    notes: "Asked for package fit for 8 people. Proposal draft pending.",
    createdAt: "2026-07-04T12:10:00Z",
    updatedAt: "2026-07-04T12:18:00Z",
    source: "Email",
  },
  {
    id: "lead_03",
    name: "Sam Okonkwo",
    phone: "+44 7700 900222",
    email: "sam.okonkwo@example.com",
    productInterest: "Hot Desk",
    leadScore: 42,
    assignedAgent: "reception",
    status: "new",
    notes: "Asked about opening hours. Mild interest in a tour.",
    createdAt: "2026-07-04T11:04:00Z",
    updatedAt: "2026-07-04T11:05:00Z",
    source: "WhatsApp",
  },
  {
    id: "lead_04",
    name: "Morgan Lee",
    phone: "+44 7700 900333",
    email: "morgan@leeandco.com",
    productInterest: "Private Office (6-person)",
    leadScore: 91,
    assignedAgent: "sales",
    status: "proposal",
    notes: "Requested pricing and meeting room hours in proposal.",
    createdAt: "2026-07-03T16:30:00Z",
    updatedAt: "2026-07-03T16:40:00Z",
    source: "Website chat",
  },
  {
    id: "lead_05",
    name: "Priya Shah",
    phone: "+44 7700 900444",
    email: "priya.shah@example.com",
    productInterest: "Hot Desk × 3",
    leadScore: 74,
    assignedAgent: "sales",
    status: "qualified",
    notes: "Three freelancers starting August. Collect names next.",
    createdAt: "2026-07-02T08:45:00Z",
    updatedAt: "2026-07-02T08:50:00Z",
    source: "WhatsApp",
  },
  {
    id: "lead_06",
    name: "Riley Santos",
    phone: "+44 7700 900666",
    email: "riley@santos.media",
    productInterest: "Brand collaboration",
    leadScore: 55,
    assignedAgent: "marketing",
    status: "contacted",
    notes: "Instagram collab caption request. Warm brand fit.",
    createdAt: "2026-07-03T18:20:00Z",
    updatedAt: "2026-07-03T18:22:00Z",
    source: "Instagram",
  },
  {
    id: "lead_07",
    name: "Casey Nguyen",
    phone: "+44 7700 900777",
    email: "casey@example.com",
    productInterest: "Tour / membership",
    leadScore: 28,
    assignedAgent: "reception",
    status: "lost",
    notes: "Complaint about no-show policy. Escalated to human review.",
    createdAt: "2026-07-02T09:10:00Z",
    updatedAt: "2026-07-02T09:15:00Z",
    source: "Email",
  },
  {
    id: "lead_08",
    name: "Studio North",
    phone: "+44 161 555 0188",
    email: "hello@studionorth.example",
    productInterest: "Membership campaign",
    leadScore: 61,
    assignedAgent: "marketing",
    status: "contacted",
    notes: "Wants summer promo ideas. Waiting on approved offer details.",
    createdAt: "2026-07-01T20:00:00Z",
    updatedAt: "2026-07-01T20:05:00Z",
    source: "Instagram",
  },
  {
    id: "lead_09",
    name: "Elena Petrova",
    phone: "+44 7700 900888",
    email: "elena@petrova.design",
    productInterest: "Dedicated Desk",
    leadScore: 67,
    assignedAgent: "sales",
    status: "contacted",
    notes: "Solo designer, needs fixed desk and mail handling.",
    createdAt: "2026-07-01T14:20:00Z",
    updatedAt: "2026-07-01T15:10:00Z",
    source: "Website chat",
  },
  {
    id: "lead_10",
    name: "Noah Wright",
    phone: "+44 7700 900999",
    email: "noah@wrightventures.co",
    productInterest: "Virtual Desk",
    leadScore: 49,
    assignedAgent: "reception",
    status: "new",
    notes: "Needs business address only. Low urgency.",
    createdAt: "2026-06-30T10:00:00Z",
    updatedAt: "2026-06-30T10:05:00Z",
    source: "Email",
  },
];
