/**
 * Structured business-data types (Problem 3 §Step 1). These are the "primary
 * source of truth" the two-track retrieval router queries first — deterministic
 * DB lookups with zero AI, zero hallucination risk.
 */

export interface BusinessProfile {
  workspaceId: string;
  businessName: string;
  industry: string;
  supportEmail: string;
  phone: string;
  timezone: string;
}

export interface OperatingHoursDay {
  id: string;
  workspaceId: string;
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  openTime: string | null; // "HH:MM" or null when closed
  closeTime: string | null;
  isClosed: boolean;
  isHoliday: boolean;
  holidayLabel: string | null;
}

export interface PricingItem {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  discountPercent: number | null;
  isActive: boolean;
}

export type PolicyType =
  | "refund"
  | "cancellation"
  | "exchange"
  | "delivery"
  | "damage";

export interface PolicyRecord {
  id: string;
  workspaceId: string;
  policyType: PolicyType;
  ruleText: string;
  /** Exact days for windowed policies (refund/cancellation/exchange). */
  windowDays: number | null;
  effectiveDate: string | null;
  version: number;
}

export type EscalationRole = "manager" | "support" | "emergency";

export interface EscalationContact {
  id: string;
  workspaceId: string;
  role: EscalationRole;
  name: string;
  email: string;
  phone: string;
}

export type WizardSection =
  | "business_info"
  | "operating_hours"
  | "pricing"
  | "policies"
  | "escalation";

export const WIZARD_SECTIONS: WizardSection[] = [
  "business_info",
  "operating_hours",
  "pricing",
  "policies",
  "escalation",
];

/** Critical answer categories the deployment gate requires to be verified. */
export type CriticalCategory =
  | "refund_policy"
  | "operating_hours"
  | "pricing"
  | "escalation_contact";

export const CRITICAL_CATEGORIES: CriticalCategory[] = [
  "refund_policy",
  "operating_hours",
  "pricing",
  "escalation_contact",
];

export type ChunkCategory =
  | "pricing"
  | "policy"
  | "product_spec"
  | "troubleshooting"
  | "faq"
  | "general";
