/**
 * Onboarding wizard controller (Problem 3 §Step 1). Validates and persists each
 * section, and tells the caller which sections still need to be completed.
 * Document upload is deliberately blocked until the wizard is 100% done — this
 * is enforced by the upload endpoint reading {@link getWizardStatus} first.
 */

import { ensureDbConnection, getSql } from "../../db.ts";
import {
  replaceEscalationContacts,
  replaceOperatingHours,
  replacePolicyRecords,
  replacePricingItems,
  upsertBusinessProfile,
  type EscalationInput,
  type OperatingHoursInput,
  type PolicyInput,
  type PricingItemInput,
} from "../business-store.ts";
import {
  WIZARD_SECTIONS,
  type WizardSection,
  type BusinessProfile,
} from "../types.ts";

export interface WizardStatus {
  complete: boolean;
  sectionsComplete: WizardSection[];
  sectionsMissing: WizardSection[];
}

async function getSectionsComplete(workspaceId: string): Promise<WizardSection[]> {
  await ensureDbConnection();
  const db = getSql();
  const [profile, hours, prices, policies, escalations] = await Promise.all([
    db`SELECT 1 FROM business_profiles WHERE workspace_id = ${workspaceId} LIMIT 1`,
    db`SELECT count(*)::int AS n FROM operating_hours WHERE workspace_id = ${workspaceId}`,
    db`SELECT count(*)::int AS n FROM pricing_items WHERE workspace_id = ${workspaceId}`,
    db`SELECT count(*)::int AS n FROM policy_records WHERE workspace_id = ${workspaceId} AND policy_type = 'refund'`,
    db`SELECT count(*)::int AS n FROM escalation_contacts WHERE workspace_id = ${workspaceId}`,
  ]);

  const done: WizardSection[] = [];
  if (profile.length > 0) done.push("business_info");
  if (Number(hours[0]?.n ?? 0) >= 7) done.push("operating_hours");
  if (Number(prices[0]?.n ?? 0) > 0) done.push("pricing");
  if (Number(policies[0]?.n ?? 0) > 0) done.push("policies");
  if (Number(escalations[0]?.n ?? 0) > 0) done.push("escalation");
  return done;
}

export async function getWizardStatus(workspaceId: string): Promise<WizardStatus> {
  const sectionsComplete = await getSectionsComplete(workspaceId);
  const sectionsMissing = WIZARD_SECTIONS.filter((s) => !sectionsComplete.includes(s));
  const complete = sectionsMissing.length === 0;
  await recordWizardProgress(workspaceId, sectionsComplete, complete);
  return { complete, sectionsComplete, sectionsMissing };
}

async function recordWizardProgress(
  workspaceId: string,
  sectionsComplete: WizardSection[],
  complete: boolean,
): Promise<void> {
  const db = getSql();
  await db`
    INSERT INTO deployment_status
      (workspace_id, wizard_complete, wizard_sections_complete)
    VALUES
      (${workspaceId}, ${complete}, ${sectionsComplete as unknown as string[]})
    ON CONFLICT (workspace_id) DO UPDATE SET
      wizard_complete = EXCLUDED.wizard_complete,
      wizard_sections_complete = EXCLUDED.wizard_sections_complete
  `;
}

// ── Section submission — one function per section, each validates and writes.

export interface BusinessInfoInput {
  businessName: string;
  industry: string;
  supportEmail: string;
  phone: string;
  timezone: string;
}

function required(value: string, name: string): void {
  if (!value?.trim()) throw new Error(`WIZARD_INVALID:${name}_required`);
}

export async function submitBusinessInfo(
  workspaceId: string,
  input: BusinessInfoInput,
): Promise<BusinessProfile> {
  required(input.businessName, "business_name");
  required(input.industry, "industry");
  required(input.supportEmail, "support_email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.supportEmail)) {
    throw new Error("WIZARD_INVALID:support_email_format");
  }
  required(input.phone, "phone");
  required(input.timezone, "timezone");
  return upsertBusinessProfile(workspaceId, input);
}

export async function submitOperatingHours(
  workspaceId: string,
  days: OperatingHoursInput[],
): Promise<void> {
  if (!Array.isArray(days) || days.length !== 7) {
    throw new Error("WIZARD_INVALID:operating_hours_requires_7_days");
  }
  for (const day of days) {
    if (typeof day.dayOfWeek !== "number" || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      throw new Error("WIZARD_INVALID:day_of_week");
    }
    if (!day.isClosed) {
      if (!day.openTime || !day.closeTime) {
        throw new Error("WIZARD_INVALID:hours_open_close_required");
      }
    }
  }
  await replaceOperatingHours(workspaceId, days);
}

export async function submitPricing(
  workspaceId: string,
  items: PricingItemInput[],
): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("WIZARD_INVALID:pricing_requires_at_least_one_item");
  }
  for (const item of items) {
    required(item.name, "pricing.name");
    if (typeof item.price !== "number" || item.price < 0) {
      throw new Error("WIZARD_INVALID:pricing_price_number");
    }
  }
  await replacePricingItems(workspaceId, items);
}

export async function submitPolicies(
  workspaceId: string,
  policies: PolicyInput[],
): Promise<void> {
  if (!Array.isArray(policies) || policies.length === 0) {
    throw new Error("WIZARD_INVALID:policies_required");
  }
  const hasRefund = policies.some((p) => p.policyType === "refund");
  if (!hasRefund) {
    throw new Error("WIZARD_INVALID:refund_policy_required");
  }
  for (const policy of policies) {
    required(policy.ruleText, "policy.rule_text");
  }
  await replacePolicyRecords(workspaceId, policies);
}

export async function submitEscalation(
  workspaceId: string,
  contacts: EscalationInput[],
): Promise<void> {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw new Error("WIZARD_INVALID:escalation_requires_at_least_one_contact");
  }
  for (const contact of contacts) {
    required(contact.name, "escalation.name");
    required(contact.role, "escalation.role");
    if (!contact.email && !contact.phone) {
      throw new Error("WIZARD_INVALID:escalation_needs_email_or_phone");
    }
  }
  await replaceEscalationContacts(workspaceId, contacts);
}

export type WizardSectionPayload =
  | { section: "business_info"; data: BusinessInfoInput }
  | { section: "operating_hours"; data: OperatingHoursInput[] }
  | { section: "pricing"; data: PricingItemInput[] }
  | { section: "policies"; data: PolicyInput[] }
  | { section: "escalation"; data: EscalationInput[] };

/** Router used by the API endpoint to dispatch a section submission. */
export async function submitSection(
  workspaceId: string,
  payload: WizardSectionPayload,
): Promise<WizardStatus> {
  switch (payload.section) {
    case "business_info":
      await submitBusinessInfo(workspaceId, payload.data);
      break;
    case "operating_hours":
      await submitOperatingHours(workspaceId, payload.data);
      break;
    case "pricing":
      await submitPricing(workspaceId, payload.data);
      break;
    case "policies":
      await submitPolicies(workspaceId, payload.data);
      break;
    case "escalation":
      await submitEscalation(workspaceId, payload.data);
      break;
    default: {
      const exhaustive: never = payload;
      void exhaustive;
      throw new Error("WIZARD_INVALID:unknown_section");
    }
  }
  return getWizardStatus(workspaceId);
}
