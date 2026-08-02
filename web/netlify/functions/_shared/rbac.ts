import type { WorkspaceRole } from "./auth-types.ts";
import { jsonResponse } from "./auth-http.ts";

export const ROLES = ["owner", "admin", "staff"] as const;

const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  staff: 1,
};

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (ROLES as readonly string[]).includes(value);
}

export function hasMinimumRole(userRole: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[required];
}

export function canManageAgents(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, "admin");
}

export function canManageKnowledge(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, "admin");
}

export function canDeleteKnowledge(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, "admin");
}

export function canManageChannels(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, "admin");
}

export function canManageSettings(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, "admin");
}

export function canWriteConversations(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, "admin");
}

export function assertPermission(
  role: WorkspaceRole,
  allowed: readonly WorkspaceRole[],
): Response | null {
  if (!allowed.includes(role)) {
    return jsonResponse({ error: "Forbidden — insufficient permissions." }, { status: 403 });
  }
  return null;
}
