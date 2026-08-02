import { createId } from "./auth-crypto.ts";
import * as db from "./db.ts";
import { notifyBusinessOwner } from "./notifications.ts";
import { upsertLeadFromCapture } from "./runtime-store.ts";
import type { RuntimeChannel } from "./runtime-store.ts";
import type { AgentRole } from "./types.ts";

export type LeadFields = {
  name?: string;
  email?: string;
  phone?: string;
  budget?: string;
  timeline?: string;
  serviceInterest?: string;
};

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/;

const BUDGET_PATTERN =
  /\b(?:budget|spend|afford)\s*(?:is|of|around|about)?\s*([£$€]?\s*\d[\d,]*(?:\s*(?:k|thousand|per month|\/mo))?)/i;

const TIMELINE_PATTERN =
  /\b(this week|next week|this month|next month|asap|as soon as possible|within \d+ (?:days|weeks|months)|in \d+ (?:days|weeks|months)|immediately|soon)\b/i;

const SERVICE_PATTERN =
  /\b(hot desk|dedicated desk|private office|meeting room|virtual desk|tour|membership|workspace|office space)\b/i;

const NAME_PATTERN =
  /\b(?:i'?m|i am|my name is|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/;

export function extractLeadFields(
  message: string,
  existing: LeadFields = {},
): LeadFields {
  const next: LeadFields = { ...existing };

  const email = message.match(EMAIL_PATTERN)?.[0];
  if (email) next.email = email.toLowerCase();

  const phone = message.match(PHONE_PATTERN)?.[0];
  if (phone) next.phone = phone.replace(/\s+/g, " ").trim();

  const nameMatch = message.match(NAME_PATTERN);
  if (nameMatch?.[1]) next.name = nameMatch[1].trim();

  const budgetMatch = message.match(BUDGET_PATTERN);
  if (budgetMatch?.[1]) next.budget = budgetMatch[1].trim();

  const timelineMatch = message.match(TIMELINE_PATTERN);
  if (timelineMatch?.[0]) next.timeline = timelineMatch[0].trim();

  const serviceMatch = message.match(SERVICE_PATTERN);
  if (serviceMatch?.[0]) next.serviceInterest = serviceMatch[0].trim();

  return next;
}

export function computeLeadScore(fields: LeadFields): number {
  let score = 20;
  if (fields.name) score += 10;
  if (fields.email) score += 15;
  if (fields.phone) score += 15;
  if (fields.budget) score += 20;
  if (fields.timeline) score += 20;
  if (fields.serviceInterest) score += 10;
  return Math.min(score, 100);
}

export function isQualifiedLead(fields: LeadFields): boolean {
  return Boolean(fields.budget && fields.timeline);
}

export async function updateCustomerLeadProfile(input: {
  workspaceId: string;
  customerId: string;
  fields: LeadFields;
  collectedFields?: Record<string, string>;
}): Promise<{ leadData: LeadFields; leadScore: number; qualified: boolean }> {
  const merged = extractLeadFields("", {
    ...input.fields,
    name:
      input.fields.name ||
      input.collectedFields?.name ||
      input.collectedFields?.full_name,
    email: input.fields.email || input.collectedFields?.email,
    phone: input.fields.phone || input.collectedFields?.phone,
  });

  const leadScore = computeLeadScore(merged);
  await db.updateCustomerLeadData(input.workspaceId, input.customerId, merged, leadScore);

  return {
    leadData: merged,
    leadScore,
    qualified: isQualifiedLead(merged),
  };
}

export async function processLeadQualification(input: {
  workspaceId: string;
  customerId: string;
  message: string;
  channel: RuntimeChannel;
  conversationId?: string;
  agentUsed: AgentRole;
  collectedFields?: Record<string, string>;
  existingLeadData?: Record<string, unknown>;
  previouslyQualified?: boolean;
  userMessageCount?: number;
}): Promise<{ qualified: boolean; fields: LeadFields }> {
  const existing = (input.existingLeadData ?? {}) as LeadFields;
  const messageCount = input.userMessageCount ?? 1;

  if (messageCount < 3) {
    return { qualified: isQualifiedLead(existing), fields: existing };
  }

  const fields = extractLeadFields(input.message, existing);
  const { leadScore, qualified } = await updateCustomerLeadProfile({
    workspaceId: input.workspaceId,
    customerId: input.customerId,
    fields,
    collectedFields: input.collectedFields,
  });

  if (qualified && !input.previouslyQualified) {
    const leadId = createId("lead");
    await upsertLeadFromCapture({
      workspaceId: input.workspaceId,
      leadId,
      name: fields.name ?? input.collectedFields?.name ?? "Qualified lead",
      email: fields.email ?? input.collectedFields?.email ?? "",
      phone: fields.phone ?? input.collectedFields?.phone ?? "",
      channel: input.channel,
      sourceMessage: input.message.slice(0, 500),
      timestamp: new Date().toISOString(),
      conversationId: input.conversationId,
      agentUsed: input.agentUsed,
      status: "qualified",
    });

    await db.updateLeadStatus(input.workspaceId, leadId, "qualified");

    const { incrementLeadUsage } = await import("./usage-limits.ts");
    await incrementLeadUsage(input.workspaceId);

    await notifyBusinessOwner({
      workspaceId: input.workspaceId,
      type: "qualified_lead",
      title: "New qualified lead",
      customerName: fields.name ?? input.collectedFields?.name,
      leadEmail: fields.email ?? input.collectedFields?.email,
      leadPhone: fields.phone ?? input.collectedFields?.phone,
      interest: fields.serviceInterest,
      budget: fields.budget,
      timeline: fields.timeline,
      body: [
        fields.name ? `Name: ${fields.name}` : "",
        fields.email ? `Email: ${fields.email}` : "",
        fields.phone ? `Phone: ${fields.phone}` : "",
        fields.budget ? `Budget: ${fields.budget}` : "",
        fields.timeline ? `Timeline: ${fields.timeline}` : "",
        fields.serviceInterest ? `Interest: ${fields.serviceInterest}` : "",
        `Score: ${leadScore}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { leadId, conversationId: input.conversationId },
    });

    const { publish } = await import("./event-bus.ts");
    await publish(input.workspaceId, "lead.qualified", {
      leadId,
      customerName: fields.name ?? input.collectedFields?.name,
      leadEmail: fields.email ?? input.collectedFields?.email,
      leadPhone: fields.phone ?? input.collectedFields?.phone,
      interest: fields.serviceInterest,
      budget: fields.budget,
      timeline: fields.timeline,
      conversationId: input.conversationId,
    });
  }

  return { qualified, fields };
}

export function formatLeadDataForPrompt(leadData: Record<string, unknown>): string {
  const fields = leadData as LeadFields;
  const lines = ["## Lead qualification (customer profile)", ""];

  if (fields.name) lines.push(`Name: ${fields.name}`);
  if (fields.email) lines.push(`Email: ${fields.email}`);
  if (fields.phone) lines.push(`Phone: ${fields.phone}`);
  if (fields.budget) lines.push(`Budget: ${fields.budget}`);
  if (fields.timeline) lines.push(`Timeline: ${fields.timeline}`);
  if (fields.serviceInterest) lines.push(`Service interest: ${fields.serviceInterest}`);

  if (lines.length === 2) {
    lines.push("No qualification fields captured yet. Ask naturally for name, contact, budget, and timeline.");
  } else {
    lines.push("", "Continue gathering missing fields conversationally — do not interrogate.");
  }

  return lines.join("\n");
}
