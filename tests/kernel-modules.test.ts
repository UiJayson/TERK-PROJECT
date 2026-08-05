/**
 * Kernel + Vertical Adapter contract tests (Problem 2). DB-free: exercises the
 * registry's contract enforcement, capability aggregation, and the built-in
 * module manifests. Run with: tsx tests/kernel-modules.test.ts
 */

import type {
  DBSchema,
  IVerticalAdapter,
  Kernel,
  ModuleManifest,
} from "../web/netlify/functions/_shared/kernel/adapter.ts";
import {
  __resetRegistryForTests,
  getAvailableModules,
  getModule,
  getRegisteredModuleIds,
  ModuleContractError,
  registerModule,
} from "../web/netlify/functions/_shared/kernel/registry.ts";
import { KERNEL_VERSION } from "../web/netlify/functions/_shared/kernel/kernel.ts";
import { ecommerceModule } from "../web/netlify/functions/_shared/modules/ecommerce/index.ts";
import { appointmentsModule } from "../web/netlify/functions/_shared/modules/appointments/index.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => void, expectedName: string, message: string): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.name === expectedName) return;
    throw new Error(`${message} — threw wrong error: ${String(error)}`);
  }
  throw new Error(`${message} — expected throw but none occurred`);
}

/** Minimal conforming adapter builder for negative tests. */
function makeAdapter(overrides: Partial<{
  manifest: ModuleManifest;
  schemas: DBSchema[];
  id: string;
  version: string;
  requiredKernelVersion: string;
}> = {}): IVerticalAdapter {
  const manifest: ModuleManifest = overrides.manifest ?? {
    id: "widgets",
    name: "Widgets",
    description: "Test module",
    version: "1.0.0",
    requiredKernelVersion: "1.0.0",
    capabilities: ["widgeting"],
    status: "available",
  };
  const schemas = overrides.schemas ?? [
    { table: `${manifest.id}_things`, description: "x", workspaceScoped: true },
  ];
  return {
    id: overrides.id ?? manifest.id,
    version: overrides.version ?? manifest.version,
    requiredKernelVersion: overrides.requiredKernelVersion ?? manifest.requiredKernelVersion,
    getManifest: () => manifest,
    register: (_kernel: Kernel) => {},
    getCapabilities: () => [...manifest.capabilities],
    getAgentSystemPrompt: () => "",
    getSchemas: () => schemas,
    onTenantInstall: async () => {},
    onTenantUninstall: async () => {},
  };
}

function testValidModuleRegisters(): void {
  __resetRegistryForTests();
  registerModule(makeAdapter());
  assert(getRegisteredModuleIds().includes("widgets"), "widgets should be registered");
  assert(getModule("widgets") !== null, "getModule should return the adapter");
  assert(
    getAvailableModules().some((m) => m.id === "widgets"),
    "available modules should include widgets",
  );
}

function testRejectsBadTablePrefix(): void {
  __resetRegistryForTests();
  const bad = makeAdapter({
    schemas: [{ table: "orders", description: "unprefixed", workspaceScoped: true }],
  });
  assertThrows(() => registerModule(bad), "ModuleContractError", "unprefixed table must be rejected");
}

function testRejectsManifestAdapterMismatch(): void {
  __resetRegistryForTests();
  const bad = makeAdapter({ id: "not-widgets" });
  assertThrows(
    () => registerModule(bad),
    "ModuleContractError",
    "adapter.id ≠ manifest.id must be rejected",
  );
}

function testRejectsIncompatibleKernelVersion(): void {
  __resetRegistryForTests();
  const manifest: ModuleManifest = {
    id: "future",
    name: "Future",
    description: "needs newer kernel",
    version: "1.0.0",
    requiredKernelVersion: "99.0.0",
    capabilities: ["time_travel"],
    status: "available",
  };
  const bad = makeAdapter({ manifest, requiredKernelVersion: "99.0.0" });
  assertThrows(
    () => registerModule(bad),
    "ModuleContractError",
    "module requiring a newer kernel must be rejected",
  );
}

function testRejectsEmptyCapabilities(): void {
  __resetRegistryForTests();
  const manifest: ModuleManifest = {
    id: "empty",
    name: "Empty",
    description: "no caps",
    version: "1.0.0",
    requiredKernelVersion: "1.0.0",
    capabilities: [],
    status: "available",
  };
  assertThrows(
    () => registerModule(makeAdapter({ manifest })),
    "ModuleContractError",
    "module with no capabilities must be rejected",
  );
}

function testRegistrationIsIdempotent(): void {
  __resetRegistryForTests();
  registerModule(makeAdapter());
  registerModule(makeAdapter());
  assert(
    getRegisteredModuleIds().filter((id) => id === "widgets").length === 1,
    "double registration should not duplicate",
  );
}

function testBuiltInModulesConform(): void {
  __resetRegistryForTests();
  // Should not throw — the real ecommerce/appointments modules must satisfy the
  // contract against the current kernel version.
  registerModule(ecommerceModule);
  registerModule(appointmentsModule);

  const ecommerce = getModule("ecommerce");
  const appointments = getModule("appointments");
  assert(ecommerce !== null, "ecommerce should register");
  assert(appointments !== null, "appointments should register");
  assert(
    ecommerce!.getCapabilities().includes("orders"),
    "ecommerce should expose the 'orders' capability",
  );
  assert(
    appointments!.getCapabilities().includes("bookings"),
    "appointments should expose the 'bookings' capability",
  );
  // Every owned table must carry the module prefix.
  for (const schema of ecommerce!.getSchemas()) {
    assert(schema.table.startsWith("ecommerce_"), `bad ecommerce table ${schema.table}`);
  }
  for (const schema of appointments!.getSchemas()) {
    assert(schema.table.startsWith("appointments_"), `bad appointments table ${schema.table}`);
  }
  // Sanity: the built-ins target the current kernel.
  assert(KERNEL_VERSION === "1.0.0", "kernel version pinned for these tests");
}

function testCapabilityGatingByRole(): void {
  __resetRegistryForTests();
  registerModule(ecommerceModule);
  const ecommerce = getModule("ecommerce")!;
  // Sales gets store guidance; human_review gets nothing.
  assert(ecommerce.getAgentSystemPrompt("sales").length > 0, "sales should get ecommerce prompt");
  assert(
    ecommerce.getAgentSystemPrompt("human_review") === "",
    "human_review should get no module prompt",
  );
}

async function main(): Promise<void> {
  const tests = [
    ["valid module registers", testValidModuleRegisters],
    ["rejects unprefixed table", testRejectsBadTablePrefix],
    ["rejects manifest/adapter mismatch", testRejectsManifestAdapterMismatch],
    ["rejects incompatible kernel version", testRejectsIncompatibleKernelVersion],
    ["rejects empty capabilities", testRejectsEmptyCapabilities],
    ["registration is idempotent", testRegistrationIsIdempotent],
    ["built-in modules conform", testBuiltInModulesConform],
    ["capability gating by role", testCapabilityGatingByRole],
  ] as const;

  let passed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (error) {
      console.error(`FAIL  ${name}:`, error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }

  console.log(`\nKernel module tests: ${passed}/${tests.length} passed`);
  if (process.exitCode) process.exit(process.exitCode);
}

void main();

// Reference imported types so `verbatimModuleSyntax`-style unused checks stay quiet.
export type { IVerticalAdapter, ModuleManifest, DBSchema, Kernel };
export { ModuleContractError };
