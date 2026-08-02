import { createId } from "./auth-crypto.ts";
import { getSql } from "./db.ts";
import { log } from "./logger.ts";
import type { RuntimeChannel } from "./runtime-store.ts";

const SUMMARY_MESSAGE_THRESHOLD = 20;
const SUMMARY_HISTORY_LIMIT = 50;
/** 24 messages ≈ 12 user+assistant turns retained in the prompt window. */
const RECENT_FETCH_DEFAULT = 24;
const SUMMARY_MAX_CHARS = 2400;

export interface MemoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  channel: RuntimeChannel;
  sessionId: string;
  metadata: Record<string, unknown>;
}

export interface RecentMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  agentType: string | null;
}

export interface CustomerProfile {
  id: string;
  workspaceId: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  preferences: Record<string, unknown>;
  tags: string[];
  leadScore: number;
  leadData: Record<string, unknown>;
  lastSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryContext {
  customerId: string;
  sessionId: string;
  profile: CustomerProfile;
  summary: string;
  recentMessages: RecentMessage[];
  totalMessageCount: number;
  useSummaryOnly: boolean;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function defaultSessionId(channel: RuntimeChannel, customerId: string): string {
  return `${channel}:${customerId}`;
}

function phoneFromCustomerId(customerId: string): string | null {
  const match = customerId.match(/:phone:(\d+)$/);
  return match ? match[1] : null;
}

function emptyProfile(customerId: string, workspaceId: string): CustomerProfile {
  const now = new Date().toISOString();
  return {
    id: customerId,
    workspaceId,
    phone: phoneFromCustomerId(customerId),
    email: null,
    name: null,
    preferences: {},
    tags: [],
    leadScore: 0,
    leadData: {},
    lastSummary: "",
    createdAt: now,
    updatedAt: now,
  };
}

/** Stable customer id scoped to workspace — prevents cross-customer leakage. */
export function resolveCustomerId(input: {
  workspaceId: string;
  channel: RuntimeChannel;
  collectedFields?: Record<string, string>;
  conversationId?: string;
}): string | null {
  const phone = input.collectedFields?.phone?.trim();
  const email = input.collectedFields?.email?.trim()?.toLowerCase();
  const instagramId = input.collectedFields?.instagram_id?.trim();
  const handle = input.collectedFields?.handle?.trim()?.toLowerCase();
  const sessionKey = input.collectedFields?.session_key?.trim();

  if (phone) return `${input.workspaceId}:phone:${normalizePhone(phone)}`;
  if (instagramId) return `${input.workspaceId}:ig:${instagramId}`;
  if (email) return `${input.workspaceId}:email:${email}`;
  if (handle) return `${input.workspaceId}:handle:${handle}`;
  if (input.conversationId) return `${input.workspaceId}:conv:${input.conversationId}`;
  if (sessionKey) return `${input.workspaceId}:sess:${sessionKey}`;

  return null;
}

export function resolveSessionId(input: {
  channel: RuntimeChannel;
  customerId: string;
  conversationId?: string;
}): string {
  return input.conversationId ?? defaultSessionId(input.channel, input.customerId);
}

function rowToProfile(row: Record<string, unknown>): CustomerProfile {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    phone: row.phone ? String(row.phone) : null,
    email: row.email ? String(row.email) : null,
    name: row.name ? String(row.name) : null,
    preferences: (row.preferences as Record<string, unknown>) ?? {},
    tags: (row.tags as string[]) ?? [],
    leadScore: Number(row.lead_score ?? 0),
    leadData: (row.lead_data as Record<string, unknown>) ?? {},
    lastSummary: String(row.last_summary ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function rowToRecentMessage(row: Record<string, unknown>): RecentMessage {
  const metadata = (row.metadata as Record<string, unknown>) ?? {};
  const role = String(row.role);
  return {
    role: role === "assistant" ? "assistant" : role === "system" ? "system" : "user",
    content: String(row.content),
    timestamp: new Date(String(row.timestamp)).toISOString(),
    agentType: metadata.agent ? String(metadata.agent) : null,
  };
}

async function setWorkspaceContext(workspaceId: string): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
}

export async function getCustomerProfile(
  customerId: string,
  workspaceId: string,
): Promise<CustomerProfile | null> {
  const db = getSql();
  await setWorkspaceContext(workspaceId);

  const rows = await db`
    SELECT * FROM customer_profiles
    WHERE workspace_id = ${workspaceId}
      AND (id = ${customerId} OR phone = ${customerId})
    LIMIT 1
  `;

  return rows.length ? rowToProfile(rows[0] as Record<string, unknown>) : null;
}

export async function updateCustomerProfile(
  customerId: string,
  workspaceId: string,
  updates: Partial<{
    name: string | null;
    phone: string | null;
    email: string | null;
    preferences: Record<string, unknown>;
    tags: string[];
    leadScore: number;
    leadData: Record<string, unknown>;
    lastSummary: string;
  }>,
): Promise<CustomerProfile> {
  const db = getSql();
  await setWorkspaceContext(workspaceId);

  const now = new Date().toISOString();
  const existing = await getCustomerProfile(customerId, workspaceId);
  const phone = updates.phone ?? existing?.phone ?? phoneFromCustomerId(customerId);

  await db`
    INSERT INTO customer_profiles (
      id, workspace_id, phone, email, name,
      preferences, tags, lead_score, lead_data, last_summary,
      created_at, updated_at
    ) VALUES (
      ${customerId},
      ${workspaceId},
      ${phone},
      ${updates.email ?? existing?.email ?? null},
      ${updates.name ?? existing?.name ?? null},
      ${db.json((updates.preferences ?? existing?.preferences ?? {}) as never)},
      ${db.json((updates.tags ?? existing?.tags ?? []) as never)},
      ${updates.leadScore ?? existing?.leadScore ?? 0},
      ${db.json((updates.leadData ?? existing?.leadData ?? {}) as never)},
      ${updates.lastSummary ?? existing?.lastSummary ?? ""},
      ${existing?.createdAt ?? now},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      phone = COALESCE(EXCLUDED.phone, customer_profiles.phone),
      email = COALESCE(EXCLUDED.email, customer_profiles.email),
      name = COALESCE(EXCLUDED.name, customer_profiles.name),
      preferences = COALESCE(EXCLUDED.preferences, customer_profiles.preferences),
      tags = COALESCE(EXCLUDED.tags, customer_profiles.tags),
      lead_score = COALESCE(EXCLUDED.lead_score, customer_profiles.lead_score),
      lead_data = COALESCE(EXCLUDED.lead_data, customer_profiles.lead_data),
      last_summary = COALESCE(EXCLUDED.last_summary, customer_profiles.last_summary),
      updated_at = EXCLUDED.updated_at
  `;

  const profile = await getCustomerProfile(customerId, workspaceId);
  return profile ?? emptyProfile(customerId, workspaceId);
}

async function ensureCustomerProfile(
  customerId: string,
  workspaceId: string,
): Promise<void> {
  const existing = await getCustomerProfile(customerId, workspaceId);
  if (existing) return;

  const db = getSql();
  await setWorkspaceContext(workspaceId);
  const now = new Date().toISOString();

  await db`
    INSERT INTO customer_profiles (
      id, workspace_id, phone, name, created_at, updated_at
    ) VALUES (
      ${customerId},
      ${workspaceId},
      ${phoneFromCustomerId(customerId)},
      ${null},
      ${now},
      ${now}
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function getRecentMessages(
  customerId: string,
  workspaceId: string,
  channel: RuntimeChannel,
  limit = RECENT_FETCH_DEFAULT,
): Promise<RecentMessage[]> {
  const db = getSql();
  await setWorkspaceContext(workspaceId);

  const rows = await db`
    SELECT role, content, timestamp, metadata FROM conversation_memory
    WHERE workspace_id = ${workspaceId}
      AND customer_id = ${customerId}
      AND channel = ${channel}
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `;

  return rows
    .map((row) => rowToRecentMessage(row as Record<string, unknown>))
    .reverse();
}

async function countCustomerMessages(
  customerId: string,
  workspaceId: string,
): Promise<number> {
  const db = getSql();
  await setWorkspaceContext(workspaceId);

  const rows = await db`
    SELECT COUNT(*)::int AS total FROM conversation_memory
    WHERE workspace_id = ${workspaceId}
      AND customer_id = ${customerId}
  `;

  return Number(rows[0]?.total ?? 0);
}

/**
 * Returns only the rolled long-term summary. Recent turns are injected
 * separately via `recentMessages` — rebuilding a pseudo-summary from the same
 * rows duplicated the transcript in every prompt, so we never do that here.
 */
export async function getConversationSummary(
  customerId: string,
  workspaceId: string,
): Promise<string> {
  const db = getSql();
  await setWorkspaceContext(workspaceId);

  const rows = await db`
    SELECT last_summary FROM customer_profiles
    WHERE workspace_id = ${workspaceId}
      AND (id = ${customerId} OR phone = ${customerId})
    LIMIT 1
  `;
  return rows.length ? String(rows[0].last_summary ?? "").trim() : "";
}

export async function storeMessage(
  customerId: string,
  workspaceId: string,
  channel: RuntimeChannel,
  role: MemoryMessage["role"],
  content: string,
  metadata: Record<string, unknown> = {},
  sessionId?: string,
): Promise<MemoryMessage> {
  await ensureCustomerProfile(customerId, workspaceId);

  const db = getSql();
  await setWorkspaceContext(workspaceId);

  const id = createId("mem");
  const now = new Date().toISOString();
  const resolvedSessionId = sessionId ?? defaultSessionId(channel, customerId);

  await db`
    INSERT INTO conversation_memory (
      id, workspace_id, customer_id, channel, session_id, role, content, timestamp, metadata
    ) VALUES (
      ${id},
      ${workspaceId},
      ${customerId},
      ${channel},
      ${resolvedSessionId},
      ${role},
      ${content},
      ${now},
      ${db.json(metadata as never)}
    )
  `;

  const byteLength = new TextEncoder().encode(content).length;
  log.info(`Memory stored: message length ${byteLength} bytes`, {
    workspace_id: workspaceId,
    customer_id: customerId,
    channel,
    role,
  });

  await maybeRollSummary(workspaceId, customerId, channel);

  return {
    id,
    role,
    content,
    timestamp: now,
    channel,
    sessionId: resolvedSessionId,
    metadata,
  };
}

async function maybeRollSummary(
  workspaceId: string,
  customerId: string,
  channel: RuntimeChannel,
): Promise<void> {
  const db = getSql();
  await setWorkspaceContext(workspaceId);

  const countRows = await db`
    SELECT COUNT(*)::int AS total FROM conversation_memory
    WHERE workspace_id = ${workspaceId}
      AND customer_id = ${customerId}
      AND channel = ${channel}
  `;
  const total = Number(countRows[0]?.total ?? 0);
  if (total <= SUMMARY_MESSAGE_THRESHOLD) return;

  const overflow = total - SUMMARY_MESSAGE_THRESHOLD;
  // Fetch ids together with content so we only ever delete the exact rows we
  // rolled into the summary (a second query could see different rows).
  const oldRows = await db`
    SELECT id, role, content FROM conversation_memory
    WHERE workspace_id = ${workspaceId}
      AND customer_id = ${customerId}
      AND channel = ${channel}
    ORDER BY timestamp ASC
    LIMIT ${overflow}
  `;

  if (oldRows.length === 0) return;

  const profile = await getCustomerProfile(customerId, workspaceId);
  const existing = profile?.lastSummary ?? "";
  const rolled = oldRows
    .map((row) => `${row.role}: ${String(row.content).slice(0, 160)}`)
    .join("\n");

  const nextSummary = [existing, rolled].filter(Boolean).join("\n").slice(-SUMMARY_MAX_CHARS);

  await updateCustomerProfile(customerId, workspaceId, { lastSummary: nextSummary });

  const ids = oldRows.map((row) => String(row.id));
  await db`
    DELETE FROM conversation_memory
    WHERE workspace_id = ${workspaceId}
      AND id = ANY(${ids})
  `;
}

function profileFromCollectedFields(
  _customerId: string,
  _workspaceId: string,
  collectedFields?: Record<string, string>,
  existing?: CustomerProfile | null,
): Partial<{
  name: string | null;
  phone: string | null;
  email: string | null;
}> | null {
  if (!collectedFields) return null;

  const name =
    collectedFields.name?.trim() ||
    collectedFields.full_name?.trim() ||
    null;
  const phone = collectedFields.phone?.trim() || null;
  const email = collectedFields.email?.trim()?.toLowerCase() || null;

  const mergedName = name && name !== "Website visitor" ? name : existing?.name ?? null;
  const mergedPhone = phone ?? existing?.phone ?? null;
  const mergedEmail = email ?? existing?.email ?? null;

  if (
    mergedName === existing?.name &&
    mergedPhone === existing?.phone &&
    mergedEmail === existing?.email
  ) {
    return null;
  }

  return { name: mergedName, phone: mergedPhone, email: mergedEmail };
}

/** Load memory context before agent turn — parallel for low latency. */
export async function loadMemoryContext(input: {
  workspaceId: string;
  customerId: string;
  channel: RuntimeChannel;
  sessionId: string;
  collectedFields?: Record<string, string>;
  recentLimit?: number;
}): Promise<MemoryContext> {
  const started = Date.now();

  const [profile, recentMessages, summary, totalMessageCount] = await Promise.all([
    getCustomerProfile(input.customerId, input.workspaceId),
    getRecentMessages(
      input.customerId,
      input.workspaceId,
      input.channel,
      input.recentLimit ?? RECENT_FETCH_DEFAULT,
    ),
    getConversationSummary(input.customerId, input.workspaceId),
    countCustomerMessages(input.customerId, input.workspaceId),
  ]);

  const profilePatch = profileFromCollectedFields(
    input.customerId,
    input.workspaceId,
    input.collectedFields,
    profile,
  );

  const resolvedProfile = profilePatch
    ? await updateCustomerProfile(input.customerId, input.workspaceId, profilePatch)
    : profile ?? emptyProfile(input.customerId, input.workspaceId);

  const latencyMs = Date.now() - started;
  log.info(
    `Memory retrieved: ${recentMessages.length} messages for customer ${input.customerId} in workspace ${input.workspaceId} (latency: ${latencyMs}ms)`,
    {
      workspace_id: input.workspaceId,
      customer_id: input.customerId,
      channel: input.channel,
      message_count: recentMessages.length,
      total_message_count: totalMessageCount,
      latency_ms: latencyMs,
    },
  );

  // Long histories lean on the rolled summary for older context, but the
  // most recent turns are ALWAYS kept — dropping them made the agent forget
  // what was said seconds ago once a thread crossed the history limit.
  const useSummaryOnly = totalMessageCount > SUMMARY_HISTORY_LIMIT;

  return {
    customerId: input.customerId,
    sessionId: input.sessionId,
    profile: resolvedProfile,
    summary,
    recentMessages,
    totalMessageCount,
    useSummaryOnly,
  };
}

/** Persist user + assistant turns after agent responds. */
export async function persistTurn(input: {
  workspaceId: string;
  customerId: string;
  channel: RuntimeChannel;
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
  agent?: string;
  intent?: string;
  collectedFields?: Record<string, string>;
}): Promise<void> {
  const profilePatch = profileFromCollectedFields(
    input.customerId,
    input.workspaceId,
    input.collectedFields,
    await getCustomerProfile(input.customerId, input.workspaceId),
  );
  if (profilePatch) {
    await updateCustomerProfile(input.customerId, input.workspaceId, profilePatch);
  }

  await storeMessage(
    input.customerId,
    input.workspaceId,
    input.channel,
    "user",
    input.userMessage,
    {},
    input.sessionId,
  );

  await storeMessage(
    input.customerId,
    input.workspaceId,
    input.channel,
    "assistant",
    input.assistantMessage,
    {
      agent: input.agent,
      intent: input.intent,
    },
    input.sessionId,
  );
}

export function memoryToChatHistory(
  messages: RecentMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));
}

export function formatMemoryForPrompt(context: MemoryContext, channel: RuntimeChannel): string {
  const lines: string[] = ["## Customer memory (this thread)", ""];

  if (context.profile.name) {
    lines.push(`Customer name: ${context.profile.name}`);
  }
  if (context.profile.phone) lines.push(`Phone: ${context.profile.phone}`);
  if (context.profile.email) lines.push(`Email: ${context.profile.email}`);

  const isReturning =
    context.recentMessages.length > 0 ||
    Boolean(context.summary.trim()) ||
    context.totalMessageCount > 0;
  lines.push(`Returning customer: ${isReturning ? "yes" : "no"}`);
  lines.push(`Channel: ${channel}`);

  if (context.useSummaryOnly || context.summary.trim()) {
    if (context.summary.trim()) {
      lines.push("", "Earlier conversation summary:", context.summary.trim());
    } else if (context.useSummaryOnly) {
      lines.push(
        "",
        "Earlier conversation summary:",
        "(Long history — refer to stored summary when available.)",
      );
    }
  }

  if (context.recentMessages.length > 0) {
    const transcript = context.recentMessages
      .map((message) => {
        const agentSuffix = message.agentType ? ` [${message.agentType}]` : "";
        return `${message.role}${agentSuffix}: ${message.content}`;
      })
      .join("\n");
    lines.push("", "Previous conversation with this customer:", transcript);
  }

  lines.push(
    "",
    isReturning && context.profile.name
      ? `Greet returning customer by name: "${context.profile.name}".`
      : "Use the customer's name when appropriate.",
    "Reference prior context naturally — do not repeat full history verbatim.",
  );

  return lines.join("\n");
}
