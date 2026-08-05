/**
 * Persistence for per-tenant module installation. The tenant's installed
 * modules are the single source of truth the kernel consults at request time to
 * decide which adapters to activate. Stored in `tenant_modules` (see migration
 * 020) — one row per (workspace_id, module_id).
 *
 * Every query is scoped by `workspace_id`, consistent with the app-layer
 * isolation model used across the codebase.
 */

import { ensureDbConnection, getSql } from "../db.ts";

export interface InstalledModuleRecord {
  workspaceId: string;
  moduleId: string;
  version: string;
  installedAt: string;
}

/** Module ids a tenant currently has installed, in install order. */
export async function getInstalledModuleIds(workspaceId: string): Promise<string[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT module_id FROM tenant_modules
    WHERE workspace_id = ${workspaceId}
    ORDER BY installed_at ASC
  `;
  return rows.map((row) => String(row.module_id));
}

/** True if the tenant has the given module installed. */
export async function isModuleInstalled(workspaceId: string, moduleId: string): Promise<boolean> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT 1 FROM tenant_modules
    WHERE workspace_id = ${workspaceId} AND module_id = ${moduleId}
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Record a module as installed for a tenant. Idempotent — a repeated install is
 * a no-op on the row (the caller runs the adapter's `onTenantInstall`, which is
 * itself idempotent). Returns true if a new row was created.
 */
export async function recordInstall(
  workspaceId: string,
  moduleId: string,
  version: string,
): Promise<boolean> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    INSERT INTO tenant_modules (workspace_id, module_id, version, installed_at)
    VALUES (${workspaceId}, ${moduleId}, ${version}, now())
    ON CONFLICT (workspace_id, module_id) DO NOTHING
    RETURNING module_id
  `;
  return rows.length > 0;
}

/** Remove the tenant's install record for a module. Idempotent. */
export async function recordUninstall(workspaceId: string, moduleId: string): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  await db`
    DELETE FROM tenant_modules
    WHERE workspace_id = ${workspaceId} AND module_id = ${moduleId}
  `;
}

/** Full install records for a tenant (drives GET /api/modules/installed). */
export async function listInstalledModules(workspaceId: string): Promise<InstalledModuleRecord[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT workspace_id, module_id, version, installed_at
    FROM tenant_modules
    WHERE workspace_id = ${workspaceId}
    ORDER BY installed_at ASC
  `;
  return rows.map((row) => ({
    workspaceId: String(row.workspace_id),
    moduleId: String(row.module_id),
    version: String(row.version),
    installedAt: new Date(row.installed_at as string).toISOString(),
  }));
}
