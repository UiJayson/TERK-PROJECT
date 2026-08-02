import { createId } from "./auth-crypto.ts";
import * as db from "./db.ts";
import { notifyBusinessOwner } from "./notifications.ts";
import {
  checkUsageLimit,
  getUsageSnapshot,
  type UsageCheckResult,
  type UsageSnapshot,
} from "./usage-limits.ts";

export interface AvailabilitySlot {
  id: string;
  workspaceId: string;
  date: string;
  startTime: string;
  endTime: string;
  isBooked: boolean;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  reminderSent: boolean;
  notes?: string;
}

const DEFAULT_HOURS = [9, 10, 11, 13, 14, 15, 16];

function formatTime(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00:00`;
}

function formatDisplayTime(time: string): string {
  const [hour] = time.split(":");
  const h = Number(hour);
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display}:00 ${suffix}`;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function ensureDefaultSlots(workspaceId: string, daysAhead = 14): Promise<void> {
  const existing = await db.countAvailabilitySlots(workspaceId);
  if (existing > 0) return;

  const today = new Date();
  const slots: Array<Omit<AvailabilitySlot, "reminderSent">> = [];

  for (let offset = 1; offset <= daysAhead; offset++) {
    const day = addDays(today, offset);
    const dayOfWeek = day.getDay();
    if (dayOfWeek === 0) continue;

    const date = toDateString(day);
    for (const hour of DEFAULT_HOURS) {
      slots.push({
        id: createId("slot"),
        workspaceId,
        date,
        startTime: formatTime(hour),
        endTime: formatTime(hour + 1),
        isBooked: false,
      });
    }
  }

  await db.insertAvailabilitySlots(workspaceId, slots);
}

export async function getAvailableSlots(
  workspaceId: string,
  date?: string,
): Promise<AvailabilitySlot[]> {
  await ensureDefaultSlots(workspaceId);
  return db.listAvailableSlots(workspaceId, date);
}

export async function bookSlot(input: {
  workspaceId: string;
  slotId: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
}): Promise<{ slot: AvailabilitySlot; confirmation: string }> {
  const slot = await db.bookAvailabilitySlot(input);
  if (!slot) {
    throw new Error("SLOT_UNAVAILABLE");
  }

  const confirmation = [
    `Appointment confirmed for ${slot.date} at ${formatDisplayTime(slot.startTime)}.`,
    slot.customerName ? `Name: ${slot.customerName}` : "",
    "We'll send a reminder about 1 hour before.",
  ]
    .filter(Boolean)
    .join(" ");

  await notifyBusinessOwner({
    workspaceId: input.workspaceId,
    type: "appointment_booked",
    title: "New appointment booked",
    customerName: slot.customerName,
    appointmentDate: slot.date,
    appointmentTime: formatDisplayTime(slot.startTime),
    body: confirmation,
    metadata: { slotId: slot.id, customerId: input.customerId },
  });

  const { incrementAppointmentUsage } = await import("./usage-limits.ts");
  await incrementAppointmentUsage(input.workspaceId);

  const { publish } = await import("./event-bus.ts");
  await publish(input.workspaceId, "appointment.booked", {
    slotId: slot.id,
    customerId: input.customerId,
    customerName: slot.customerName,
    customerPhone: slot.customerPhone,
    customerEmail: slot.customerEmail,
    appointmentDate: slot.date,
    appointmentTime: formatDisplayTime(slot.startTime),
    leadPhone: slot.customerPhone,
    leadEmail: slot.customerEmail,
    phone: slot.customerPhone,
    email: slot.customerEmail,
  });

  return { slot, confirmation };
}

export async function cancelSlot(input: {
  workspaceId: string;
  slotId: string;
}): Promise<{ slot: AvailabilitySlot; confirmation: string } | null> {
  const slot = await db.cancelAvailabilitySlot(input.workspaceId, input.slotId);
  if (!slot) return null;

  const confirmation = `Appointment on ${slot.date} at ${formatDisplayTime(slot.startTime)} has been cancelled.`;

  await notifyBusinessOwner({
    workspaceId: input.workspaceId,
    type: "appointment_booked",
    title: "Appointment cancelled",
    customerName: slot.customerName,
    body: confirmation,
    metadata: { slotId: slot.id },
  });

  return { slot, confirmation };
}

export async function findSlotByDateTime(
  workspaceId: string,
  date: string,
  startTime: string,
): Promise<AvailabilitySlot | null> {
  await ensureDefaultSlots(workspaceId);
  return db.findAvailabilitySlot(workspaceId, date, startTime);
}

export function formatCalendarForPrompt(slots: AvailabilitySlot[]): string {
  if (slots.length === 0) {
    return [
      "## Appointment calendar",
      "",
      "No open slots for the requested date. Offer the next available day or ask the customer for another preference.",
    ].join("\n");
  }

  const lines = [
    "## Appointment calendar (available slots — use book_appointment action when customer confirms)",
    "",
  ];

  for (const slot of slots.slice(0, 12)) {
    lines.push(
      `- ${slot.id}: ${slot.date} ${formatDisplayTime(slot.startTime)}–${formatDisplayTime(slot.endTime)}`,
    );
  }

  lines.push(
    "",
    "To book: confirm date/time with the customer, then include in action_log: book_slot:<slot_id>",
  );

  return lines.join("\n");
}

export async function processBookingActionLog(
  workspaceId: string,
  actionLog: string[],
  customer: {
    customerId: string;
    name?: string;
    phone?: string;
    email?: string;
  },
): Promise<string | null> {
  const bookingAction = actionLog.find((action) => action.startsWith("book_slot:"));
  if (!bookingAction) return null;

  const slotId = bookingAction.slice("book_slot:".length).trim();
  if (!slotId) return null;

  try {
    const { confirmation } = await bookSlot({
      workspaceId,
      slotId,
      customerId: customer.customerId,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
    });
    return confirmation;
  } catch {
    return "That slot is no longer available. I can check other times for you.";
  }
}

export async function sendDueAppointmentReminders(): Promise<number> {
  const due = await db.listSlotsNeedingReminder();
  let sent = 0;

  for (const slot of due) {
    const channelConfig = await db.getChannelConfig(slot.workspaceId);
    const whatsapp = channelConfig?.whatsapp as Record<string, unknown> | undefined;
    if (!whatsapp?.phoneNumberId || !whatsapp?.accessTokenEnc || !slot.customerPhone) {
      continue;
    }

    try {
      const { decryptSecret } = await import("./secret-crypto.ts");
      const { sendTextMessage } = await import("./whatsapp.ts");
      const accessToken = decryptSecret(String(whatsapp.accessTokenEnc));

      await sendTextMessage({
        phone: slot.customerPhone.replace(/\D/g, ""),
        text: `Reminder: your appointment is in about 1 hour (${slot.date} at ${formatDisplayTime(slot.startTime)}). Reply if you need to reschedule.`,
        phoneNumberId: String(whatsapp.phoneNumberId),
        accessToken,
      });

      const { sendNotification } = await import("./notifications.ts");
      await sendNotification({
        workspaceId: slot.workspaceId,
        event: "appointment_reminder",
        title: "Appointment reminder sent",
        customerName: slot.customerName,
        message: `Reminder sent to ${slot.customerName ?? "customer"} for ${slot.date} at ${formatDisplayTime(slot.startTime)}.`,
        metadata: { slotId: slot.id },
      });

      await db.markSlotReminderSent(slot.id);
      sent += 1;
    } catch (error) {
      console.warn("Appointment reminder failed:", error);
    }
  }

  return sent;
}
