/**
 * Vertical Adapter contract — the boundary between the Core Kernel and every
 * industry module.
 *
 * The kernel contains only what every business needs (auth, tenants, agent
 * orchestration, knowledge base, chat, billing, event bus, analytics). Every
 * industry-specific feature lives inside a module that implements
 * {@link IVerticalAdapter}. The kernel never imports a module directly — it
 * loads modules through the registry and only activates the ones a tenant has
 * installed.
 *
 * Hard rules enforced elsewhere but stated here for module authors:
 *  - The kernel must never contain industry-specific business logic.
 *  - A module may import from `_shared/kernel` (this contract + kernel surface)
 *    but must never import another module.
 *  - Cross-module communication happens only through {@link Kernel.eventBus}.
 */

import type { EventType } from "../event-bus.ts";
import type { AgentRole } from "../types.ts";

/**
 * Declarative description of a table a module owns. The kernel uses this for
 * documentation, health checks, and to assert that a module's tables follow the
 * `<moduleId>_` prefix convention. Actual DDL is applied by the global,
 * idempotent migration runner (shared multi-tenant Postgres) — not per-tenant
 * `CREATE TABLE`, which is unsafe on a pooled connection.
 */
export interface DBSchema {
  /** Physical table name. Must start with `<moduleId>_`. */
  table: string;
  /** One-line description of what the table stores. */
  description: string;
  /** Whether rows are scoped by `workspace_id` (all tenant data must be). */
  workspaceScoped: boolean;
}

/**
 * Static, serialisable metadata every module declares. Analogous to the
 * `manifest.json` in the spec; represented as a typed const so the bundler and
 * TypeScript can validate it (JSON module imports are not enabled for the
 * functions build).
 */
export interface ModuleManifest {
  /** Stable identifier, e.g. "ecommerce" | "appointments". */
  id: string;
  /** Human-readable name shown in the install UI. */
  name: string;
  /** One-line description of what the module adds. */
  description: string;
  /** Semver of the module itself. */
  version: string;
  /** Minimum kernel version this module is compatible with (semver). */
  requiredKernelVersion: string;
  /** Capability slugs this module provides, e.g. ["inventory","orders"]. */
  capabilities: string[];
  /** Whether the module is generally available or still on the roadmap. */
  status: "available" | "coming_soon";
}

/**
 * The slice of kernel surface a module receives at {@link IVerticalAdapter.register}
 * time. Deliberately narrow: a module can publish/subscribe events and log, but
 * cannot reach into other modules or kernel internals.
 */
export interface Kernel {
  /** Kernel semver — modules assert compatibility against this. */
  version: string;
  eventBus: {
    /** Emit a cross-module event onto the durable kernel event bus. */
    emit(workspaceId: string, type: EventType, payload: Record<string, unknown>): Promise<void>;
    /** Subscribe an in-process handler to a kernel event type. */
    on(type: EventType, handler: (event: { workspaceId: string; type: EventType; payload: Record<string, unknown> }) => Promise<void>): void;
  };
  log: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * The standard interface every industry module must implement. The kernel
 * rejects any module whose adapter is missing a required field or whose
 * manifest fails validation.
 */
export interface IVerticalAdapter {
  /** Must equal {@link ModuleManifest.id}. */
  readonly id: string;
  /** Must equal {@link ModuleManifest.version}. */
  readonly version: string;
  /** Must equal {@link ModuleManifest.requiredKernelVersion}. */
  readonly requiredKernelVersion: string;

  /** The module's declared manifest. */
  getManifest(): ModuleManifest;

  /**
   * Called once at boot when the module is registered with the kernel. Use it
   * to wire event subscriptions. Must not perform tenant-specific work.
   */
  register(kernel: Kernel): void;

  /** Capability slugs, e.g. ["inventory","orders","cart"]. */
  getCapabilities(): string[];

  /**
   * System-prompt fragment injected into the agent context at request time for
   * a tenant that has this module installed. Should describe what the module
   * lets the agent do and how (available actions), NOT dump raw tenant data.
   * `agent` lets a module tailor guidance per agent role (e.g. sales vs
   * reception). Return "" to contribute nothing for that role.
   */
  getAgentSystemPrompt(agent: AgentRole): string;

  /** Tables this module owns (prefix-validated by the kernel). */
  getSchemas(): DBSchema[];

  /**
   * Tenant lifecycle: called when a tenant installs the module. Seeds or
   * registers tenant-scoped rows. MUST be idempotent (install may be retried).
   * MUST NOT run DDL.
   */
  onTenantInstall(workspaceId: string): Promise<void>;

  /**
   * Tenant lifecycle: called when a tenant uninstalls the module. Cleans up the
   * module's tenant-scoped rows. MUST be idempotent.
   */
  onTenantUninstall(workspaceId: string): Promise<void>;
}
