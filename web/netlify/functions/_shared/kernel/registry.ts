/**
 * Module registry — the kernel's dynamic loader.
 *
 * The spec calls for scanning `/modules/*` and registering every module found.
 * On Netlify, functions are bundled ahead of time, so a runtime filesystem scan
 * of manifest files does not survive bundling. We preserve the *intent* — the
 * kernel never hard-codes calls into module code, enforces the contract at load
 * time, and only activates a module for a tenant that has it installed — with a
 * static import list of built-in modules (see {@link ./index.ts}). Adding a
 * module is a one-line registration there; the kernel still validates and gates
 * everything below.
 */

import type { IVerticalAdapter, ModuleManifest } from "./adapter.ts";
import { getKernel, KERNEL_VERSION } from "./kernel.ts";

/** Thrown when a module fails contract validation at registration. */
export class ModuleContractError extends Error {
  constructor(moduleId: string, reason: string) {
    super(`Module "${moduleId}" rejected: ${reason}`);
    this.name = "ModuleContractError";
  }
}

const registry = new Map<string, IVerticalAdapter>();
const registered = new Set<string>();

const SEMVER = /^\d+\.\d+\.\d+$/;

/** Parse "1.2.3" → [1,2,3]; throws on malformed input. */
function parseSemver(v: string): [number, number, number] {
  if (!SEMVER.test(v)) throw new Error(`invalid semver "${v}"`);
  const [a, b, c] = v.split(".").map((n) => Number(n));
  return [a, b, c];
}

/** True when `have` satisfies `>= required` by semver ordering. */
function satisfies(have: string, required: string): boolean {
  const [h1, h2, h3] = parseSemver(have);
  const [r1, r2, r3] = parseSemver(required);
  if (h1 !== r1) return h1 > r1;
  if (h2 !== r2) return h2 > r2;
  return h3 >= r3;
}

/**
 * Validate the manifest ⇔ adapter agreement, semver fields, kernel
 * compatibility, and the table-prefix rule. Throws {@link ModuleContractError}
 * on any violation so a broken module can never be half-registered.
 */
function validate(adapter: IVerticalAdapter): ModuleManifest {
  const manifest = adapter.getManifest();
  const id = manifest.id;

  const required: Array<[keyof ModuleManifest, unknown]> = [
    ["id", manifest.id],
    ["name", manifest.name],
    ["version", manifest.version],
    ["requiredKernelVersion", manifest.requiredKernelVersion],
    ["capabilities", manifest.capabilities],
  ];
  for (const [field, value] of required) {
    if (value === undefined || value === null || value === "") {
      throw new ModuleContractError(id || "<unknown>", `manifest missing "${String(field)}"`);
    }
  }

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    throw new ModuleContractError(id, "manifest.capabilities must be a non-empty array");
  }

  // Adapter fields must mirror the manifest so there is one source of truth.
  if (adapter.id !== manifest.id) {
    throw new ModuleContractError(id, `adapter.id "${adapter.id}" ≠ manifest.id "${manifest.id}"`);
  }
  if (adapter.version !== manifest.version) {
    throw new ModuleContractError(id, "adapter.version ≠ manifest.version");
  }
  if (adapter.requiredKernelVersion !== manifest.requiredKernelVersion) {
    throw new ModuleContractError(id, "adapter.requiredKernelVersion ≠ manifest.requiredKernelVersion");
  }

  // Required methods must be implemented.
  const methods: Array<keyof IVerticalAdapter> = [
    "register",
    "getCapabilities",
    "getAgentSystemPrompt",
    "getSchemas",
    "onTenantInstall",
    "onTenantUninstall",
  ];
  for (const method of methods) {
    if (typeof adapter[method] !== "function") {
      throw new ModuleContractError(id, `adapter missing method "${String(method)}"`);
    }
  }

  // Kernel compatibility.
  let compatible: boolean;
  try {
    compatible = satisfies(KERNEL_VERSION, manifest.requiredKernelVersion);
  } catch (error) {
    throw new ModuleContractError(id, error instanceof Error ? error.message : "semver check failed");
  }
  if (!compatible) {
    throw new ModuleContractError(
      id,
      `requires kernel >= ${manifest.requiredKernelVersion} but kernel is ${KERNEL_VERSION}`,
    );
  }

  // Table-ownership rule: every owned table must carry the `<moduleId>_` prefix.
  for (const schema of adapter.getSchemas()) {
    if (!schema.table.startsWith(`${id}_`)) {
      throw new ModuleContractError(
        id,
        `owned table "${schema.table}" must be prefixed "${id}_"`,
      );
    }
  }

  return manifest;
}

/**
 * Register a module with the kernel. Validates the contract, then calls the
 * module's `register(kernel)` exactly once so it can wire event subscriptions.
 * Idempotent per module id.
 */
export function registerModule(adapter: IVerticalAdapter): void {
  const manifest = validate(adapter);

  if (registered.has(manifest.id)) return; // already wired this boot
  registry.set(manifest.id, adapter);
  registered.add(manifest.id);
  adapter.register(getKernel());
}

/** Look up a registered module by id, or null. */
export function getModule(id: string): IVerticalAdapter | null {
  return registry.get(id) ?? null;
}

/** All registered module ids. */
export function getRegisteredModuleIds(): string[] {
  return [...registry.keys()];
}

/** Manifests for every registered module (drives GET /api/modules/available). */
export function getAvailableModules(): ModuleManifest[] {
  return [...registry.values()].map((adapter) => adapter.getManifest());
}

/** Test-only: clear the registry so a fresh boot can be simulated. */
export function __resetRegistryForTests(): void {
  registry.clear();
  registered.clear();
}
