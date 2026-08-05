import type { AgentRole } from "../../../types.ts";

/**
 * System-prompt fragments the Appointments module injects per agent role. The
 * live availability calendar is injected separately at request time and only
 * when this module is active for the tenant.
 */
export function appointmentsAgentPrompt(agent: AgentRole): string {
  switch (agent) {
    case "reception":
      return [
        "### Appointments (reception)",
        "This business takes bookings. When a customer wants to book, use the available",
        "slots provided in context and the book_appointment action once they confirm a time.",
        "- Only offer slots that appear in the calendar context; never invent availability.",
        "- Collect the customer's name and a contact (phone or email) before confirming.",
        "- If no suitable slot is shown, offer to note their preference and follow up.",
      ].join("\n");
    case "sales":
      return [
        "### Appointments (sales)",
        "You can offer to book a consultation or demo using the availability calendar in context.",
      ].join("\n");
    default:
      return "";
  }
}
