import type { ModuleManifest } from "../../kernel/adapter.ts";

/**
 * Appointments module manifest. Covers calendar/availability/bookings for local
 * professional services (salons, consultants, clinics-without-compliance).
 */
export const APPOINTMENTS_MANIFEST: ModuleManifest = {
  id: "appointments",
  name: "Appointments",
  description:
    "Calendar, availability, bookings, staff scheduling and reminders for service businesses.",
  version: "1.0.0",
  requiredKernelVersion: "1.0.0",
  capabilities: ["calendar", "availability", "bookings", "staff_scheduling", "reminders"],
  status: "available",
};
