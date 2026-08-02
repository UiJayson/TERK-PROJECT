import type { Config } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { sendDueAppointmentReminders } from "./_shared/calendar.ts";

async function handler() {
  try {
    const sent = await sendDueAppointmentReminders();
    return new Response(JSON.stringify({ ok: true, remindersSent: sent }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Appointment reminder job failed:", error);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
};

export const config: Config = {
  schedule: "*/15 * * * *",
};

export default withObservability(handler);
