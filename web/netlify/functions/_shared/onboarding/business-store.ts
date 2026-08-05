/**
 * Read/write of verified structured business data. Every function is
 * workspace-scoped. This data is the Track-1 source of truth for the two-track
 * retrieval router — never let it compete with document RAG.
 */

import { createId } from "../auth-crypto.ts";
import { ensureDbConnection, getSql } from "../db.ts";
import type {
  BusinessProfile,
  EscalationContact,
  EscalationRole,
  OperatingHoursDay,
  PolicyRecord,
  PolicyType,
  PricingItem,
} from "./types.ts";

// ── business_profiles ────────────────────────────────────────────────────

export async function getBusinessProfile(workspaceId: string): Promise<BusinessProfile | null> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT business_name, industry, support_email, phone, timezone
    FROM business_profiles WHERE workspace_id = ${workspaceId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    workspaceId,
    businessName: (row.business_name as string) ?? "",
    industry: (row.industry as string) ?? "",
    supportEmail: (row.support_email as string) ?? "",
    phone: (row.phone as string) ?? "",
    timezone: (row.timezone as string) ?? "UTC",
  };
}

export async function upsertBusinessProfile(
  workspaceId: string,
  input: Omit<BusinessProfile, "workspaceId">,
): Promise<BusinessProfile> {
  await ensureDbConnection();
  const db = getSql();
  await db`
    INSERT INTO business_profiles
      (id, workspace_id, business_name, industry, support_email, phone, timezone, created_at, updated_at)
    VALUES
      (${createId("biz")}, ${workspaceId}, ${input.businessName}, ${input.industry},
       ${input.supportEmail}, ${input.phone}, ${input.timezone}, now(), now())
    ON CONFLICT (workspace_id) DO UPDATE SET
      business_name = EXCLUDED.business_name,
      industry      = EXCLUDED.industry,
      support_email = EXCLUDED.support_email,
      phone         = EXCLUDED.phone,
      timezone      = EXCLUDED.timezone,
      updated_at    = now()
  `;
  return { workspaceId, ...input };
}

// ── operating_hours (one row per day 0..6) ───────────────────────────────

export async function getOperatingHours(workspaceId: string): Promise<OperatingHoursDay[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT id, day_of_week, open_time, close_time, is_closed, is_holiday, holiday_label
    FROM operating_hours WHERE workspace_id = ${workspaceId}
    ORDER BY day_of_week ASC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    workspaceId,
    dayOfWeek: Number(row.day_of_week),
    openTime: row.open_time ? String(row.open_time).slice(0, 5) : null,
    closeTime: row.close_time ? String(row.close_time).slice(0, 5) : null,
    isClosed: Boolean(row.is_closed),
    isHoliday: Boolean(row.is_holiday),
    holidayLabel: (row.holiday_label as string | null) ?? null,
  }));
}

export interface OperatingHoursInput {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  isHoliday?: boolean;
  holidayLabel?: string | null;
}

/** Replace the whole 7-day schedule atomically. */
export async function replaceOperatingHours(
  workspaceId: string,
  days: OperatingHoursInput[],
): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  await db.begin(async (tx) => {
    await tx`DELETE FROM operating_hours WHERE workspace_id = ${workspaceId}`;
    for (const day of days) {
      await tx`
        INSERT INTO operating_hours
          (id, workspace_id, day_of_week, open_time, close_time, is_closed, is_holiday, holiday_label)
        VALUES
          (${createId("hrs")}, ${workspaceId}, ${day.dayOfWeek},
           ${day.openTime}, ${day.closeTime}, ${day.isClosed},
           ${day.isHoliday ?? false}, ${day.holidayLabel ?? null})
      `;
    }
  });
}

// ── pricing_items ────────────────────────────────────────────────────────

export async function listPricingItems(workspaceId: string): Promise<PricingItem[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT id, name, description, price, currency, discount_percent, is_active
    FROM pricing_items WHERE workspace_id = ${workspaceId}
    ORDER BY name ASC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    workspaceId,
    name: String(row.name),
    description: (row.description as string) ?? "",
    price: Number(row.price ?? 0),
    currency: (row.currency as string) ?? "USD",
    discountPercent: row.discount_percent == null ? null : Number(row.discount_percent),
    isActive: Boolean(row.is_active),
  }));
}

export interface PricingItemInput {
  name: string;
  description?: string;
  price: number;
  currency?: string;
  discountPercent?: number | null;
  isActive?: boolean;
}

export async function replacePricingItems(
  workspaceId: string,
  items: PricingItemInput[],
): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  await db.begin(async (tx) => {
    await tx`DELETE FROM pricing_items WHERE workspace_id = ${workspaceId}`;
    for (const item of items) {
      await tx`
        INSERT INTO pricing_items
          (id, workspace_id, name, description, price, currency, discount_percent, is_active)
        VALUES
          (${createId("pri")}, ${workspaceId}, ${item.name}, ${item.description ?? ""},
           ${item.price}, ${item.currency ?? "USD"}, ${item.discountPercent ?? null},
           ${item.isActive ?? true})
      `;
    }
  });
}

// ── policy_records ───────────────────────────────────────────────────────

export async function listPolicyRecords(workspaceId: string): Promise<PolicyRecord[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT id, policy_type, rule_text, window_days, effective_date, version
    FROM policy_records WHERE workspace_id = ${workspaceId}
    ORDER BY policy_type ASC, version DESC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    workspaceId,
    policyType: String(row.policy_type) as PolicyType,
    ruleText: String(row.rule_text),
    windowDays: row.window_days == null ? null : Number(row.window_days),
    effectiveDate: row.effective_date ? String(row.effective_date).slice(0, 10) : null,
    version: Number(row.version ?? 1),
  }));
}

export async function getPolicyByType(
  workspaceId: string,
  policyType: PolicyType,
): Promise<PolicyRecord | null> {
  const all = await listPolicyRecords(workspaceId);
  return all.find((row) => row.policyType === policyType) ?? null;
}

export interface PolicyInput {
  policyType: PolicyType;
  ruleText: string;
  windowDays?: number | null;
  effectiveDate?: string | null;
}

export async function replacePolicyRecords(
  workspaceId: string,
  policies: PolicyInput[],
): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  await db.begin(async (tx) => {
    await tx`DELETE FROM policy_records WHERE workspace_id = ${workspaceId}`;
    for (const policy of policies) {
      await tx`
        INSERT INTO policy_records
          (id, workspace_id, policy_type, rule_text, window_days, effective_date, version)
        VALUES
          (${createId("pol")}, ${workspaceId}, ${policy.policyType}, ${policy.ruleText},
           ${policy.windowDays ?? null}, ${policy.effectiveDate ?? null}, 1)
      `;
    }
  });
}

// ── escalation_contacts ──────────────────────────────────────────────────

export async function listEscalationContacts(workspaceId: string): Promise<EscalationContact[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT id, role, name, email, phone
    FROM escalation_contacts WHERE workspace_id = ${workspaceId}
    ORDER BY role ASC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    workspaceId,
    role: String(row.role) as EscalationRole,
    name: (row.name as string) ?? "",
    email: (row.email as string) ?? "",
    phone: (row.phone as string) ?? "",
  }));
}

export interface EscalationInput {
  role: EscalationRole;
  name: string;
  email?: string;
  phone?: string;
}

export async function replaceEscalationContacts(
  workspaceId: string,
  contacts: EscalationInput[],
): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  await db.begin(async (tx) => {
    await tx`DELETE FROM escalation_contacts WHERE workspace_id = ${workspaceId}`;
    for (const contact of contacts) {
      await tx`
        INSERT INTO escalation_contacts
          (id, workspace_id, role, name, email, phone)
        VALUES
          (${createId("esc")}, ${workspaceId}, ${contact.role}, ${contact.name},
           ${contact.email ?? ""}, ${contact.phone ?? ""})
      `;
    }
  });
}
