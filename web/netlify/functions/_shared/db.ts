import postgres from "postgres";
import type { AgentId } from "./agents-catalog.ts";
import { getConfig } from "./config.ts";
import { wrapClient } from "./db-client.ts";
import { dbErrorToResponse, mapDbError } from "./db-errors.ts";
import { hashVerifyToken } from "./secret-crypto.ts";
import type {
  PasswordResetRecord,
  UserRecord,
  WorkspaceAgentConfig,
  WorkspaceRecord,
  WorkspaceResources,
} from "./auth-types.ts";
import type { KnowledgeItem, KnowledgeSection } from "./knowledge-types.ts";
import type { RuntimeChannel, RuntimeConversation, RuntimeLead, RuntimeMessage } from "./runtime-store.ts";

/**
 * Database layer audit (Milestone 12):
 * - Uses `postgres` (postgres.js) with DATABASE_URL — direct Postgres, NOT @supabase/supabase-js.
 * - Server-side connection uses the Supabase Postgres role (bypasses RLS); tenant isolation is
 *   enforced in application code via workspace_id filters + set_config('app.workspace_id', …).
 * - No filesystem fallback — web/data/ is never read or written.
 * - Connection retry (3×, 1s/2s/4s), query logging, and mapped errors live in db-client/db-errors.
 */

let sql: ReturnType<typeof postgres> | null = null;
let connectionVerified = false;
let activeWorkspaceContext: string | null = null;

function getDatabaseUrl(): string {
  return getConfig().supabase.databaseUrl;
}

function getActiveWorkspaceId(): string | null {
  return activeWorkspaceContext;
}

export { dbErrorToResponse, mapDbError };

export function getSql(): ReturnType<typeof postgres> {
  if (!sql) {
    // Serverless pooling: one connection per warm function instance (a Netlify
    // function handles one request at a time, so max:1 is correct — real
    // pooling happens in Supabase's pgbouncer; point DATABASE_URL at the
    // transaction-mode pooler, port 6543, to support 1000+ concurrent
    // instances without exhausting Postgres connections).
    const raw = postgres(getDatabaseUrl(), {
      max: 1,
      idle_timeout: 20,
      max_lifetime: 60 * 5, // recycle connections so pgbouncer can rebalance
      connect_timeout: 10,
      prepare: false, // required in pgbouncer transaction mode
    });
    sql = wrapClient(raw, getActiveWorkspaceId);
  }
  return sql;
}

export async function ensureDbConnection(): Promise<ReturnType<typeof postgres>> {
  const client = getSql();
  if (connectionVerified) return client;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client`SELECT 1 AS ok`;
      connectionVerified = true;
      return client;
    } catch (error) {
      lastError = error;
      connectionVerified = false;
      sql = null;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
  }

  throw mapDbError(lastError);
}

export async function withWorkspaceContext<T>(
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const { timedOperation } = await import("./observability.ts");
  return timedOperation(
    { category: "db", operation: "workspace_context", workspaceId },
    async () => {
      const db = await ensureDbConnection();
      activeWorkspaceContext = workspaceId;
      try {
        await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
        return await fn();
      } finally {
        activeWorkspaceContext = null;
      }
    },
  );
}

function rowToWorkspace(row: Record<string, unknown>, agentConfigs: WorkspaceAgentConfig[]): WorkspaceRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    ownerId: String(row.owner_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    publicKey: String(row.public_key),
    resources: (row.resources as WorkspaceResources) ?? {
      agents: [],
      knowledge: [],
      conversations: [],
      analytics: [],
      leads: [],
    },
    agentConfigs,
  };
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    passwordHash: String(row.password_hash),
    createdAt: new Date(String(row.created_at)).toISOString(),
    workspaceIds: (row.workspace_ids as string[]) ?? [String(row.workspace_id)],
    sessionVersion: Number(row.session_version ?? 0),
  };
}

function rowToConversation(row: Record<string, unknown>, messages: RuntimeMessage[]): RuntimeConversation {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    customer: (row.customer as RuntimeConversation["customer"]) ?? { name: "Visitor" },
    channel: row.channel as RuntimeChannel,
    agentUsed: (row.agent_used ?? "reception") as RuntimeConversation["agentUsed"],
    conversationStatus: (row.status ?? "open") as RuntimeConversation["conversationStatus"],
    leadStatus: (row.lead_status ?? "new") as RuntimeConversation["leadStatus"],
    sentiment: (row.sentiment ?? "neutral") as RuntimeConversation["sentiment"],
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    preview: String(row.preview ?? ""),
    unread: Boolean(row.unread),
    intent: row.intent ? (String(row.intent) as RuntimeConversation["intent"]) : undefined,
    routingReason: row.routing_reason ? String(row.routing_reason) : undefined,
    messages,
  };
}

function rowToMessage(msg: Record<string, unknown>): RuntimeMessage {
  const meta = (msg.metadata as Record<string, unknown>) ?? {};
  return {
    id: String(msg.id),
    role: msg.role as RuntimeMessage["role"],
    agent: meta.agent as RuntimeMessage["agent"],
    content: String(msg.content),
    sentAt: new Date(String(msg.timestamp)).toISOString(),
    handoff: meta.handoff as RuntimeMessage["handoff"],
  };
}

/** Opaque keyset cursor: (updated_at, id) of the last row on the page. */
export interface PageCursor {
  u: string;
  i: string;
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): PageCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed?.u === "string" && typeof parsed?.i === "string") {
      return { u: parsed.u, i: parsed.i };
    }
  } catch {
    // malformed cursor → treat as first page
  }
  return null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

function rowToLead(row: Record<string, unknown>): RuntimeLead {
  const data = (row.lead_data as Record<string, unknown>) ?? {};
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(data.name ?? "Unknown"),
    phone: String(data.phone ?? ""),
    email: String(data.email ?? ""),
    productInterest: String(data.productInterest ?? data.product_interest ?? "General inquiry"),
    leadScore: Number(data.leadScore ?? data.lead_score ?? 35),
    assignedAgent: (data.assignedAgent ?? data.assigned_agent ?? "reception") as RuntimeLead["assignedAgent"],
    status: (row.status ?? "new") as RuntimeLead["status"],
    notes: String(data.notes ?? data.sourceMessage ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    source: String(data.source ?? "chat"),
    conversationId: data.conversationId ? String(data.conversationId) : undefined,
  };
}

async function loadAgentConfigs(workspaceId: string): Promise<WorkspaceAgentConfig[]> {
  const db = getSql();
  const rows = await db`
    SELECT id, name, is_active, config, updated_at
    FROM agents
    WHERE workspace_id = ${workspaceId}
    ORDER BY id
  `;

  return rows.map((row) => {
    const config = (row.config as Record<string, unknown>) ?? {};
    return {
      id: row.id as AgentId,
      enabled: Boolean(row.is_active),
      notes: String(config.notes ?? ""),
      lastUpdated: new Date(String(row.updated_at)).toISOString(),
    };
  });
}

export async function getWorkspace(id: string): Promise<WorkspaceRecord | null> {
  const db = getSql();
  const rows = await db`SELECT * FROM workspaces WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) return null;
  const agentConfigs = await loadAgentConfigs(id);
  return rowToWorkspace(rows[0] as Record<string, unknown>, agentConfigs);
}

export async function getWorkspaceByPublicKey(publicKey: string): Promise<WorkspaceRecord | null> {
  const db = getSql();
  const rows = await db`SELECT * FROM workspaces WHERE public_key = ${publicKey} LIMIT 1`;
  if (rows.length === 0) return null;
  const workspaceId = String(rows[0].id);
  const agentConfigs = await loadAgentConfigs(workspaceId);
  return rowToWorkspace(rows[0] as Record<string, unknown>, agentConfigs);
}

export async function listWorkspaceIds(): Promise<string[]> {
  const db = getSql();
  const rows = await db`SELECT id FROM workspaces ORDER BY created_at`;
  return rows.map((row) => String(row.id));
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const db = getSql();
  const rows = await db`SELECT * FROM users WHERE email = ${email} LIMIT 1`;
  return rows.length ? rowToUser(rows[0] as Record<string, unknown>) : null;
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const db = getSql();
  const rows = await db`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
  return rows.length ? rowToUser(rows[0] as Record<string, unknown>) : null;
}

export async function createUserWithWorkspace(input: {
  userId: string;
  email: string;
  name: string;
  passwordHash: string;
  workspaceId: string;
  companyName: string;
  publicKey: string;
  resources: WorkspaceResources;
  agentConfigs: WorkspaceAgentConfig[];
}): Promise<void> {
  const db = getSql();
  const now = new Date().toISOString();
  const slug = input.companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || input.workspaceId;

  await db.begin(async (tx) => {
    await tx`
      INSERT INTO workspaces (id, name, slug, owner_id, public_key, resources, created_at)
      VALUES (
        ${input.workspaceId},
        ${input.companyName},
        ${slug},
        ${input.userId},
        ${input.publicKey},
        ${tx.json(input.resources as never)},
        ${now}
      )
    `;

    await tx`
      INSERT INTO users (id, email, password_hash, name, workspace_id, role, workspace_ids, created_at)
      VALUES (
        ${input.userId},
        ${input.email},
        ${input.passwordHash},
        ${input.name},
        ${input.workspaceId},
        'owner',
        ${tx.json([input.workspaceId] as never)},
        ${now}
      )
    `;

    for (const agent of input.agentConfigs) {
      await tx`
        INSERT INTO agents (id, workspace_id, name, is_active, config, created_at, updated_at)
        VALUES (
          ${agent.id},
          ${input.workspaceId},
          ${agent.id},
          ${agent.enabled},
          ${tx.json({ notes: agent.notes } as never)},
          ${now},
          ${agent.lastUpdated}
        )
      `;
    }

    await tx`
      INSERT INTO workspace_users (id, workspace_id, user_id, role, created_at)
      VALUES (${`wu_${input.userId}`}, ${input.workspaceId}, ${input.userId}, 'owner', ${now})
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `;
  });
}

export async function getWorkspaceUserRole(
  workspaceId: string,
  userId: string,
): Promise<"owner" | "admin" | "staff" | null> {
  const db = getSql();
  try {
    const rows = await db`
      SELECT role FROM workspace_users
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!rows.length) return null;
    const role = String(rows[0].role);
    if (role === "owner" || role === "admin" || role === "staff") return role;
    return null;
  } catch {
    return null;
  }
}

export async function incrementUserSessionVersion(userId: string): Promise<void> {
  const db = getSql();
  try {
    await db`
      UPDATE users
      SET session_version = COALESCE(session_version, 0) + 1
      WHERE id = ${userId}
    `;
  } catch {
    // column may not exist before migration 008
  }
}

export async function updateUserPassword(userId: string, passwordHash: string): Promise<void> {
  const db = getSql();
  await db`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}`;
  await incrementUserSessionVersion(userId);
}

export async function updateUserProfile(userId: string, name: string): Promise<void> {
  const db = getSql();
  await db`UPDATE users SET name = ${name} WHERE id = ${userId}`;
}

export async function updateWorkspaceProfile(workspaceId: string, name: string): Promise<void> {
  const db = getSql();
  await db`UPDATE workspaces SET name = ${name} WHERE id = ${workspaceId}`;
}

/** Revokes the old embed/public key immediately; existing widget installs must update. */
export async function rotateWorkspacePublicKey(
  workspaceId: string,
  newPublicKey: string,
): Promise<void> {
  const db = getSql();
  await db`UPDATE workspaces SET public_key = ${newPublicKey} WHERE id = ${workspaceId}`;
}

export async function updateWorkspaceResources(
  workspaceId: string,
  resources: WorkspaceResources,
): Promise<void> {
  const db = getSql();
  await db`UPDATE workspaces SET resources = ${db.json(resources as never)} WHERE id = ${workspaceId}`;
}

export async function updateAgent(
  workspaceId: string,
  agentId: AgentId,
  patch: { enabled?: boolean; notes?: string },
): Promise<WorkspaceAgentConfig> {
  const db = getSql();
  const now = new Date().toISOString();
  const rows = await db`
    SELECT config, is_active FROM agents
    WHERE workspace_id = ${workspaceId} AND id = ${agentId}
    LIMIT 1
  `;
  if (rows.length === 0) throw new Error("AGENT_NOT_FOUND");

  const currentConfig = (rows[0].config as Record<string, unknown>) ?? {};
  const enabled = patch.enabled ?? Boolean(rows[0].is_active);
  const notes = patch.notes ?? String(currentConfig.notes ?? "");
  const config = { ...currentConfig, notes };

  await db`
    UPDATE agents
    SET is_active = ${enabled}, config = ${db.json(config as never)}, updated_at = ${now}
    WHERE workspace_id = ${workspaceId} AND id = ${agentId}
  `;

  const activeAgents = await db`
    SELECT id FROM agents WHERE workspace_id = ${workspaceId} AND is_active = true
  `;
  const workspace = await getWorkspace(workspaceId);
  if (workspace) {
    workspace.resources.agents = activeAgents.map((row) => String(row.id));
    await updateWorkspaceResources(workspaceId, workspace.resources);
  }

  return { id: agentId, enabled, notes, lastUpdated: now };
}

export async function savePasswordReset(record: PasswordResetRecord): Promise<void> {
  const db = getSql();
  await db`
    INSERT INTO password_resets (token_hash, user_id, expires_at, used)
    VALUES (${record.tokenHash}, ${record.userId}, ${record.expiresAt}, ${record.used})
    ON CONFLICT (token_hash) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      expires_at = EXCLUDED.expires_at,
      used = EXCLUDED.used
  `;
}

export async function consumePasswordReset(tokenHash: string): Promise<PasswordResetRecord | null> {
  const db = getSql();
  const rows = await db`
    SELECT * FROM password_resets WHERE token_hash = ${tokenHash} LIMIT 1
  `;
  if (rows.length === 0) return null;

  const record: PasswordResetRecord = {
    tokenHash: String(rows[0].token_hash),
    userId: String(rows[0].user_id),
    expiresAt: new Date(String(rows[0].expires_at)).toISOString(),
    used: Boolean(rows[0].used),
  };

  if (record.used || new Date(record.expiresAt).getTime() < Date.now()) return null;

  await db`UPDATE password_resets SET used = true WHERE token_hash = ${tokenHash}`;
  return { ...record, used: true };
}

export async function getConversationById(
  workspaceId: string,
  conversationId: string,
): Promise<RuntimeConversation | null> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM conversations
    WHERE id = ${conversationId} AND workspace_id = ${workspaceId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;

  const messageRows = await db`
    SELECT * FROM messages WHERE conversation_id = ${conversationId} ORDER BY timestamp ASC
  `;
  return rowToConversation(
    rows[0] as Record<string, unknown>,
    messageRows.map((msg) => rowToMessage(msg as Record<string, unknown>)),
  );
}

/** Batch-load all messages for a set of conversations in one query (no N+1). */
async function loadMessagesByConversation(
  conversationIds: string[],
): Promise<Map<string, RuntimeMessage[]>> {
  const byConversation = new Map<string, RuntimeMessage[]>();
  if (conversationIds.length === 0) return byConversation;

  const db = getSql();
  const messageRows = await db`
    SELECT * FROM messages
    WHERE conversation_id = ANY(${conversationIds})
    ORDER BY conversation_id, timestamp ASC
  `;
  for (const msg of messageRows) {
    const key = String(msg.conversation_id);
    const list = byConversation.get(key);
    const mapped = rowToMessage(msg as Record<string, unknown>);
    if (list) list.push(mapped);
    else byConversation.set(key, [mapped]);
  }
  return byConversation;
}

export async function getConversations(workspaceId: string): Promise<RuntimeConversation[]> {
  const db = getSql();
  const convRows = await db`
    SELECT * FROM conversations
    WHERE workspace_id = ${workspaceId}
    ORDER BY updated_at DESC
  `;
  const messagesByConversation = await loadMessagesByConversation(
    convRows.map((row) => String(row.id)),
  );
  return convRows.map((row) =>
    rowToConversation(
      row as Record<string, unknown>,
      messagesByConversation.get(String(row.id)) ?? [],
    ),
  );
}

export async function getConversationsPage(
  workspaceId: string,
  options: { limit?: number; cursor?: string | null; status?: string | null } = {},
): Promise<Page<RuntimeConversation>> {
  const db = getSql();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const cursor = decodeCursor(options.cursor);
  const status = options.status ?? null;

  // Keyset pagination on (updated_at DESC, id DESC) — stable under inserts,
  // backed by idx_conversations_workspace_cursor. LIMIT+1 detects hasMore.
  // The logging proxy around `db` executes template calls eagerly, so query
  // fragments can't be composed — each filter combination is a full query.
  const convRows =
    status && cursor
      ? await db`
          SELECT * FROM conversations
          WHERE workspace_id = ${workspaceId} AND status = ${status}
            AND (updated_at, id) < (${cursor.u}, ${cursor.i})
          ORDER BY updated_at DESC, id DESC
          LIMIT ${limit + 1}
        `
      : status
        ? await db`
            SELECT * FROM conversations
            WHERE workspace_id = ${workspaceId} AND status = ${status}
            ORDER BY updated_at DESC, id DESC
            LIMIT ${limit + 1}
          `
        : cursor
          ? await db`
              SELECT * FROM conversations
              WHERE workspace_id = ${workspaceId}
                AND (updated_at, id) < (${cursor.u}, ${cursor.i})
              ORDER BY updated_at DESC, id DESC
              LIMIT ${limit + 1}
            `
          : await db`
              SELECT * FROM conversations
              WHERE workspace_id = ${workspaceId}
              ORDER BY updated_at DESC, id DESC
              LIMIT ${limit + 1}
            `;

  const hasMore = convRows.length > limit;
  const pageRows = hasMore ? convRows.slice(0, limit) : [...convRows];
  const messagesByConversation = await loadMessagesByConversation(
    pageRows.map((row) => String(row.id)),
  );

  const items = pageRows.map((row) =>
    rowToConversation(
      row as Record<string, unknown>,
      messagesByConversation.get(String(row.id)) ?? [],
    ),
  );
  const last = pageRows[pageRows.length - 1];
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({ u: String(last.updated_at), i: String(last.id) })
        : null,
  };
}

export async function getConversationMessagesPage(
  workspaceId: string,
  conversationId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<Page<RuntimeMessage>> {
  const db = getSql();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const cursor = decodeCursor(options.cursor);

  // Ownership check is part of the query: join through the conversation row.
  const rows = cursor
    ? await db`
        SELECT m.* FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = ${conversationId}
          AND c.workspace_id = ${workspaceId}
          AND (m.timestamp, m.id) < (${cursor.u}, ${cursor.i})
        ORDER BY m.timestamp DESC, m.id DESC
        LIMIT ${limit + 1}
      `
    : await db`
        SELECT m.* FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = ${conversationId}
          AND c.workspace_id = ${workspaceId}
        ORDER BY m.timestamp DESC, m.id DESC
        LIMIT ${limit + 1}
      `;

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : [...rows];
  const last = pageRows[pageRows.length - 1];
  return {
    // Newest-first pages, oldest-first within the page (chat display order).
    items: pageRows.map((row) => rowToMessage(row as Record<string, unknown>)).reverse(),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({ u: String(last.timestamp), i: String(last.id) })
        : null,
  };
}

export async function saveConversation(conversation: RuntimeConversation): Promise<void> {
  const db = getSql();
  await db`
    INSERT INTO conversations (
      id, workspace_id, channel, status, agent_used, lead_status, sentiment,
      preview, unread, intent, routing_reason, customer, created_at, updated_at
    ) VALUES (
      ${conversation.id},
      ${conversation.workspaceId},
      ${conversation.channel},
      ${conversation.conversationStatus ?? "open"},
      ${conversation.agentUsed},
      ${conversation.leadStatus},
      ${conversation.sentiment},
      ${conversation.preview},
      ${conversation.unread},
      ${conversation.intent ?? null},
      ${conversation.routingReason ?? null},
      ${db.json(conversation.customer as never)},
      ${conversation.createdAt},
      ${conversation.updatedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      agent_used = EXCLUDED.agent_used,
      lead_status = EXCLUDED.lead_status,
      sentiment = EXCLUDED.sentiment,
      preview = EXCLUDED.preview,
      unread = EXCLUDED.unread,
      intent = EXCLUDED.intent,
      routing_reason = EXCLUDED.routing_reason,
      customer = EXCLUDED.customer,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function saveMessage(input: {
  id: string;
  conversationId: string;
  role: RuntimeMessage["role"];
  content: string;
  timestamp: string;
  agent?: RuntimeMessage["agent"];
  handoff?: RuntimeMessage["handoff"];
  workspaceId?: string;
}): Promise<void> {
  const db = getSql();
  const metadata: Record<string, unknown> = {};
  if (input.agent) metadata.agent = input.agent;
  if (input.handoff) metadata.handoff = input.handoff;
  await db`
    INSERT INTO messages (id, conversation_id, workspace_id, role, content, timestamp, metadata)
    VALUES (
      ${input.id},
      ${input.conversationId},
      ${input.workspaceId ?? null},
      ${input.role},
      ${input.content},
      ${input.timestamp},
      ${db.json(metadata as never)}
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function getLeads(workspaceId: string): Promise<RuntimeLead[]> {
  const db = getSql();
  const rows = await db`
    SELECT * FROM leads
    WHERE workspace_id = ${workspaceId}
    ORDER BY updated_at DESC
  `;
  return rows.map((row) => rowToLead(row as Record<string, unknown>));
}

export async function getLeadsPage(
  workspaceId: string,
  options: { limit?: number; cursor?: string | null; status?: string | null } = {},
): Promise<Page<RuntimeLead>> {
  const db = getSql();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const cursor = decodeCursor(options.cursor);
  const status = options.status ?? null;

  const rows =
    status && cursor
      ? await db`
          SELECT * FROM leads
          WHERE workspace_id = ${workspaceId} AND status = ${status}
            AND (updated_at, id) < (${cursor.u}, ${cursor.i})
          ORDER BY updated_at DESC, id DESC
          LIMIT ${limit + 1}
        `
      : status
        ? await db`
            SELECT * FROM leads
            WHERE workspace_id = ${workspaceId} AND status = ${status}
            ORDER BY updated_at DESC, id DESC
            LIMIT ${limit + 1}
          `
        : cursor
          ? await db`
              SELECT * FROM leads
              WHERE workspace_id = ${workspaceId}
                AND (updated_at, id) < (${cursor.u}, ${cursor.i})
              ORDER BY updated_at DESC, id DESC
              LIMIT ${limit + 1}
            `
          : await db`
              SELECT * FROM leads
              WHERE workspace_id = ${workspaceId}
              ORDER BY updated_at DESC, id DESC
              LIMIT ${limit + 1}
            `;

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : [...rows];
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((row) => rowToLead(row as Record<string, unknown>)),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({ u: String(last.updated_at), i: String(last.id) })
        : null,
  };
}

/**
 * Indexed lookup used during lead capture — replaces fetching every lead in
 * the workspace and scanning in JS (idx_leads_workspace_email /
 * idx_leads_workspace_conversation).
 */
export async function findLeadByEmailOrConversation(
  workspaceId: string,
  email: string | undefined,
  conversationId: string,
): Promise<RuntimeLead | null> {
  const db = getSql();
  const rows = email
    ? await db`
        SELECT * FROM leads
        WHERE workspace_id = ${workspaceId}
          AND (lead_data->>'email' = ${email} OR lead_data->>'conversationId' = ${conversationId})
        ORDER BY updated_at DESC
        LIMIT 1
      `
    : await db`
        SELECT * FROM leads
        WHERE workspace_id = ${workspaceId}
          AND lead_data->>'conversationId' = ${conversationId}
        ORDER BY updated_at DESC
        LIMIT 1
      `;
  return rows.length ? rowToLead(rows[0] as Record<string, unknown>) : null;
}

export async function upsertLead(
  workspaceId: string,
  lead: RuntimeLead,
): Promise<void> {
  const db = getSql();
  const leadData = {
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    productInterest: lead.productInterest,
    leadScore: lead.leadScore,
    assignedAgent: lead.assignedAgent,
    notes: lead.notes,
    source: lead.source,
    conversationId: lead.conversationId,
  };

  await db`
    INSERT INTO leads (id, workspace_id, status, lead_data, created_at, updated_at)
    VALUES (
      ${lead.id},
      ${workspaceId},
      ${lead.status},
      ${db.json(leadData as never)},
      ${lead.createdAt},
      ${lead.updatedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      lead_data = EXCLUDED.lead_data,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function getKnowledgeFile(
  workspaceId: string,
  filePath: string,
): Promise<string | null> {
  return withWorkspaceContext(workspaceId, async () => {
    const db = getSql();
    const rows = await db`
      SELECT content FROM knowledge_items
      WHERE workspace_id = ${workspaceId}
        AND type = 'shared_file'
        AND title = ${filePath}
      LIMIT 1
    `;
    return rows.length ? String(rows[0].content) : null;
  });
}

export async function setKnowledgeFile(
  workspaceId: string,
  filePath: string,
  content: string,
): Promise<void> {
  await withWorkspaceContext(workspaceId, async () => {
    const db = getSql();
    const now = new Date().toISOString();
    const id = `kfile_${workspaceId}_${filePath.replace(/\//g, "_")}`;

    await db`
      INSERT INTO knowledge_items (id, workspace_id, title, content, type, created_at, updated_at)
      VALUES (${id}, ${workspaceId}, ${filePath}, ${content}, 'shared_file', ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        updated_at = EXCLUDED.updated_at
    `;
  });
}

export async function getKnowledgeItems(workspaceId: string): Promise<KnowledgeItem[]> {
  return withWorkspaceContext(workspaceId, async () => {
    const db = getSql();
    const rows = await db`
      SELECT * FROM knowledge_items
      WHERE workspace_id = ${workspaceId} AND type = 'entry'
      ORDER BY title ASC
    `;

    return rows.map((row) => {
      const metadata = (row.metadata as Record<string, unknown>) ?? {};
      const section = (metadata.section ?? "company") as KnowledgeSection;
      const priceRaw = row.price;
      return {
        id: String(row.id),
        section,
        type: String(row.content_type ?? metadata.type ?? "service"),
        tags: (row.tags as string[] | null) ?? [],
        title: String(row.title),
        content: String(row.content),
        imageUrl: row.image_url ? String(row.image_url) : null,
        price: priceRaw === null || priceRaw === undefined ? null : Number(priceRaw),
        currency: row.currency ? String(row.currency) : null,
        stockStatus: row.stock_status ? String(row.stock_status) : null,
        document: metadata.document as KnowledgeItem["document"],
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      };
    });
  });
}

export async function getKnowledgeEntryById(
  workspaceId: string,
  itemId: string,
): Promise<KnowledgeItem | null> {
  return withWorkspaceContext(workspaceId, async () => {
    const db = getSql();
    const rows = await db`
      SELECT * FROM knowledge_items
      WHERE id = ${itemId} AND workspace_id = ${workspaceId} AND type = 'entry'
      LIMIT 1
    `;
    if (rows.length === 0) return null;

    const row = rows[0];
    const metadata = (row.metadata as Record<string, unknown>) ?? {};
    const section = (metadata.section ?? "company") as KnowledgeSection;
    const priceRaw = row.price;
    return {
      id: String(row.id),
      section,
      type: String(row.content_type ?? metadata.type ?? "service"),
      tags: (row.tags as string[] | null) ?? [],
      title: String(row.title),
      content: String(row.content),
      imageUrl: row.image_url ? String(row.image_url) : null,
      price: priceRaw === null || priceRaw === undefined ? null : Number(priceRaw),
      currency: row.currency ? String(row.currency) : null,
      stockStatus: row.stock_status ? String(row.stock_status) : null,
      document: metadata.document as KnowledgeItem["document"],
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  });
}

export async function saveKnowledgeItems(
  workspaceId: string,
  items: KnowledgeItem[],
): Promise<void> {
  await withWorkspaceContext(workspaceId, async () => {
    const db = getSql();
    const now = new Date().toISOString();

    await db`DELETE FROM knowledge_items WHERE workspace_id = ${workspaceId} AND type = 'entry'`;

    for (const item of items) {
      await db`
        INSERT INTO knowledge_items (
          id, workspace_id, title, content, type, content_type, tags, metadata,
          image_url, price, currency, stock_status,
          created_at, updated_at
        )
        VALUES (
          ${item.id},
          ${workspaceId},
          ${item.title},
          ${item.content},
          'entry',
          ${item.type},
          ${item.tags},
          ${db.json({ section: item.section, document: item.document ?? null } as never)},
          ${item.imageUrl ?? null},
          ${item.price ?? null},
          ${item.currency ?? null},
          ${item.stockStatus ?? null},
          ${item.createdAt ?? now},
          ${item.updatedAt ?? now}
        )
      `;
    }
  });
}

export async function getChannelConfig(workspaceId: string): Promise<{
  whatsapp?: Record<string, unknown>;
  instagram?: Record<string, unknown>;
} | null> {
  const db = getSql();
  const rows = await db`
    SELECT whatsapp, instagram FROM channel_configs WHERE workspace_id = ${workspaceId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return {
    whatsapp: rows[0].whatsapp as Record<string, unknown> | undefined,
    instagram: rows[0].instagram as Record<string, unknown> | undefined,
  };
}

export async function saveChannelConfig(
  workspaceId: string,
  config: { whatsapp?: Record<string, unknown>; instagram?: Record<string, unknown> },
): Promise<void> {
  const db = getSql();
  const now = new Date().toISOString();
  await db`
    INSERT INTO channel_configs (workspace_id, whatsapp, instagram, updated_at)
    VALUES (
      ${workspaceId},
      ${config.whatsapp ? db.json(config.whatsapp as never) : null},
      ${config.instagram ? db.json(config.instagram as never) : null},
      ${now}
    )
    ON CONFLICT (workspace_id) DO UPDATE SET
      whatsapp = COALESCE(EXCLUDED.whatsapp, channel_configs.whatsapp),
      instagram = COALESCE(EXCLUDED.instagram, channel_configs.instagram),
      updated_at = EXCLUDED.updated_at
  `;
}

export async function getChannelSession(
  workspaceId: string,
  channel: string,
  senderKey: string,
): Promise<Record<string, unknown> | null> {
  const db = getSql();
  const rows = await db`
    SELECT session_data FROM channel_sessions
    WHERE workspace_id = ${workspaceId} AND channel = ${channel} AND sender_key = ${senderKey}
    LIMIT 1
  `;
  return rows.length ? (rows[0].session_data as Record<string, unknown>) : null;
}

export async function saveChannelSession(
  workspaceId: string,
  channel: string,
  senderKey: string,
  sessionData: Record<string, unknown>,
): Promise<void> {
  const db = getSql();
  const now = new Date().toISOString();
  await db`
    INSERT INTO channel_sessions (workspace_id, channel, sender_key, session_data, updated_at)
    VALUES (${workspaceId}, ${channel}, ${senderKey}, ${db.json(sessionData as never)}, ${now})
    ON CONFLICT (workspace_id, channel, sender_key) DO UPDATE SET
      session_data = EXCLUDED.session_data,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function getBusinessProfile(workspaceId: string): Promise<Record<string, unknown> | null> {
  const db = getSql();
  const rows = await db`
    SELECT data FROM business_profiles WHERE workspace_id = ${workspaceId} LIMIT 1
  `;
  return rows.length ? (rows[0].data as Record<string, unknown>) : null;
}

export async function saveBusinessProfile(
  workspaceId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getSql();
  const now = new Date().toISOString();
  const id = `bp_${workspaceId}`;
  await db`
    INSERT INTO business_profiles (id, workspace_id, data, updated_at)
    VALUES (${id}, ${workspaceId}, ${db.json(data as never)}, ${now})
    ON CONFLICT (workspace_id) DO UPDATE SET
      data = EXCLUDED.data,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function findChannelConfigByWhatsAppPhoneNumberId(phoneNumberId: string): Promise<{
  workspaceId: string;
  whatsapp: Record<string, unknown>;
} | null> {
  const db = getSql();
  const rows = await db`
    SELECT workspace_id, whatsapp FROM channel_configs
    WHERE whatsapp->>'phoneNumberId' = ${phoneNumberId}
    LIMIT 1
  `;
  if (rows.length === 0 || !rows[0].whatsapp) return null;
  return {
    workspaceId: String(rows[0].workspace_id),
    whatsapp: rows[0].whatsapp as Record<string, unknown>,
  };
}

export async function findChannelConfigByInstagramBusinessAccountId(
  businessAccountId: string,
): Promise<{
  workspaceId: string;
  instagram: Record<string, unknown>;
} | null> {
  const db = getSql();
  const rows = await db`
    SELECT workspace_id, instagram FROM channel_configs
    WHERE instagram->>'businessAccountId' = ${businessAccountId}
    LIMIT 1
  `;
  if (rows.length === 0 || !rows[0].instagram) return null;
  return {
    workspaceId: String(rows[0].workspace_id),
    instagram: rows[0].instagram as Record<string, unknown>,
  };
}

export async function matchesAnyWhatsAppWebhookVerifyToken(verifyToken: string): Promise<boolean> {
  const db = getSql();
  const hash = hashVerifyToken(verifyToken);
  const rows = await db`
    SELECT 1 FROM channel_configs
    WHERE whatsapp->>'webhookVerifyToken' = ${verifyToken}
       OR whatsapp->>'webhookVerifyTokenHash' = ${hash}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function matchesAnyInstagramWebhookVerifyToken(verifyToken: string): Promise<boolean> {
  const db = getSql();
  const hash = hashVerifyToken(verifyToken);
  const rows = await db`
    SELECT 1 FROM channel_configs
    WHERE instagram->>'webhookVerifyToken' = ${verifyToken}
       OR instagram->>'webhookVerifyTokenHash' = ${hash}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function claimWhatsAppMessageId(input: {
  messageId: string;
  workspaceId?: string;
  phoneNumberId?: string;
  senderPhone?: string;
}): Promise<boolean> {
  const db = getSql();
  try {
    await db`
      INSERT INTO whatsapp_processed_messages (
        message_id, workspace_id, phone_number_id, sender_phone
      ) VALUES (
        ${input.messageId},
        ${input.workspaceId ?? null},
        ${input.phoneNumberId ?? null},
        ${input.senderPhone ?? null}
      )
    `;
    return true;
  } catch {
    return false;
  }
}

export async function logWhatsAppWebhookEvent(input: {
  id: string;
  workspaceId?: string;
  phoneNumberId?: string;
  messageId?: string;
  eventType?: string;
  direction?: string;
  status: string;
  payload?: Record<string, unknown>;
  errorMessage?: string;
}): Promise<void> {
  const db = getSql();
  if (input.workspaceId) {
    await db`SELECT set_config('app.workspace_id', ${input.workspaceId}, true)`;
  }
  await db`
    INSERT INTO whatsapp_webhook_logs (
      id, workspace_id, phone_number_id, message_id,
      event_type, direction, status, payload, error_message
    ) VALUES (
      ${input.id},
      ${input.workspaceId ?? null},
      ${input.phoneNumberId ?? null},
      ${input.messageId ?? null},
      ${input.eventType ?? "message"},
      ${input.direction ?? "inbound"},
      ${input.status},
      ${db.json((input.payload ?? {}) as never)},
      ${input.errorMessage ?? null}
    )
  `;
}

export interface WhatsAppWebhookLogRow {
  id: string;
  workspaceId: string | null;
  phoneNumberId: string | null;
  messageId: string | null;
  eventType: string;
  direction: string;
  status: string;
  payload: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
}

export async function getLastWhatsAppWebhookAt(workspaceId: string): Promise<string | null> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT created_at
    FROM whatsapp_webhook_logs
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows.length ? new Date(String(rows[0].created_at)).toISOString() : null;
}

export async function insertPendingMessage(input: {
  id: string;
  workspaceId: string;
  toPhone: string;
  messageText: string;
  phoneNumberId: string;
  errorMessage: string;
}): Promise<void> {
  await withWorkspaceContext(input.workspaceId, async () => {
    const db = getSql();
    await db`
      INSERT INTO pending_messages (
        id, workspace_id, channel, to_phone, message_text, phone_number_id, error_message, created_at
      ) VALUES (
        ${input.id},
        ${input.workspaceId},
        'whatsapp',
        ${input.toPhone},
        ${input.messageText},
        ${input.phoneNumberId},
        ${input.errorMessage},
        ${new Date().toISOString()}
      )
    `;
  });
}

export async function listWhatsAppWebhookLogs(
  workspaceId: string,
  limit = 50,
): Promise<WhatsAppWebhookLogRow[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT id, workspace_id, phone_number_id, message_id,
           event_type, direction, status, payload, error_message, created_at
    FROM whatsapp_webhook_logs
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: String(row.id),
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    phoneNumberId: row.phone_number_id ? String(row.phone_number_id) : null,
    messageId: row.message_id ? String(row.message_id) : null,
    eventType: String(row.event_type),
    direction: String(row.direction),
    status: String(row.status),
    payload: (row.payload as Record<string, unknown>) ?? {},
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}

export async function getConversationStatus(
  workspaceId: string,
  conversationId: string,
): Promise<string> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT status FROM conversations
    WHERE id = ${conversationId} AND workspace_id = ${workspaceId}
    LIMIT 1
  `;
  return rows.length ? String(rows[0].status) : "open";
}

export async function setConversationStatus(
  workspaceId: string,
  conversationId: string,
  status: "open" | "escalated" | "resolved",
): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  await db`
    UPDATE conversations
    SET status = ${status}, updated_at = ${new Date().toISOString()}
    WHERE id = ${conversationId} AND workspace_id = ${workspaceId}
  `;
}

export async function getWorkspaceOwnerEmail(workspaceId: string): Promise<string | null> {
  const db = getSql();
  const rows = await db`
    SELECT u.email
    FROM workspaces w
    JOIN users u ON u.id = w.owner_id
    WHERE w.id = ${workspaceId}
    LIMIT 1
  `;
  return rows.length ? String(rows[0].email) : null;
}

export async function saveAdminNotification(input: {
  id: string;
  workspaceId: string;
  type: string;
  channel: string;
  status: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${input.workspaceId}, true)`;
  await db`
    INSERT INTO admin_notifications (id, workspace_id, type, channel, status, payload)
    VALUES (
      ${input.id},
      ${input.workspaceId},
      ${input.type},
      ${input.channel},
      ${input.status},
      ${db.json(input.payload as never)}
    )
  `;
}

export async function updateCustomerLeadData(
  workspaceId: string,
  customerId: string,
  leadData: Record<string, unknown>,
  leadScore: number,
): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = new Date().toISOString();
  await db`
    UPDATE customer_profiles
    SET
      lead_data = ${db.json(leadData as never)},
      lead_score = ${leadScore},
      name = COALESCE(${leadData.name ? String(leadData.name) : null}, name),
      email = COALESCE(${leadData.email ? String(leadData.email) : null}, email),
      phone = COALESCE(${leadData.phone ? String(leadData.phone) : null}, phone),
      updated_at = ${now}
    WHERE id = ${customerId} AND workspace_id = ${workspaceId}
  `;
}

export async function updateLeadStatus(
  workspaceId: string,
  leadId: string,
  status: RuntimeLead["status"],
): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  await db`
    UPDATE leads
    SET status = ${status}, updated_at = ${new Date().toISOString()}
    WHERE id = ${leadId} AND workspace_id = ${workspaceId}
  `;
}

export async function countAvailabilitySlots(workspaceId: string): Promise<number> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT COUNT(*)::int AS total FROM availability_slots WHERE workspace_id = ${workspaceId}
  `;
  return Number(rows[0]?.total ?? 0);
}

export async function insertAvailabilitySlots(
  workspaceId: string,
  slots: Array<{
    id: string;
    workspaceId: string;
    date: string;
    startTime: string;
    endTime: string;
    isBooked: boolean;
  }>,
): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = new Date().toISOString();

  for (const slot of slots) {
    await db`
      INSERT INTO availability_slots (
        id, workspace_id, slot_date, start_time, end_time, is_booked, created_at, updated_at
      ) VALUES (
        ${slot.id},
        ${workspaceId},
        ${slot.date},
        ${slot.startTime},
        ${slot.endTime},
        ${slot.isBooked},
        ${now},
        ${now}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

function mapAvailabilityRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    date: String(row.slot_date),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    isBooked: Boolean(row.is_booked),
    customerId: row.customer_id ? String(row.customer_id) : undefined,
    customerName: row.customer_name ? String(row.customer_name) : undefined,
    customerPhone: row.customer_phone ? String(row.customer_phone) : undefined,
    customerEmail: row.customer_email ? String(row.customer_email) : undefined,
    reminderSent: Boolean(row.reminder_sent),
    notes: row.notes ? String(row.notes) : undefined,
  };
}

export async function listAvailableSlots(
  workspaceId: string,
  date?: string,
): Promise<ReturnType<typeof mapAvailabilityRow>[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;

  const rows = date
    ? await db`
        SELECT * FROM availability_slots
        WHERE workspace_id = ${workspaceId}
          AND slot_date = ${date}
          AND is_booked = false
        ORDER BY start_time ASC
        LIMIT 24
      `
    : await db`
        SELECT * FROM availability_slots
        WHERE workspace_id = ${workspaceId}
          AND is_booked = false
          AND slot_date >= CURRENT_DATE
        ORDER BY slot_date ASC, start_time ASC
        LIMIT 24
      `;

  return rows.map((row) => mapAvailabilityRow(row as Record<string, unknown>));
}

export async function findAvailabilitySlot(
  workspaceId: string,
  date: string,
  startTime: string,
): Promise<ReturnType<typeof mapAvailabilityRow> | null> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM availability_slots
    WHERE workspace_id = ${workspaceId}
      AND slot_date = ${date}
      AND start_time = ${startTime}
      AND is_booked = false
    LIMIT 1
  `;
  return rows.length ? mapAvailabilityRow(rows[0] as Record<string, unknown>) : null;
}

export async function bookAvailabilitySlot(input: {
  workspaceId: string;
  slotId: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
}): Promise<ReturnType<typeof mapAvailabilityRow> | null> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${input.workspaceId}, true)`;
  const now = new Date().toISOString();

  const rows = await db`
    UPDATE availability_slots
    SET
      is_booked = true,
      customer_id = ${input.customerId},
      customer_name = ${input.customerName ?? null},
      customer_phone = ${input.customerPhone ?? null},
      customer_email = ${input.customerEmail ?? null},
      notes = ${input.notes ?? null},
      updated_at = ${now}
    WHERE id = ${input.slotId}
      AND workspace_id = ${input.workspaceId}
      AND is_booked = false
    RETURNING *
  `;

  return rows.length ? mapAvailabilityRow(rows[0] as Record<string, unknown>) : null;
}

export async function cancelAvailabilitySlot(
  workspaceId: string,
  slotId: string,
): Promise<ReturnType<typeof mapAvailabilityRow> | null> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = new Date().toISOString();

  const rows = await db`
    UPDATE availability_slots
    SET
      is_booked = false,
      customer_id = NULL,
      customer_name = NULL,
      customer_phone = NULL,
      customer_email = NULL,
      notes = NULL,
      reminder_sent = false,
      updated_at = ${now}
    WHERE id = ${slotId}
      AND workspace_id = ${workspaceId}
      AND is_booked = true
    RETURNING *
  `;

  return rows.length ? mapAvailabilityRow(rows[0] as Record<string, unknown>) : null;
}

export async function listSlotsNeedingReminder(): Promise<
  ReturnType<typeof mapAvailabilityRow>[]
> {
  const db = getSql();
  const rows = await db`
    SELECT * FROM availability_slots
    WHERE is_booked = true
      AND reminder_sent = false
      AND slot_date = CURRENT_DATE
      AND start_time BETWEEN (CURRENT_TIME + interval '55 minutes') AND (CURRENT_TIME + interval '65 minutes')
  `;
  return rows.map((row) => mapAvailabilityRow(row as Record<string, unknown>));
}

export async function markSlotReminderSent(slotId: string): Promise<void> {
  const db = getSql();
  await db`
    UPDATE availability_slots
    SET reminder_sent = true, updated_at = ${new Date().toISOString()}
    WHERE id = ${slotId}
  `;
}

export async function logAIUsage(input: {
  id: string;
  workspaceId: string;
  provider: string;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${input.workspaceId}, true)`;
  await db`
    INSERT INTO ai_usage_logs (
      id, workspace_id, provider, model, operation,
      input_tokens, output_tokens, estimated_cost_usd
    ) VALUES (
      ${input.id},
      ${input.workspaceId},
      ${input.provider},
      ${input.model},
      ${input.operation},
      ${input.inputTokens},
      ${input.outputTokens},
      ${input.estimatedCostUsd}
    )
  `;
}

export async function getAIUsageSummary(workspaceId: string): Promise<{
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  activeProvider: string;
  byProvider: Array<{
    provider: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    requests: number;
  }>;
}> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;

  const rows = await db`
    SELECT
      provider,
      SUM(input_tokens)::int AS input_tokens,
      SUM(output_tokens)::int AS output_tokens,
      SUM(estimated_cost_usd)::float AS cost_usd,
      COUNT(*)::int AS requests
    FROM ai_usage_logs
    WHERE workspace_id = ${workspaceId}
    GROUP BY provider
    ORDER BY cost_usd DESC
  `;

  const byProvider = rows.map((row) => ({
    provider: String(row.provider),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    requests: Number(row.requests ?? 0),
  }));

  const totalInputTokens = byProvider.reduce((sum, row) => sum + row.inputTokens, 0);
  const totalOutputTokens = byProvider.reduce((sum, row) => sum + row.outputTokens, 0);
  const totalCostUsd = byProvider.reduce((sum, row) => sum + row.costUsd, 0);

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    activeProvider: getConfig().anthropic.provider,
    byProvider,
  };
}

export interface DashboardNotification {
  id: string;
  workspaceId: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function createDashboardNotification(input: {
  id: string;
  workspaceId: string;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${input.workspaceId}, true)`;
  await db`
    INSERT INTO notifications (id, workspace_id, type, title, message, link, metadata)
    VALUES (
      ${input.id},
      ${input.workspaceId},
      ${input.type},
      ${input.title},
      ${input.message},
      ${input.link ?? null},
      ${db.json((input.metadata ?? {}) as never)}
    )
  `;
}

export async function listDashboardNotifications(
  workspaceId: string,
  limit = 20,
): Promise<DashboardNotification[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT id, workspace_id, type, title, message, is_read, link, metadata, created_at
    FROM notifications
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    type: String(row.type),
    title: String(row.title),
    message: String(row.message),
    isRead: Boolean(row.is_read),
    link: row.link ? String(row.link) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}

export async function countUnreadDashboardNotifications(workspaceId: string): Promise<number> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT COUNT(*)::int AS count
    FROM notifications
    WHERE workspace_id = ${workspaceId} AND is_read = false
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function markDashboardNotificationRead(
  workspaceId: string,
  notificationId: string,
): Promise<boolean> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    UPDATE notifications
    SET is_read = true
    WHERE workspace_id = ${workspaceId} AND id = ${notificationId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function markAllDashboardNotificationsRead(workspaceId: string): Promise<number> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    UPDATE notifications
    SET is_read = true
    WHERE workspace_id = ${workspaceId} AND is_read = false
    RETURNING id
  `;
  return rows.length;
}

export interface WorkspaceBilling {
  plan: string;
  subscriptionStatus: string;
  subscriptionPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  paystackCustomerCode: string | null;
  paystackSubscriptionCode: string | null;
}

export interface UsageLogRecord {
  messagesSent: number;
  agentsUsed: string[];
  leadsCreated: number;
  appointmentsBooked: number;
  aiTokensUsed: number;
}

export interface BillingInvoiceRecord {
  id: string;
  workspaceId: string;
  stripeInvoiceId: string | null;
  amountCents: number;
  currency: string;
  status: string;
  invoicePdfUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

export async function getWorkspaceBilling(workspaceId: string): Promise<WorkspaceBilling> {
  const db = getSql();
  const rows = await db`
    SELECT plan, subscription_status, subscription_period_end,
           stripe_customer_id, stripe_subscription_id,
           paystack_customer_code, paystack_subscription_code
    FROM workspaces
    WHERE id = ${workspaceId}
    LIMIT 1
  `;
  if (rows.length === 0) {
    return {
      plan: "free",
      subscriptionStatus: "inactive",
      subscriptionPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paystackCustomerCode: null,
      paystackSubscriptionCode: null,
    };
  }
  const row = rows[0];
  return {
    plan: String(row.plan ?? "free"),
    subscriptionStatus: String(row.subscription_status ?? "inactive"),
    subscriptionPeriodEnd: row.subscription_period_end
      ? new Date(String(row.subscription_period_end)).toISOString()
      : null,
    stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
    stripeSubscriptionId: row.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
    paystackCustomerCode: row.paystack_customer_code ? String(row.paystack_customer_code) : null,
    paystackSubscriptionCode: row.paystack_subscription_code
      ? String(row.paystack_subscription_code)
      : null,
  };
}

export async function updateWorkspaceBilling(
  workspaceId: string,
  patch: Partial<WorkspaceBilling>,
): Promise<void> {
  const db = getSql();
  const current = await getWorkspaceBilling(workspaceId);
  const next = { ...current, ...patch };

  await db`
    UPDATE workspaces
    SET
      plan = ${next.plan},
      subscription_status = ${next.subscriptionStatus},
      subscription_period_end = ${next.subscriptionPeriodEnd},
      stripe_customer_id = ${next.stripeCustomerId},
      stripe_subscription_id = ${next.stripeSubscriptionId},
      paystack_customer_code = ${next.paystackCustomerCode},
      paystack_subscription_code = ${next.paystackSubscriptionCode}
    WHERE id = ${workspaceId}
  `;
}

export async function getWorkspaceIdByStripeCustomerId(
  customerId: string,
): Promise<string | null> {
  const db = getSql();
  const rows = await db`
    SELECT id FROM workspaces WHERE stripe_customer_id = ${customerId} LIMIT 1
  `;
  return rows.length ? String(rows[0].id) : null;
}

export async function getWorkspaceIdByStripeSubscriptionId(
  subscriptionId: string,
): Promise<string | null> {
  const db = getSql();
  const rows = await db`
    SELECT id FROM workspaces WHERE stripe_subscription_id = ${subscriptionId} LIMIT 1
  `;
  return rows.length ? String(rows[0].id) : null;
}

export async function getWorkspaceIdByPaystackCustomerCode(
  customerCode: string,
): Promise<string | null> {
  const db = getSql();
  const rows = await db`
    SELECT id FROM workspaces WHERE paystack_customer_code = ${customerCode} LIMIT 1
  `;
  return rows.length ? String(rows[0].id) : null;
}

export async function getWorkspaceIdByPaystackSubscriptionCode(
  subscriptionCode: string,
): Promise<string | null> {
  const db = getSql();
  const rows = await db`
    SELECT id FROM workspaces WHERE paystack_subscription_code = ${subscriptionCode} LIMIT 1
  `;
  return rows.length ? String(rows[0].id) : null;
}

export async function getUsageLog(
  workspaceId: string,
  month: string,
): Promise<UsageLogRecord | null> {
  return withWorkspaceContext(workspaceId, async () => {
    const db = getSql();
    const rows = await db`
      SELECT messages_sent, agents_used, leads_created, appointments_booked, ai_tokens_used
      FROM usage_logs
      WHERE workspace_id = ${workspaceId} AND month = ${month}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return {
      messagesSent: Number(rows[0].messages_sent ?? 0),
      agentsUsed: (rows[0].agents_used as string[]) ?? [],
      leadsCreated: Number(rows[0].leads_created ?? 0),
      appointmentsBooked: Number(rows[0].appointments_booked ?? 0),
      aiTokensUsed: Number(rows[0].ai_tokens_used ?? 0),
    };
  });
}

export async function incrementUsageLog(
  workspaceId: string,
  month: string,
  agentId: string,
): Promise<void> {
  await withWorkspaceContext(workspaceId, async () => {
    const db = getSql();
    const now = new Date().toISOString();

    // Atomic increment in the UPDATE clause — the old read-then-write pattern
    // lost counts when two messages landed concurrently, undercounting
    // billable usage.
    await db`
      INSERT INTO usage_logs (
        workspace_id, month, messages_sent, agents_used,
        leads_created, appointments_booked, ai_tokens_used, updated_at
      )
      VALUES (
        ${workspaceId}, ${month}, 1, ${db.json([agentId] as never)},
        0, 0, 0, ${now}
      )
      ON CONFLICT (workspace_id, month) DO UPDATE SET
        messages_sent = usage_logs.messages_sent + 1,
        agents_used = CASE
          WHEN usage_logs.agents_used @> ${db.json([agentId] as never)}
            THEN usage_logs.agents_used
          ELSE usage_logs.agents_used || ${db.json([agentId] as never)}
        END,
        updated_at = ${now}
    `;
  });
}

async function incrementUsageCounter(
  workspaceId: string,
  month: string,
  field: "leads_created" | "appointments_booked" | "ai_tokens_used",
  amount = 1,
): Promise<void> {
  await withWorkspaceContext(workspaceId, async () => {
    const db = getSql();
    const now = new Date().toISOString();
    const leadDelta = field === "leads_created" ? amount : 0;
    const appointmentDelta = field === "appointments_booked" ? amount : 0;
    const tokenDelta = field === "ai_tokens_used" ? amount : 0;

    // Atomic increments — see incrementUsageLog for why.
    await db`
      INSERT INTO usage_logs (
        workspace_id, month, messages_sent, agents_used,
        leads_created, appointments_booked, ai_tokens_used, updated_at
      )
      VALUES (
        ${workspaceId}, ${month}, 0, ${db.json([] as never)},
        ${leadDelta}, ${appointmentDelta}, ${tokenDelta}, ${now}
      )
      ON CONFLICT (workspace_id, month) DO UPDATE SET
        leads_created = usage_logs.leads_created + ${leadDelta},
        appointments_booked = usage_logs.appointments_booked + ${appointmentDelta},
        ai_tokens_used = usage_logs.ai_tokens_used + ${tokenDelta},
        updated_at = ${now}
    `;
  });
}

export async function incrementLeadUsage(workspaceId: string, month: string): Promise<void> {
  await incrementUsageCounter(workspaceId, month, "leads_created");
}

export async function incrementAppointmentUsage(
  workspaceId: string,
  month: string,
): Promise<void> {
  await incrementUsageCounter(workspaceId, month, "appointments_booked");
}

export async function incrementAiTokenUsage(
  workspaceId: string,
  month: string,
  tokens: number,
): Promise<void> {
  if (tokens <= 0) return;
  await incrementUsageCounter(workspaceId, month, "ai_tokens_used", tokens);
}

export async function listBillingInvoices(workspaceId: string): Promise<BillingInvoiceRecord[]> {
  return withWorkspaceContext(workspaceId, async () => {
    const db = getSql();
    const rows = await db`
      SELECT *
      FROM billing_invoices
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at DESC
      LIMIT 24
    `;
    return rows.map((row) => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      stripeInvoiceId: row.stripe_invoice_id ? String(row.stripe_invoice_id) : null,
      amountCents: Number(row.amount_cents ?? 0),
      currency: String(row.currency ?? "usd"),
      status: String(row.status),
      invoicePdfUrl: row.invoice_pdf_url ? String(row.invoice_pdf_url) : null,
      periodStart: row.period_start ? new Date(String(row.period_start)).toISOString() : null,
      periodEnd: row.period_end ? new Date(String(row.period_end)).toISOString() : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  });
}

export async function upsertBillingInvoice(input: {
  id: string;
  workspaceId: string;
  stripeInvoiceId: string;
  amountCents: number;
  currency: string;
  status: string;
  invoicePdfUrl?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}): Promise<void> {
  await withWorkspaceContext(input.workspaceId, async () => {
    const db = getSql();
    await db`
      INSERT INTO billing_invoices (
        id, workspace_id, stripe_invoice_id, amount_cents, currency, status,
        invoice_pdf_url, period_start, period_end
      )
      VALUES (
        ${input.id},
        ${input.workspaceId},
        ${input.stripeInvoiceId},
        ${input.amountCents},
        ${input.currency},
        ${input.status},
        ${input.invoicePdfUrl ?? null},
        ${input.periodStart ?? null},
        ${input.periodEnd ?? null}
      )
      ON CONFLICT (stripe_invoice_id) DO UPDATE SET
        status = EXCLUDED.status,
        invoice_pdf_url = EXCLUDED.invoice_pdf_url,
        amount_cents = EXCLUDED.amount_cents
    `;
  });
}

export async function isStripeWebhookEventProcessed(eventId: string): Promise<boolean> {
  const db = getSql();
  const rows = await db`
    SELECT 1 FROM stripe_webhook_events WHERE event_id = ${eventId} LIMIT 1
  `;
  return rows.length > 0;
}

export async function recordStripeWebhookEvent(
  eventId: string,
  eventType: string,
): Promise<void> {
  const db = getSql();
  await db`
    INSERT INTO stripe_webhook_events (event_id, event_type)
    VALUES (${eventId}, ${eventType})
    ON CONFLICT (event_id) DO NOTHING
  `;
}

export async function getPlatformMrrCents(): Promise<number> {
  const db = getSql();
  const rows = await db`
    SELECT plan, COUNT(*)::int AS count
    FROM workspaces
    WHERE subscription_status IN ('active', 'trialing', 'canceling')
    GROUP BY plan
  `;

  const priceMap: Record<string, number> = {
    starter: 900,
    growth: 2900,
    pro: 7900,
  };

  return rows.reduce((sum, row) => {
    const plan = String(row.plan);
    const count = Number(row.count ?? 0);
    return sum + (priceMap[plan] ?? 0) * count;
  }, 0);
}

export async function recordRequestLog(input: {
  id: string;
  workspaceId?: string | null;
  userId?: string | null;
  endpoint: string;
  method: string;
  status: number;
  latencyMs: number;
  isError: boolean;
}): Promise<void> {
  const db = getSql();
  await db`
    INSERT INTO observability_request_logs (
      id, workspace_id, user_id, endpoint, method, status, latency_ms, is_error
    )
    VALUES (
      ${input.id},
      ${input.workspaceId ?? null},
      ${input.userId ?? null},
      ${input.endpoint},
      ${input.method},
      ${input.status},
      ${input.latencyMs},
      ${input.isError}
    )
  `;
}

export async function recordPerformanceLog(input: {
  id: string;
  workspaceId?: string | null;
  category: string;
  operation: string;
  durationMs: number;
  success: boolean;
}): Promise<void> {
  const db = getSql();
  await db`
    INSERT INTO observability_performance_logs (
      id, workspace_id, category, operation, duration_ms, success
    )
    VALUES (
      ${input.id},
      ${input.workspaceId ?? null},
      ${input.category},
      ${input.operation},
      ${input.durationMs},
      ${input.success}
    )
  `;
}

export async function getObservabilityHealthSummary(
  hours = 24,
  workspaceId?: string,
): Promise<{
  requestCount: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  ai: { count: number; avgMs: number; p95Ms: number };
  db: { count: number; avgMs: number; p95Ms: number };
  webhook: { count: number; avgMs: number; failures: number };
}> {
  const db = getSql();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // With a workspaceId the summary is tenant-scoped (workspace dashboard);
  // without one it is platform-wide and callers must be platform-admin-gated.
  const requestRows = workspaceId
    ? await db`
        SELECT latency_ms, is_error
        FROM observability_request_logs
        WHERE created_at >= ${since} AND workspace_id = ${workspaceId}
        ORDER BY latency_ms ASC
      `
    : await db`
        SELECT latency_ms, is_error
        FROM observability_request_logs
        WHERE created_at >= ${since}
        ORDER BY latency_ms ASC
      `;

  const latencies = requestRows.map((row) => Number(row.latency_ms ?? 0));
  const requestCount = latencies.length;
  const errorCount = requestRows.filter((row) => Boolean(row.is_error)).length;
  const avgLatencyMs =
    requestCount === 0
      ? 0
      : Math.round(latencies.reduce((sum, value) => sum + value, 0) / requestCount);
  const p95LatencyMs =
    requestCount === 0 ? 0 : latencies[Math.min(requestCount - 1, Math.floor(requestCount * 0.95))] ?? 0;

  async function perfSummary(category: string) {
    const rows = workspaceId
      ? await db`
          SELECT duration_ms, success
          FROM observability_performance_logs
          WHERE created_at >= ${since} AND category = ${category} AND workspace_id = ${workspaceId}
          ORDER BY duration_ms ASC
        `
      : await db`
          SELECT duration_ms, success
          FROM observability_performance_logs
          WHERE created_at >= ${since} AND category = ${category}
          ORDER BY duration_ms ASC
        `;
    const durations = rows.map((row) => Number(row.duration_ms ?? 0));
    const count = durations.length;
    const avgMs =
      count === 0 ? 0 : Math.round(durations.reduce((sum, value) => sum + value, 0) / count);
    const p95Ms = count === 0 ? 0 : durations[Math.min(count - 1, Math.floor(count * 0.95))] ?? 0;
    const failures = rows.filter((row) => row.success === false).length;
    return { count, avgMs, p95Ms, failures };
  }

  const ai = await perfSummary("ai");
  const dbPerf = await perfSummary("db");
  const webhook = await perfSummary("webhook");

  return {
    requestCount,
    errorCount,
    errorRate: requestCount === 0 ? 0 : Math.round((errorCount / requestCount) * 1000) / 10,
    avgLatencyMs,
    p95LatencyMs,
    ai: { count: ai.count, avgMs: ai.avgMs, p95Ms: ai.p95Ms },
    db: { count: dbPerf.count, avgMs: dbPerf.avgMs, p95Ms: dbPerf.p95Ms },
    webhook: { count: webhook.count, avgMs: webhook.avgMs, failures: webhook.failures },
  };
}

export async function countRecentWebhookFailures(hours = 1): Promise<number> {
  const db = getSql();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await db`
    SELECT COUNT(*)::int AS count
    FROM observability_performance_logs
    WHERE category = 'webhook' AND success = false AND created_at >= ${since}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function saveObservabilityAlert(input: {
  id: string;
  alertType: string;
  message: string;
}): Promise<void> {
  const db = getSql();
  await db`
    INSERT INTO observability_alerts (id, alert_type, message)
    VALUES (${input.id}, ${input.alertType}, ${input.message})
  `;
}

export async function wasAlertSentRecently(
  alertType: string,
  withinMinutes: number,
): Promise<boolean> {
  const db = getSql();
  const since = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
  const rows = await db`
    SELECT 1 FROM observability_alerts
    WHERE alert_type = ${alertType} AND created_at >= ${since}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function recordPerformanceMetric(input: {
  id: string;
  workspaceId?: string | null;
  date: string;
  metricName: string;
  value: number;
  unit?: string;
}): Promise<void> {
  const db = getSql();
  try {
    await db`
      INSERT INTO performance_metrics (id, workspace_id, date, metric_name, value, unit)
      VALUES (
        ${input.id},
        ${input.workspaceId ?? null},
        ${input.date},
        ${input.metricName},
        ${input.value},
        ${input.unit ?? "ms"}
      )
    `;
  } catch {
    // Best-effort when migration not applied.
  }
}

export async function countWorkspaces(): Promise<number> {
  const db = getSql();
  const rows = await db`SELECT COUNT(*)::int AS count FROM workspaces`;
  return Number(rows[0]?.count ?? 0);
}

export async function countActiveConversationsToday(): Promise<number> {
  const db = getSql();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const rows = await db`
    SELECT COUNT(*)::int AS count
    FROM conversations
    WHERE updated_at >= ${since.toISOString()} AND status IN ('open', 'escalated')
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function getTopErrors(hours = 24, limit = 5): Promise<
  Array<{ endpoint: string; count: number; lastSeen: string }>
> {
  const db = getSql();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await db`
    SELECT endpoint, COUNT(*)::int AS count, MAX(created_at) AS last_seen
    FROM observability_request_logs
    WHERE created_at >= ${since} AND is_error = true
    GROUP BY endpoint
    ORDER BY count DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    endpoint: String(row.endpoint),
    count: Number(row.count ?? 0),
    lastSeen: new Date(String(row.last_seen)).toISOString(),
  }));
}

export async function getWebhookSuccessRate(hours = 24): Promise<number> {
  const db = getSql();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await db`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE success = true)::int AS successes
    FROM observability_performance_logs
    WHERE created_at >= ${since} AND category = 'webhook'
  `;
  const total = Number(rows[0]?.total ?? 0);
  const successes = Number(rows[0]?.successes ?? 0);
  if (total === 0) return 100;
  return Math.round((successes / total) * 1000) / 10;
}

export async function getAdminHealthDashboard(hours = 24): Promise<{
  totalWorkspaces: number;
  activeConversationsToday: number;
  avgAiLatencyMs: number;
  errorRate: number;
  webhookSuccessRate: number;
  topErrors: Array<{ endpoint: string; count: number; lastSeen: string }>;
  summary: Awaited<ReturnType<typeof getObservabilityHealthSummary>>;
}> {
  const summary = await getObservabilityHealthSummary(hours);
  return {
    totalWorkspaces: await countWorkspaces(),
    activeConversationsToday: await countActiveConversationsToday(),
    avgAiLatencyMs: summary.ai.avgMs,
    errorRate: summary.errorRate,
    webhookSuccessRate: await getWebhookSuccessRate(hours),
    topErrors: await getTopErrors(hours),
    summary,
  };
}

export async function importAuthStore(data: {
  usersById: Record<string, UserRecord>;
  usersByEmail: Record<string, string>;
  workspacesById: Record<string, WorkspaceRecord>;
  resetsByTokenHash: Record<string, PasswordResetRecord>;
}): Promise<void> {
  for (const workspace of Object.values(data.workspacesById)) {
    const existing = await getWorkspace(workspace.id);
    if (existing) continue;

    await createUserWithWorkspace({
      userId: workspace.ownerId,
      email: data.usersById[workspace.ownerId]?.email ?? `${workspace.id}@import.local`,
      name: data.usersById[workspace.ownerId]?.name ?? "Imported User",
      passwordHash: data.usersById[workspace.ownerId]?.passwordHash ?? "imported",
      workspaceId: workspace.id,
      companyName: workspace.name,
      publicKey: workspace.publicKey,
      resources: workspace.resources,
      agentConfigs: workspace.agentConfigs,
    });
  }

  for (const reset of Object.values(data.resetsByTokenHash)) {
    await savePasswordReset(reset);
  }
}

export interface DbConnectivityTestResult {
  success: boolean;
  operations: {
    write: "ok" | "fail";
    read: "ok" | "fail";
    delete: "ok" | "fail";
  };
  error?: string;
  latency_ms: number;
  workspace_id?: string;
}

export async function runDbConnectivityTest(): Promise<DbConnectivityTestResult> {
  const started = Date.now();
  const testId = `ws_db_test_${Date.now()}`;
  const publicKey = `pk_db_test_${Date.now()}`;
  const operations: DbConnectivityTestResult["operations"] = {
    write: "fail",
    read: "fail",
    delete: "fail",
  };
  let lastError: string | undefined;

  try {
    const db = await ensureDbConnection();
    const now = new Date().toISOString();

    try {
      await db`
        INSERT INTO workspaces (id, name, owner_id, public_key, created_at)
        VALUES (
          ${testId},
          ${"DB Connectivity Test"},
          ${"usr_db_test"},
          ${publicKey},
          ${now}
        )
      `;
      operations.write = "ok";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "write failed";
      throw error;
    }

    try {
      const rows = await db`
        SELECT id, name FROM workspaces WHERE id = ${testId} LIMIT 1
      `;
      operations.read = rows.length > 0 ? "ok" : "fail";
      if (rows.length === 0) lastError = "read returned no rows";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "read failed";
      throw error;
    }

    try {
      await db`DELETE FROM workspaces WHERE id = ${testId}`;
      operations.delete = "ok";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "delete failed";
      throw error;
    }

    return {
      success: operations.write === "ok" && operations.read === "ok" && operations.delete === "ok",
      operations,
      latency_ms: Date.now() - started,
      workspace_id: testId,
    };
  } catch (error) {
    try {
      const db = getSql();
      await db`DELETE FROM workspaces WHERE id = ${testId}`;
      if (operations.delete === "fail") operations.delete = "ok";
    } catch {
      // Best-effort cleanup of diagnostic row.
    }

    return {
      success: false,
      operations,
      error: lastError ?? (error instanceof Error ? error.message : "Database test failed"),
      latency_ms: Date.now() - started,
      workspace_id: testId,
    };
  }
}

export interface MarketingInsightRecord {
  id: string;
  workspaceId: string;
  type: "competitor_pricing" | "industry_news";
  sourceUrl: string;
  title: string | null;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface MarketingCampaignRecord {
  id: string;
  workspaceId: string;
  name: string;
  productId: string | null;
  status: "draft" | "active" | "completed";
  leadMagnet: Record<string, unknown> | null;
  landingCopy: Record<string, unknown> | null;
  emailSequence: Record<string, unknown> | null;
  leadsGenerated: number;
  createdAt: string;
  updatedAt: string;
}

function rowToMarketingInsight(row: Record<string, unknown>): MarketingInsightRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    type: row.type as MarketingInsightRecord["type"],
    sourceUrl: String(row.source_url),
    title: row.title ? String(row.title) : null,
    summary: String(row.summary),
    data: (row.data as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function rowToMarketingCampaign(row: Record<string, unknown>): MarketingCampaignRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    productId: row.product_id ? String(row.product_id) : null,
    status: (row.status ?? "draft") as MarketingCampaignRecord["status"],
    leadMagnet: (row.lead_magnet as Record<string, unknown>) ?? null,
    landingCopy: (row.landing_copy as Record<string, unknown>) ?? null,
    emailSequence: (row.email_sequence as Record<string, unknown>) ?? null,
    leadsGenerated: Number(row.leads_generated ?? 0),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function saveMarketingInsight(
  workspaceId: string,
  insight: Omit<MarketingInsightRecord, "workspaceId" | "createdAt"> & { createdAt?: string },
): Promise<MarketingInsightRecord> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = insight.createdAt ?? new Date().toISOString();

  await db`
    INSERT INTO marketing_insights (id, workspace_id, type, source_url, title, summary, data, created_at)
    VALUES (
      ${insight.id},
      ${workspaceId},
      ${insight.type},
      ${insight.sourceUrl},
      ${insight.title},
      ${insight.summary},
      ${db.json(insight.data as never)},
      ${now}
    )
  `;

  return {
    ...insight,
    workspaceId,
    createdAt: now,
  };
}

export async function listMarketingInsights(
  workspaceId: string,
  limit = 20,
): Promise<MarketingInsightRecord[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM marketing_insights
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => rowToMarketingInsight(row as Record<string, unknown>));
}

export async function saveMarketingCampaign(
  workspaceId: string,
  campaign: Omit<MarketingCampaignRecord, "workspaceId" | "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  },
): Promise<MarketingCampaignRecord> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = campaign.updatedAt ?? new Date().toISOString();
  const createdAt = campaign.createdAt ?? now;

  await db`
    INSERT INTO marketing_campaigns (
      id, workspace_id, name, product_id, status,
      lead_magnet, landing_copy, email_sequence, leads_generated,
      created_at, updated_at
    ) VALUES (
      ${campaign.id},
      ${workspaceId},
      ${campaign.name},
      ${campaign.productId},
      ${campaign.status},
      ${campaign.leadMagnet ? db.json(campaign.leadMagnet as never) : null},
      ${campaign.landingCopy ? db.json(campaign.landingCopy as never) : null},
      ${campaign.emailSequence ? db.json(campaign.emailSequence as never) : null},
      ${campaign.leadsGenerated},
      ${createdAt},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      product_id = EXCLUDED.product_id,
      status = EXCLUDED.status,
      lead_magnet = EXCLUDED.lead_magnet,
      landing_copy = EXCLUDED.landing_copy,
      email_sequence = EXCLUDED.email_sequence,
      leads_generated = EXCLUDED.leads_generated,
      updated_at = EXCLUDED.updated_at
  `;

  return {
    ...campaign,
    workspaceId,
    createdAt,
    updatedAt: now,
  };
}

export async function listMarketingCampaigns(
  workspaceId: string,
  limit = 50,
): Promise<MarketingCampaignRecord[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM marketing_campaigns
    WHERE workspace_id = ${workspaceId}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => rowToMarketingCampaign(row as Record<string, unknown>));
}

export async function getMarketingStats(workspaceId: string): Promise<{
  leadMagnetsCreated: number;
  campaignsActive: number;
  leadsGenerated: number;
  competitorInsights: number;
}> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;

  const [campaignRows, insightRows, leadRows] = await Promise.all([
    db`
      SELECT
        COUNT(*) FILTER (WHERE lead_magnet IS NOT NULL)::int AS lead_magnets,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_campaigns
      FROM marketing_campaigns
      WHERE workspace_id = ${workspaceId}
    `,
    db`
      SELECT COUNT(*)::int AS competitor_insights
      FROM marketing_insights
      WHERE workspace_id = ${workspaceId}
        AND type = 'competitor_pricing'
    `,
    db`
      SELECT COUNT(*)::int AS leads_generated
      FROM leads
      WHERE workspace_id = ${workspaceId}
    `,
  ]);

  return {
    leadMagnetsCreated: Number(campaignRows[0]?.lead_magnets ?? 0),
    campaignsActive: Number(campaignRows[0]?.active_campaigns ?? 0),
    leadsGenerated: Number(leadRows[0]?.leads_generated ?? 0),
    competitorInsights: Number(insightRows[0]?.competitor_insights ?? 0),
  };
}

export async function listQualifiedLeads(workspaceId: string): Promise<RuntimeLead[]> {
  const leads = await getLeads(workspaceId);
  return leads.filter((lead) =>
    ["qualified", "proposal", "won"].includes(lead.status),
  );
}

export async function countHandoffsInSession(
  workspaceId: string,
  customerId: string,
  sessionId: string,
): Promise<number> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT COUNT(*)::int AS total
    FROM conversation_memory
    WHERE workspace_id = ${workspaceId}
      AND customer_id = ${customerId}
      AND session_id = ${sessionId}
      AND metadata->>'handoff' = 'true'
  `;
  return Number(rows[0]?.total ?? 0);
}

// ─── M25: BI Agent ───────────────────────────────────────────────────────────

export interface CompetitorDataRecord {
  id: string;
  workspaceId: string;
  sourceUrl: string;
  mentions: string[];
  summary: string;
  scrapedAt: string;
  createdAt: string;
}

export interface BusinessInsightRecord {
  id: string;
  workspaceId: string;
  type: "swot" | "growth_report" | "opportunity" | "risk";
  title: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}

function rowToCompetitorData(row: Record<string, unknown>): CompetitorDataRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sourceUrl: String(row.source_url),
    mentions: (row.mentions as string[]) ?? [],
    summary: String(row.summary),
    scrapedAt: new Date(String(row.scraped_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function rowToBusinessInsight(row: Record<string, unknown>): BusinessInsightRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    type: row.type as BusinessInsightRecord["type"],
    title: String(row.title),
    summary: String(row.summary),
    data: (row.data as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export async function saveCompetitorData(
  workspaceId: string,
  record: Omit<CompetitorDataRecord, "workspaceId" | "createdAt"> & { createdAt?: string },
): Promise<CompetitorDataRecord> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = record.createdAt ?? new Date().toISOString();

  await db`
    INSERT INTO competitor_data (id, workspace_id, source_url, mentions, summary, scraped_at, created_at)
    VALUES (
      ${record.id},
      ${workspaceId},
      ${record.sourceUrl},
      ${db.json(record.mentions as never)},
      ${record.summary},
      ${record.scrapedAt},
      ${now}
    )
  `;

  return { ...record, workspaceId, createdAt: now };
}

export async function listCompetitorData(
  workspaceId: string,
  limit = 50,
): Promise<CompetitorDataRecord[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM competitor_data
    WHERE workspace_id = ${workspaceId}
    ORDER BY scraped_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => rowToCompetitorData(row as Record<string, unknown>));
}

export async function getLatestCompetitorSnapshots(
  workspaceId: string,
  sourceUrl: string,
  limit = 2,
): Promise<CompetitorDataRecord[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM competitor_data
    WHERE workspace_id = ${workspaceId} AND source_url = ${sourceUrl}
    ORDER BY scraped_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => rowToCompetitorData(row as Record<string, unknown>));
}

export async function saveBusinessInsight(
  workspaceId: string,
  insight: Omit<BusinessInsightRecord, "workspaceId" | "createdAt"> & { createdAt?: string },
): Promise<BusinessInsightRecord> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = insight.createdAt ?? new Date().toISOString();

  await db`
    INSERT INTO business_insights (id, workspace_id, type, title, summary, data, created_at)
    VALUES (
      ${insight.id},
      ${workspaceId},
      ${insight.type},
      ${insight.title},
      ${insight.summary},
      ${db.json(insight.data as never)},
      ${now}
    )
  `;

  return { ...insight, workspaceId, createdAt: now };
}

export async function listBusinessInsights(
  workspaceId: string,
  type?: BusinessInsightRecord["type"],
  limit = 20,
): Promise<BusinessInsightRecord[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = type
    ? await db`
        SELECT * FROM business_insights
        WHERE workspace_id = ${workspaceId} AND type = ${type}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await db`
        SELECT * FROM business_insights
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
  return rows.map((row) => rowToBusinessInsight(row as Record<string, unknown>));
}

export async function getBIMetrics(workspaceId: string): Promise<{
  conversationCount: number;
  leadCount: number;
  qualifiedLeads: number;
  appointmentCount: number;
  negativeConversations: number;
  escalatedConversations: number;
  lostLeads: number;
  complaintMessages: number;
}> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;

  const [convRows, leadRows, slotRows, msgRows] = await Promise.all([
    db`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE sentiment = 'negative')::int AS negative,
        COUNT(*) FILTER (WHERE status = 'escalated')::int AS escalated
      FROM conversations
      WHERE workspace_id = ${workspaceId}
    `,
    db`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'qualified')::int AS qualified,
        COUNT(*) FILTER (WHERE status = 'lost')::int AS lost
      FROM leads
      WHERE workspace_id = ${workspaceId}
    `,
    db`
      SELECT COUNT(*)::int AS booked
      FROM availability_slots
      WHERE workspace_id = ${workspaceId} AND is_booked = true
    `,
    db`
      SELECT COUNT(*)::int AS complaints
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.workspace_id = ${workspaceId}
        AND m.role = 'user'
        AND (
          m.content ILIKE '%complaint%'
          OR m.content ILIKE '%unhappy%'
          OR m.content ILIKE '%terrible%'
          OR m.content ILIKE '%refund%'
        )
    `,
  ]);

  return {
    conversationCount: Number(convRows[0]?.total ?? 0),
    leadCount: Number(leadRows[0]?.total ?? 0),
    qualifiedLeads: Number(leadRows[0]?.qualified ?? 0),
    appointmentCount: Number(slotRows[0]?.booked ?? 0),
    negativeConversations: Number(convRows[0]?.negative ?? 0),
    escalatedConversations: Number(convRows[0]?.escalated ?? 0),
    lostLeads: Number(leadRows[0]?.lost ?? 0),
    complaintMessages: Number(msgRows[0]?.complaints ?? 0),
  };
}

export async function getTopCustomerTopics(
  workspaceId: string,
  limit = 20,
): Promise<Array<{ topic: string; count: number }>> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT LOWER(TRIM(m.content)) AS topic, COUNT(*)::int AS count
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.workspace_id = ${workspaceId}
      AND m.role = 'user'
      AND LENGTH(TRIM(m.content)) > 10
    GROUP BY LOWER(TRIM(m.content))
    ORDER BY count DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    topic: String(row.topic).slice(0, 120),
    count: Number(row.count ?? 0),
  }));
}

// ─── M26: Workflow Engine ────────────────────────────────────────────────────

export type WorkflowTriggerType =
  | "new_lead"
  | "appointment_booked"
  | "conversation_escalated"
  | "subscription_expired"
  | "scheduled";

export type WorkflowStepType =
  | "send_email"
  | "send_whatsapp"
  | "update_lead_status"
  | "assign_to_agent"
  | "wait"
  | "condition";

export interface WorkflowStep {
  type: WorkflowStepType;
  config: Record<string, unknown>;
}

export interface WorkflowRecord {
  id: string;
  workspaceId: string;
  name: string;
  triggers: WorkflowTriggerType[];
  steps: WorkflowStep[];
  status: "active" | "paused";
  isPrebuilt: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecutionRecord {
  id: string;
  workspaceId: string;
  workflowId: string;
  status: "pending" | "running" | "waiting" | "completed" | "failed";
  currentStepIndex: number;
  context: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

function rowToWorkflow(row: Record<string, unknown>): WorkflowRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    triggers: (row.triggers as WorkflowTriggerType[]) ?? [],
    steps: (row.steps as WorkflowStep[]) ?? [],
    status: (row.status ?? "active") as WorkflowRecord["status"],
    isPrebuilt: Boolean(row.is_prebuilt),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function rowToWorkflowExecution(row: Record<string, unknown>): WorkflowExecutionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    workflowId: String(row.workflow_id),
    status: (row.status ?? "pending") as WorkflowExecutionRecord["status"],
    currentStepIndex: Number(row.current_step_index ?? 0),
    context: (row.context as Record<string, unknown>) ?? {},
    result: (row.result as Record<string, unknown>) ?? null,
    error: row.error ? String(row.error) : null,
    scheduledAt: row.scheduled_at ? new Date(String(row.scheduled_at)).toISOString() : null,
    startedAt: row.started_at ? new Date(String(row.started_at)).toISOString() : null,
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export async function saveWorkflow(
  workspaceId: string,
  workflow: Omit<WorkflowRecord, "workspaceId" | "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  },
): Promise<WorkflowRecord> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = workflow.updatedAt ?? new Date().toISOString();
  const createdAt = workflow.createdAt ?? now;

  await db`
    INSERT INTO workflows (
      id, workspace_id, name, triggers, steps, status, is_prebuilt, created_at, updated_at
    ) VALUES (
      ${workflow.id},
      ${workspaceId},
      ${workflow.name},
      ${db.json(workflow.triggers as never)},
      ${db.json(workflow.steps as never)},
      ${workflow.status},
      ${workflow.isPrebuilt},
      ${createdAt},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      triggers = EXCLUDED.triggers,
      steps = EXCLUDED.steps,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at
  `;

  return { ...workflow, workspaceId, createdAt, updatedAt: now };
}

export async function listWorkflows(workspaceId: string): Promise<WorkflowRecord[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM workflows
    WHERE workspace_id = ${workspaceId}
    ORDER BY updated_at DESC
  `;
  return rows.map((row) => rowToWorkflow(row as Record<string, unknown>));
}

export async function getWorkflow(
  workspaceId: string,
  workflowId: string,
): Promise<WorkflowRecord | null> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM workflows
    WHERE workspace_id = ${workspaceId} AND id = ${workflowId}
    LIMIT 1
  `;
  return rows.length ? rowToWorkflow(rows[0] as Record<string, unknown>) : null;
}

export async function listWorkflowsByTrigger(
  workspaceId: string,
  trigger: WorkflowTriggerType,
): Promise<WorkflowRecord[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM workflows
    WHERE workspace_id = ${workspaceId}
      AND status = 'active'
      AND triggers @> ${db.json([trigger] as never)}
    ORDER BY updated_at DESC
  `;
  return rows.map((row) => rowToWorkflow(row as Record<string, unknown>));
}

export async function saveWorkflowExecution(
  workspaceId: string,
  execution: Omit<WorkflowExecutionRecord, "workspaceId" | "createdAt"> & { createdAt?: string },
): Promise<WorkflowExecutionRecord> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = execution.createdAt ?? new Date().toISOString();

  await db`
    INSERT INTO workflow_executions (
      id, workspace_id, workflow_id, status, current_step_index, context,
      result, error, scheduled_at, started_at, completed_at, created_at
    ) VALUES (
      ${execution.id},
      ${workspaceId},
      ${execution.workflowId},
      ${execution.status},
      ${execution.currentStepIndex},
      ${db.json(execution.context as never)},
      ${execution.result ? db.json(execution.result as never) : null},
      ${execution.error},
      ${execution.scheduledAt},
      ${execution.startedAt},
      ${execution.completedAt},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      current_step_index = EXCLUDED.current_step_index,
      context = EXCLUDED.context,
      result = EXCLUDED.result,
      error = EXCLUDED.error,
      scheduled_at = EXCLUDED.scheduled_at,
      started_at = EXCLUDED.started_at,
      completed_at = EXCLUDED.completed_at
  `;

  return { ...execution, workspaceId, createdAt: now };
}

export async function getWorkflowExecution(
  workspaceId: string,
  executionId: string,
): Promise<WorkflowExecutionRecord | null> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM workflow_executions
    WHERE workspace_id = ${workspaceId} AND id = ${executionId}
    LIMIT 1
  `;
  return rows.length ? rowToWorkflowExecution(rows[0] as Record<string, unknown>) : null;
}

export async function listWorkflowExecutions(
  workspaceId: string,
  workflowId?: string,
  limit = 50,
): Promise<WorkflowExecutionRecord[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = workflowId
    ? await db`
        SELECT * FROM workflow_executions
        WHERE workspace_id = ${workspaceId} AND workflow_id = ${workflowId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await db`
        SELECT * FROM workflow_executions
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
  return rows.map((row) => rowToWorkflowExecution(row as Record<string, unknown>));
}

export async function listDueWorkflowExecutions(limit = 50): Promise<WorkflowExecutionRecord[]> {
  const db = getSql();
  const now = new Date().toISOString();
  const rows = await db`
    SELECT * FROM workflow_executions
    WHERE status = 'waiting'
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= ${now}
    ORDER BY scheduled_at ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => rowToWorkflowExecution(row as Record<string, unknown>));
}

export async function getWorkflowStats(workspaceId: string): Promise<{
  activeWorkflows: number;
  totalExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  successRate: number;
}> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const [workflowRows, execRows] = await Promise.all([
    db`
      SELECT COUNT(*)::int AS active
      FROM workflows
      WHERE workspace_id = ${workspaceId} AND status = 'active'
    `,
    db`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM workflow_executions
      WHERE workspace_id = ${workspaceId}
    `,
  ]);

  const total = Number(execRows[0]?.total ?? 0);
  const completed = Number(execRows[0]?.completed ?? 0);

  return {
    activeWorkflows: Number(workflowRows[0]?.active ?? 0),
    totalExecutions: total,
    completedExecutions: completed,
    failedExecutions: Number(execRows[0]?.failed ?? 0),
    successRate: total === 0 ? 0 : Math.round((completed / total) * 1000) / 10,
  };
}

// ─── M27: Event Bus ──────────────────────────────────────────────────────────

export type EventType =
  | "conversation.started"
  | "conversation.ended"
  | "lead.qualified"
  | "appointment.booked"
  | "agent.handoff"
  | "error.occurred";

export type EventStatus = "pending" | "processing" | "completed" | "failed";

export interface EventRecord {
  id: string;
  workspaceId: string;
  type: EventType;
  payload: Record<string, unknown>;
  status: EventStatus;
  retryCount: number;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface DeadLetterRecord {
  id: string;
  workspaceId: string;
  eventId: string;
  type: EventType;
  payload: Record<string, unknown>;
  error: string;
  retryCount: number;
  createdAt: string;
}

function rowToEvent(row: Record<string, unknown>): EventRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    type: row.type as EventType,
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: (row.status ?? "pending") as EventStatus,
    retryCount: Number(row.retry_count ?? 0),
    error: row.error ? String(row.error) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    processedAt: row.processed_at ? new Date(String(row.processed_at)).toISOString() : null,
  };
}

function rowToDeadLetter(row: Record<string, unknown>): DeadLetterRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    eventId: String(row.event_id),
    type: row.type as EventType,
    payload: (row.payload as Record<string, unknown>) ?? {},
    error: String(row.error),
    retryCount: Number(row.retry_count ?? 0),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export async function saveEvent(
  workspaceId: string,
  event: Omit<EventRecord, "workspaceId" | "createdAt" | "processedAt" | "retryCount" | "status" | "error"> & {
    status?: EventStatus;
    retryCount?: number;
    error?: string | null;
    createdAt?: string;
    processedAt?: string | null;
  },
): Promise<EventRecord> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = event.createdAt ?? new Date().toISOString();

  await db`
    INSERT INTO events (id, workspace_id, type, payload, status, retry_count, error, created_at, processed_at)
    VALUES (
      ${event.id},
      ${workspaceId},
      ${event.type},
      ${db.json(event.payload as never)},
      ${event.status ?? "pending"},
      ${event.retryCount ?? 0},
      ${event.error ?? null},
      ${now},
      ${event.processedAt ?? null}
    )
  `;

  return {
    id: event.id,
    workspaceId,
    type: event.type,
    payload: event.payload,
    status: event.status ?? "pending",
    retryCount: event.retryCount ?? 0,
    error: event.error ?? null,
    createdAt: now,
    processedAt: event.processedAt ?? null,
  };
}

export async function updateEventStatus(
  workspaceId: string,
  eventId: string,
  update: {
    status: EventStatus;
    retryCount?: number;
    error?: string | null;
    processedAt?: string | null;
  },
): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  await db`
    UPDATE events
    SET
      status = ${update.status},
      retry_count = COALESCE(${update.retryCount ?? null}, retry_count),
      error = ${update.error ?? null},
      processed_at = COALESCE(${update.processedAt ?? null}, processed_at)
    WHERE workspace_id = ${workspaceId} AND id = ${eventId}
  `;
}

export async function listPendingEvents(limit = 100): Promise<EventRecord[]> {
  const db = getSql();
  const rows = await db`
    SELECT * FROM events
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => rowToEvent(row as Record<string, unknown>));
}

export async function listEvents(
  workspaceId: string,
  limit = 50,
): Promise<EventRecord[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM events
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => rowToEvent(row as Record<string, unknown>));
}

export async function saveDeadLetterEvent(
  workspaceId: string,
  record: Omit<DeadLetterRecord, "workspaceId" | "createdAt"> & { createdAt?: string },
): Promise<DeadLetterRecord> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const now = record.createdAt ?? new Date().toISOString();

  await db`
    INSERT INTO dead_letter_queue (id, workspace_id, event_id, type, payload, error, retry_count, created_at)
    VALUES (
      ${record.id},
      ${workspaceId},
      ${record.eventId},
      ${record.type},
      ${db.json(record.payload as never)},
      ${record.error},
      ${record.retryCount},
      ${now}
    )
  `;

  return { ...record, workspaceId, createdAt: now };
}

export async function listDeadLetterEvents(
  workspaceId: string,
  limit = 20,
): Promise<DeadLetterRecord[]> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
  const rows = await db`
    SELECT * FROM dead_letter_queue
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => rowToDeadLetter(row as Record<string, unknown>));
}
