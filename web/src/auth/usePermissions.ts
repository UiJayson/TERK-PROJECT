import { useAuth } from "../auth/AuthContext";
import type { WorkspaceRole } from "../auth/types";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  staff: 1,
};

export function usePermissions() {
  const { role } = useAuth();

  function hasMinimum(required: WorkspaceRole): boolean {
    if (!role) return false;
    return ROLE_RANK[role] >= ROLE_RANK[required];
  }

  return {
    role,
    canManageAgents: hasMinimum("admin"),
    canManageKnowledge: hasMinimum("admin"),
    canDeleteKnowledge: hasMinimum("admin"),
    canManageChannels: hasMinimum("admin"),
    canManageSettings: hasMinimum("admin"),
    canWriteConversations: hasMinimum("admin"),
    isStaff: role === "staff",
  };
}
