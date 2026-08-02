/**
 * Migrate local JSON data (web/data/) into Supabase.
 *
 * Prerequisites:
 *   1. Run supabase/migrations/*.sql in Supabase SQL Editor (001 → 010)
 *   2. Set DATABASE_URL to your Supabase PgBouncer connection string (port 6543)
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npm run migrate:supabase --prefix web
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(root, "web", "data");

interface MigrationTotals {
  workspaces: number;
  knowledgeFiles: number;
  knowledgeItems: number;
  channelConfigs: number;
  leads: number;
  conversations: number;
  messages: number;
  whatsappSessions: number;
  instagramSessions: number;
  passwordResets: number;
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function countJsonFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((file) => file.endsWith(".json")).length;
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.SUPABASE_DATABASE_URL) {
    console.error("Set DATABASE_URL to your Supabase connection string.");
    process.exit(1);
  }

  const {
    ensureDbConnection,
    importAuthStore,
    setKnowledgeFile,
    saveKnowledgeItems,
    saveChannelConfig,
    saveChannelSession,
    upsertLead,
    saveConversation,
    saveMessage,
    getWorkspace,
  } = await import("../web/netlify/functions/_shared/db.ts");

  await ensureDbConnection();

  const totals: MigrationTotals = {
    workspaces: 0,
    knowledgeFiles: 0,
    knowledgeItems: 0,
    channelConfigs: 0,
    leads: 0,
    conversations: 0,
    messages: 0,
    whatsappSessions: 0,
    instagramSessions: 0,
    passwordResets: 0,
  };

  if (!fs.existsSync(dataRoot)) {
    console.warn(`No local data directory at ${dataRoot}. Nothing to migrate.`);
    console.log("Migration complete. Migrated 0 records from local to Supabase.");
    return;
  }

  console.log("Migrating from", dataRoot);

  const authPath = path.join(dataRoot, "auth-store.json");
  const authData = readJson<{
    usersById: Record<string, unknown>;
    usersByEmail: Record<string, string>;
    workspacesById: Record<string, unknown>;
    resetsByTokenHash: Record<string, unknown>;
  } | null>(authPath, null);

  if (authData) {
    console.log("Importing auth store…");
    await importAuthStore(authData as never);
    totals.workspaces = Object.keys(authData.workspacesById ?? {}).length;
    totals.passwordResets = Object.keys(authData.resetsByTokenHash ?? {}).length;
    console.log(
      `Migrated ${totals.workspaces} workspaces and ${totals.passwordResets} password resets from local to Supabase`,
    );
  }

  const workspaceIds = authData
    ? Object.keys(authData.workspacesById ?? {})
    : listDirs(path.join(dataRoot, "runtime"));

  for (const workspaceId of workspaceIds) {
    console.log(`Workspace ${workspaceId}`);

    const workspace = await getWorkspace(workspaceId);
    if (!workspace) {
      console.warn("  Skipping — workspace not in DB (register or import auth first)");
      continue;
    }

    const knowledgeFiles = readJson<Record<string, string>>(
      path.join(dataRoot, "knowledge", workspaceId, "files.json"),
      {},
    );
    for (const [filePath, content] of Object.entries(knowledgeFiles)) {
      await setKnowledgeFile(workspaceId, filePath, content);
    }
    totals.knowledgeFiles += Object.keys(knowledgeFiles).length;
    console.log(
      `  Migrated ${Object.keys(knowledgeFiles).length} knowledge files from local to Supabase`,
    );

    const knowledgeItems = readJson<unknown[]>(
      path.join(dataRoot, "knowledge", workspaceId, "items.json"),
      [],
    );
    if (knowledgeItems.length > 0) {
      await saveKnowledgeItems(workspaceId, knowledgeItems as never);
      totals.knowledgeItems += knowledgeItems.length;
      console.log(
        `  Migrated ${knowledgeItems.length} knowledge items from local to Supabase`,
      );
    }

    const channels = readJson<{ whatsapp?: Record<string, unknown>; instagram?: Record<string, unknown> }>(
      path.join(dataRoot, "channels", workspaceId, "config.json"),
      {},
    );
    if (channels.whatsapp || channels.instagram) {
      await saveChannelConfig(workspaceId, channels);
      totals.channelConfigs += 1;
      console.log("  Migrated channel config from local to Supabase");
    }

    const runtime = readJson<{ conversations?: unknown[]; leads?: unknown[] }>(
      path.join(dataRoot, "runtime", workspaceId, "events.json"),
      {},
    );

    for (const lead of runtime.leads ?? []) {
      const item = lead as Record<string, unknown>;
      await upsertLead(workspaceId, {
        id: String(item.id),
        workspaceId,
        name: String(item.name ?? "Unknown"),
        phone: String(item.phone ?? ""),
        email: String(item.email ?? ""),
        productInterest: String(item.productInterest ?? ""),
        leadScore: Number(item.leadScore ?? 35),
        assignedAgent: (item.assignedAgent ?? "reception") as never,
        status: (item.status ?? "new") as never,
        notes: String(item.notes ?? ""),
        createdAt: String(item.createdAt ?? new Date().toISOString()),
        updatedAt: String(item.updatedAt ?? new Date().toISOString()),
        source: String(item.source ?? "migrated"),
        conversationId: item.conversationId ? String(item.conversationId) : undefined,
      });
    }
    totals.leads += runtime.leads?.length ?? 0;
    console.log(`  Migrated ${runtime.leads?.length ?? 0} leads from local to Supabase`);

    let workspaceMessages = 0;
    for (const conv of runtime.conversations ?? []) {
      const conversation = conv as Record<string, unknown>;
      const messages = (conversation.messages as Array<Record<string, unknown>>) ?? [];
      await saveConversation({
        id: String(conversation.id),
        workspaceId,
        customer: (conversation.customer as never) ?? { name: "Visitor" },
        channel: conversation.channel as never,
        agentUsed: (conversation.agentUsed ?? "reception") as never,
        leadStatus: (conversation.leadStatus ?? "new") as never,
        sentiment: (conversation.sentiment ?? "neutral") as never,
        updatedAt: String(conversation.updatedAt),
        createdAt: String(conversation.createdAt),
        preview: String(conversation.preview ?? ""),
        unread: Boolean(conversation.unread),
        intent: conversation.intent as never,
        routingReason: conversation.routingReason ? String(conversation.routingReason) : undefined,
        messages: [],
      });

      for (const message of messages) {
        await saveMessage({
          id: String(message.id),
          conversationId: String(conversation.id),
          role: message.role as never,
          content: String(message.content),
          timestamp: String(message.sentAt),
          agent: message.agent as never,
        });
      }

      totals.conversations += 1;
      workspaceMessages += messages.length;
      totals.messages += messages.length;
    }
    console.log(
      `  Migrated ${runtime.conversations?.length ?? 0} conversations and ${workspaceMessages} messages from local to Supabase`,
    );

    const waSessionsDir = path.join(dataRoot, "whatsapp-sessions", workspaceId);
    const waCount = countJsonFiles(waSessionsDir);
    for (const file of fs.existsSync(waSessionsDir) ? fs.readdirSync(waSessionsDir) : []) {
      if (!file.endsWith(".json")) continue;
      const senderKey = file.replace(/\.json$/, "");
      const session = readJson(path.join(waSessionsDir, file), {});
      await saveChannelSession(workspaceId, "whatsapp", senderKey, session as Record<string, unknown>);
    }
    totals.whatsappSessions += waCount;
    if (waCount > 0) {
      console.log(`  Migrated ${waCount} WhatsApp sessions from local to Supabase`);
    }

    const igSessionsDir = path.join(dataRoot, "instagram-sessions", workspaceId);
    const igCount = countJsonFiles(igSessionsDir);
    for (const file of fs.existsSync(igSessionsDir) ? fs.readdirSync(igSessionsDir) : []) {
      if (!file.endsWith(".json")) continue;
      const senderKey = file.replace(/\.json$/, "");
      const session = readJson(path.join(igSessionsDir, file), {});
      await saveChannelSession(workspaceId, "instagram", senderKey, session as Record<string, unknown>);
    }
    totals.instagramSessions += igCount;
    if (igCount > 0) {
      console.log(`  Migrated ${igCount} Instagram sessions from local to Supabase`);
    }
  }

  const grandTotal =
    totals.workspaces +
    totals.knowledgeFiles +
    totals.knowledgeItems +
    totals.channelConfigs +
    totals.leads +
    totals.conversations +
    totals.messages +
    totals.whatsappSessions +
    totals.instagramSessions +
    totals.passwordResets;

  console.log("\nMigration summary:");
  console.log(JSON.stringify(totals, null, 2));
  console.log(`Migration complete. Migrated ${grandTotal} records from local to Supabase.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
