/**
 * E-Commerce vertical module. Implements {@link IVerticalAdapter} to plug the
 * store's products/orders/returns capabilities into the kernel. Read-side
 * product data continues to flow through the existing catalog code; this
 * adapter owns the module's registration, capability declaration, per-tenant
 * lifecycle, and the agent-context fragment.
 */

import type { DBSchema, IVerticalAdapter, Kernel, ModuleManifest } from "../../kernel/adapter.ts";
import type { AgentRole } from "../../types.ts";
import { ensureDbConnection, getSql } from "../../db.ts";
import { ECOMMERCE_MANIFEST } from "./manifest.ts";
import { ecommerceAgentPrompt } from "./prompts/agent-context.ts";

class EcommerceAdapter implements IVerticalAdapter {
  readonly id = ECOMMERCE_MANIFEST.id;
  readonly version = ECOMMERCE_MANIFEST.version;
  readonly requiredKernelVersion = ECOMMERCE_MANIFEST.requiredKernelVersion;

  getManifest(): ModuleManifest {
    return ECOMMERCE_MANIFEST;
  }

  register(kernel: Kernel): void {
    // Cross-module reaction wired through the kernel event bus only. When a lead
    // qualifies, the store may later enrich it — kept as a lightweight log hook
    // here to demonstrate the boundary (no direct calls into other modules).
    kernel.eventBus.on("lead.qualified", async (event) => {
      kernel.log.info("ecommerce_lead_qualified", {
        workspaceId: event.workspaceId,
        module: this.id,
      });
    });
  }

  getCapabilities(): string[] {
    return [...ECOMMERCE_MANIFEST.capabilities];
  }

  getAgentSystemPrompt(agent: AgentRole): string {
    return ecommerceAgentPrompt(agent);
  }

  getSchemas(): DBSchema[] {
    return [
      {
        table: "ecommerce_settings",
        description: "Per-tenant storefront configuration (currency, checkout options).",
        workspaceScoped: true,
      },
      {
        table: "ecommerce_orders",
        description: "Orders placed through the store, scoped by tenant.",
        workspaceScoped: true,
      },
    ];
  }

  async onTenantInstall(workspaceId: string): Promise<void> {
    await ensureDbConnection();
    const db = getSql();
    // Idempotent seed of the tenant's storefront settings row.
    await db`
      INSERT INTO ecommerce_settings (workspace_id, currency, created_at)
      VALUES (${workspaceId}, 'USD', now())
      ON CONFLICT (workspace_id) DO NOTHING
    `;
  }

  async onTenantUninstall(workspaceId: string): Promise<void> {
    await ensureDbConnection();
    const db = getSql();
    // Remove the module's tenant-scoped rows. Orders are retained-then-removed
    // here per the module's ownership; adjust to soft-delete if retention is
    // required by policy.
    await db`DELETE FROM ecommerce_orders WHERE workspace_id = ${workspaceId}`;
    await db`DELETE FROM ecommerce_settings WHERE workspace_id = ${workspaceId}`;
  }
}

export const ecommerceModule: IVerticalAdapter = new EcommerceAdapter();
