#!/usr/bin/env node
/**
 * Customer data export — dumps everything belonging to one workspace as JSON.
 * Use for GDPR/data-portability requests and customer offboarding.
 *
 * Usage:  node scripts/export-workspace-data.mjs <workspaceId> [outFile]
 *         outFile defaults to exports/<workspaceId>-<date>.json
 *
 * Env:    DATABASE_URL (or .env at repo root)
 *
 * Channel credentials (access tokens) are deliberately EXCLUDED — they are
 * our operational secrets, not customer data. Password hashes are excluded
 * for the same reason.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

// Reuse the app's postgres driver rather than adding a root dependency.
const require = createRequire(join(process.cwd(), "web", "package.json"));
const postgres = require("postgres");

function loadEnvFile() {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return {};
  const vars = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !line.trim().startsWith("#")) vars[match[1]] = match[2];
  }
  return vars;
}

const workspaceId = process.argv[2];
if (!workspaceId) {
  console.error("Usage: node scripts/export-workspace-data.mjs <workspaceId> [outFile]");
  process.exit(1);
}

const fileEnv = loadEnvFile();
const databaseUrl =
  process.env.DATABASE_URL ?? fileEnv.DATABASE_URL ?? fileEnv.SUPABASE_DATABASE_URL;
if (!databaseUrl || databaseUrl.includes("[project-ref]")) {
  console.error("✗ DATABASE_URL is not set (env or .env). Aborting.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { prepare: false, max: 1 });

try {
  const [workspace] = await sql`
    SELECT id, name, slug, plan, subscription_status, owner_id, public_key, created_at
    FROM workspaces WHERE id = ${workspaceId}`;
  if (!workspace) {
    console.error(`✗ Workspace ${workspaceId} not found.`);
    process.exit(1);
  }

  console.log(`Exporting workspace "${workspace.name}" (${workspaceId}) …`);

  const users = await sql`
    SELECT id, email, name, role, created_at
    FROM users WHERE workspace_id = ${workspaceId}`;
  const agents = await sql`
    SELECT id, name, is_active, config, created_at, updated_at
    FROM agents WHERE workspace_id = ${workspaceId}`;
  const conversations = await sql`
    SELECT * FROM conversations WHERE workspace_id = ${workspaceId} ORDER BY created_at`;
  const messages = await sql`
    SELECT m.* FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.workspace_id = ${workspaceId}
    ORDER BY m.timestamp`;
  const leads = await sql`
    SELECT * FROM leads WHERE workspace_id = ${workspaceId} ORDER BY created_at`;
  const knowledge = await sql`
    SELECT id, title, content, type, metadata, created_at, updated_at
    FROM knowledge_items WHERE workspace_id = ${workspaceId} ORDER BY created_at`;
  const [profile] = await sql`
    SELECT data, updated_at FROM business_profiles WHERE workspace_id = ${workspaceId}`;

  const payload = {
    exportedAt: new Date().toISOString(),
    format: "ai-business-os-workspace-export/v1",
    workspace,
    users,
    agents,
    businessProfile: profile ?? null,
    knowledgeItems: knowledge,
    conversations,
    messages,
    leads,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const outFile = process.argv[3] ?? join(process.cwd(), "exports", `${workspaceId}-${stamp}.json`);
  mkdirSync(join(outFile, ".."), { recursive: true });
  writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8");

  console.log(`✓ Exported to ${outFile}`);
  console.log(
    `  users=${users.length} agents=${agents.length} conversations=${conversations.length} ` +
      `messages=${messages.length} leads=${leads.length} knowledge=${knowledge.length}`,
  );
} finally {
  await sql.end();
}
