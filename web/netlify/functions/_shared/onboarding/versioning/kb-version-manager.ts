/**
 * Knowledge-base version manager (Problem 3 §Step 6). Active conversations pin
 * the KB version that was live when they started. New conversations pick the
 * latest published version. Rollback flips the `is_active` flag to a prior row.
 */

import { ensureDbConnection, getSql } from "../../db.ts";

export interface KbVersionRow {
  id: number;
  workspaceId: string;
  versionNumber: number;
  publishedAt: string;
  isActive: boolean;
  notes: string | null;
}

/** Return the active KB version number, seeding version 1 if none exists. */
export async function getCurrentKbVersion(workspaceId: string): Promise<number> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT version_number FROM kb_versions
    WHERE workspace_id = ${workspaceId} AND is_active = TRUE
    ORDER BY version_number DESC LIMIT 1
  `;
  if (rows.length > 0) return Number(rows[0].version_number);

  // Seed v1.
  await db`
    INSERT INTO kb_versions (workspace_id, version_number, is_active, notes)
    VALUES (${workspaceId}, 1, TRUE, 'initial')
    ON CONFLICT (workspace_id, version_number) DO NOTHING
  `;
  return 1;
}

/** Publish a new version, deactivating the previous one atomically. */
export async function incrementKbVersion(
  workspaceId: string,
  notes: string,
): Promise<number> {
  await ensureDbConnection();
  const db = getSql();
  const current = await getCurrentKbVersion(workspaceId);
  const next = current + 1;
  await db.begin(async (tx) => {
    await tx`UPDATE kb_versions SET is_active = FALSE WHERE workspace_id = ${workspaceId} AND is_active = TRUE`;
    await tx`
      INSERT INTO kb_versions (workspace_id, version_number, is_active, notes)
      VALUES (${workspaceId}, ${next}, TRUE, ${notes})
    `;
  });
  return next;
}

export async function listKbVersions(workspaceId: string): Promise<KbVersionRow[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT id, version_number, published_at, is_active, notes
    FROM kb_versions WHERE workspace_id = ${workspaceId}
    ORDER BY version_number DESC LIMIT 50
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    workspaceId,
    versionNumber: Number(row.version_number),
    publishedAt: new Date(row.published_at as string).toISOString(),
    isActive: Boolean(row.is_active),
    notes: (row.notes as string | null) ?? null,
  }));
}

/** Roll active to a specific prior version. */
export async function rollbackKbVersion(
  workspaceId: string,
  targetVersion: number,
): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  await db.begin(async (tx) => {
    await tx`UPDATE kb_versions SET is_active = FALSE WHERE workspace_id = ${workspaceId}`;
    const updated = await tx`
      UPDATE kb_versions SET is_active = TRUE
      WHERE workspace_id = ${workspaceId} AND version_number = ${targetVersion}
      RETURNING version_number
    `;
    if (updated.length === 0) throw new Error(`KB version ${targetVersion} not found`);
  });
}

/** Pin an ongoing conversation to a KB version at start. Idempotent. */
export async function pinConversationToVersion(
  workspaceId: string,
  conversationId: string,
  version: number,
): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  await db`
    INSERT INTO conversation_kb_pins (workspace_id, conversation_id, kb_version)
    VALUES (${workspaceId}, ${conversationId}, ${version})
    ON CONFLICT (workspace_id, conversation_id) DO NOTHING
  `;
}

export async function getConversationPinnedVersion(
  workspaceId: string,
  conversationId: string,
): Promise<number | null> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT kb_version FROM conversation_kb_pins
    WHERE workspace_id = ${workspaceId} AND conversation_id = ${conversationId} LIMIT 1
  `;
  return rows.length > 0 ? Number(rows[0].kb_version) : null;
}
