/**
 * Appointments vertical module. Plugs calendar/availability/booking
 * capabilities into the kernel. Booking writes and reminders continue to run
 * through the existing calendar code (which already publishes
 * `appointment.booked` on the kernel event bus); this adapter owns the module's
 * registration, capabilities, per-tenant lifecycle, and agent-context fragment.
 *
 * Note on table ownership: the live availability calendar currently lives in the
 * pre-existing `availability_slots` table. Logically it belongs to this module.
 * Renaming it to `appointments_availability` is the destructive migration
 * deferred out of the MVP (see migration 020 header); until then this adapter
 * declares only the net-new `appointments_settings` table it fully owns.
 */

import type { DBSchema, IVerticalAdapter, Kernel, ModuleManifest } from "../../kernel/adapter.ts";
import type { AgentRole } from "../../types.ts";
import { ensureDbConnection, getSql } from "../../db.ts";
import { ensureDefaultSlots } from "../../calendar.ts";
import { APPOINTMENTS_MANIFEST } from "./manifest.ts";
import { appointmentsAgentPrompt } from "./prompts/agent-context.ts";

class AppointmentsAdapter implements IVerticalAdapter {
  readonly id = APPOINTMENTS_MANIFEST.id;
  readonly version = APPOINTMENTS_MANIFEST.version;
  readonly requiredKernelVersion = APPOINTMENTS_MANIFEST.requiredKernelVersion;

  getManifest(): ModuleManifest {
    return APPOINTMENTS_MANIFEST;
  }

  register(kernel: Kernel): void {
    kernel.eventBus.on("appointment.booked", async (event) => {
      kernel.log.info("appointments_booking_observed", {
        workspaceId: event.workspaceId,
        module: this.id,
      });
    });
  }

  getCapabilities(): string[] {
    return [...APPOINTMENTS_MANIFEST.capabilities];
  }

  getAgentSystemPrompt(agent: AgentRole): string {
    return appointmentsAgentPrompt(agent);
  }

  getSchemas(): DBSchema[] {
    return [
      {
        table: "appointments_settings",
        description: "Per-tenant booking configuration (slot length, lead time, timezone).",
        workspaceScoped: true,
      },
    ];
  }

  async onTenantInstall(workspaceId: string): Promise<void> {
    await ensureDbConnection();
    const db = getSql();
    await db`
      INSERT INTO appointments_settings (workspace_id, created_at)
      VALUES (${workspaceId}, now())
      ON CONFLICT (workspace_id) DO NOTHING
    `;
    // Seed a default availability calendar so the agent has slots to offer
    // immediately after install. Idempotent (no-ops if slots already exist).
    await ensureDefaultSlots(workspaceId);
  }

  async onTenantUninstall(workspaceId: string): Promise<void> {
    await ensureDbConnection();
    const db = getSql();
    // Remove the module's own settings row. Existing booked appointments in
    // `availability_slots` are intentionally NOT deleted here to avoid losing
    // customer commitments; clearing them would be a separate, explicit action.
    await db`DELETE FROM appointments_settings WHERE workspace_id = ${workspaceId}`;
  }
}

export const appointmentsModule: IVerticalAdapter = new AppointmentsAdapter();
