import { createId } from "./auth-crypto.ts";
import type { RuntimeChannel } from "./runtime-store.ts";
import { upsertLeadFromCapture } from "./runtime-store.ts";
import type { AgentRole } from "./types.ts";

const BUYING_SIGNAL_PATTERN =
  /\b(buy|purchase|order|price|pricing|quote|book|booking|tour|interested|sign up|signup|plan|office|desk|membership|demo|trial)\b/i;

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/;

export interface CapturedLeadRecord {
  id: string;
  name: string;
  contact: string;
  channel: RuntimeChannel;
  sourceMessage: string;
  timestamp: string;
  status: "new";
}

function extractEmail(text: string): string | undefined {
  return text.match(EMAIL_PATTERN)?.[0];
}

function extractPhone(text: string): string | undefined {
  const match = text.match(PHONE_PATTERN)?.[0];
  return match?.replace(/\s+/g, " ").trim();
}

function extractNameFromMessage(text: string): string | undefined {
  const patterns = [
    /\b(?:i'?m|i am|my name is|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+here\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return undefined;
}

function resolveName(input: {
  message: string;
  collectedFields?: Record<string, string>;
}): string | undefined {
  const fromFields =
    input.collectedFields?.name?.trim() ||
    input.collectedFields?.full_name?.trim() ||
    input.collectedFields?.handle?.trim();

  if (fromFields && fromFields !== "Website visitor") return fromFields;
  return extractNameFromMessage(input.message);
}

function resolveContact(input: {
  message: string;
  collectedFields?: Record<string, string>;
}): { contact: string; email: string; phone: string } {
  const email =
    input.collectedFields?.email?.trim() ||
    extractEmail(input.message) ||
    "";
  const phone =
    input.collectedFields?.phone?.trim() ||
    extractPhone(input.message) ||
    "";

  const contact = email || phone;
  return { contact, email, phone };
}

export function shouldAutoCaptureLead(input: {
  message: string;
  collectedFields?: Record<string, string>;
}): boolean {
  const name = resolveName(input);
  const { email, phone } = resolveContact(input);
  const hasContact = Boolean(email || phone);
  const hasName = Boolean(name);
  const hasBuyingSignal = BUYING_SIGNAL_PATTERN.test(input.message);

  return (hasName && hasContact) || (hasContact && hasBuyingSignal) || (hasName && hasBuyingSignal);
}

export async function tryAutoCaptureLead(input: {
  workspaceId: string;
  message: string;
  channel: RuntimeChannel;
  conversationId?: string;
  agentUsed?: AgentRole;
  collectedFields?: Record<string, string>;
}): Promise<CapturedLeadRecord | null> {
  if (!shouldAutoCaptureLead(input)) return null;

  const name = resolveName(input) ?? "Unknown contact";
  const { contact, email, phone } = resolveContact(input);
  if (!contact && !BUYING_SIGNAL_PATTERN.test(input.message)) return null;

  const timestamp = new Date().toISOString();
  const leadId = createId("lead");

  await upsertLeadFromCapture({
    workspaceId: input.workspaceId,
    leadId,
    name,
    email,
    phone,
    channel: input.channel,
    sourceMessage: input.message.slice(0, 500),
    timestamp,
    conversationId: input.conversationId,
    agentUsed: input.agentUsed ?? "reception",
  });

  return {
    id: leadId,
    name,
    contact: contact || phone || email,
    channel: input.channel,
    sourceMessage: input.message.slice(0, 500),
    timestamp,
    status: "new",
  };
}
