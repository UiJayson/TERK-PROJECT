/**
 * Tenant module lifecycle — the write path behind the install/uninstall API.
 * Combines the persistence layer ({@link ./module-store.ts}) with the module's
 * own `onTenantInstall`/`onTenantUninstall` hooks, ordering them so the record
 * and the module's tenant rows stay consistent.
 */

import { getModule } from "./registry.ts";
import { isModuleInstalled, recordInstall, recordUninstall } from "./module-store.ts";

export class UnknownModuleError extends Error {
  constructor(moduleId: string) {
    super(`Unknown module "${moduleId}". It is not registered with the kernel.`);
    this.name = "UnknownModuleError";
  }
}

export interface LifecycleResult {
  moduleId: string;
  changed: boolean;
}

/**
 * Install a module for a tenant. Runs the adapter's idempotent
 * `onTenantInstall` first, then records the install. If the hook throws, no
 * install row is written, so a retry re-runs cleanly.
 */
export async function installModuleForTenant(
  workspaceId: string,
  moduleId: string,
): Promise<LifecycleResult> {
  const adapter = getModule(moduleId);
  if (!adapter) throw new UnknownModuleError(moduleId);

  if (await isModuleInstalled(workspaceId, moduleId)) {
    return { moduleId, changed: false };
  }

  await adapter.onTenantInstall(workspaceId);
  const changed = await recordInstall(workspaceId, moduleId, adapter.version);
  return { moduleId, changed };
}

/**
 * Uninstall a module for a tenant. Removes the install record first (so the
 * kernel immediately stops activating it), then runs the adapter's idempotent
 * cleanup.
 */
export async function uninstallModuleForTenant(
  workspaceId: string,
  moduleId: string,
): Promise<LifecycleResult> {
  const adapter = getModule(moduleId);
  if (!adapter) throw new UnknownModuleError(moduleId);

  if (!(await isModuleInstalled(workspaceId, moduleId))) {
    return { moduleId, changed: false };
  }

  await recordUninstall(workspaceId, moduleId);
  await adapter.onTenantUninstall(workspaceId);
  return { moduleId, changed: true };
}
