import type { AgentRole } from "./types.ts";

const toolMatrix: Record<string, AgentRole[]> = {
  "knowledge.search": ["reception", "sales", "marketing"],
  "crm.contact.read": ["reception", "sales"],
  "crm.contact.write": ["sales"],
  "crm.opportunity.read": ["sales"],
  "crm.opportunity.write": ["sales"],
  "calendar.availability.read": ["reception", "sales"],
  "calendar.booking.create_pending": ["reception"],
  "calendar.booking.create_sales": ["sales"],
  "email.draft.create": ["reception", "sales", "marketing"],
  "email.send": ["reception", "sales", "marketing"],
  "analytics.read": ["marketing"],
  "analytics.sales_attribution.read": ["sales"],
  "messaging.reply.draft": ["reception", "sales"],
  "messaging.send": ["reception", "sales"],
};

export type ToolAccessResult = "allowed" | "permission_denied";

export function checkToolAccess(agent: AgentRole, tool: string): ToolAccessResult {
  const allowedAgents = toolMatrix[tool];
  if (!allowedAgents) {
    return "permission_denied";
  }

  return allowedAgents.includes(agent) ? "allowed" : "permission_denied";
}

export function getAllowedTools(agent: AgentRole): string[] {
  return Object.entries(toolMatrix)
    .filter(([, agents]) => agents.includes(agent))
    .map(([tool]) => tool);
}
