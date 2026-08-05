/**
 * Kernel public API + boot.
 *
 * `ensureKernelBooted()` registers every built-in module exactly once per warm
 * function instance. The spec's "scan /modules/* at boot" becomes an explicit
 * import list here — the one place that knows the built-in modules — because
 * Netlify bundles functions ahead of time and a runtime filesystem scan does
 * not survive bundling. The kernel still never calls into a module directly:
 * it goes through the registry, validates the contract, and only activates
 * modules a tenant has installed.
 *
 * Adding a module = import it and add one `registerModule(...)` line below.
 */

import { registerModule } from "./registry.ts";
import { ecommerceModule } from "../modules/ecommerce/index.ts";
import { appointmentsModule } from "../modules/appointments/index.ts";

let booted = false;

/** Register all built-in modules once. Safe to call on every request. */
export function ensureKernelBooted(): void {
  if (booted) return;
  registerModule(ecommerceModule);
  registerModule(appointmentsModule);
  booted = true;
}

export { KERNEL_VERSION, getKernel } from "./kernel.ts";
export {
  getAvailableModules,
  getModule,
  getRegisteredModuleIds,
  ModuleContractError,
} from "./registry.ts";
export {
  getInstalledModuleIds,
  isModuleInstalled,
  listInstalledModules,
} from "./module-store.ts";
export {
  installModuleForTenant,
  uninstallModuleForTenant,
  UnknownModuleError,
} from "./lifecycle.ts";
export { buildModuleAgentContext } from "./context-router.ts";
export type { ModuleAgentContext } from "./context-router.ts";
export type {
  DBSchema,
  IVerticalAdapter,
  Kernel,
  ModuleManifest,
} from "./adapter.ts";
