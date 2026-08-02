import { createId } from "./auth-crypto.ts";
import type {
  AgentId,
  PasswordResetRecord,
  UserRecord,
  WorkspaceAgentConfig,
  WorkspaceRecord,
  WorkspaceResources,
  WorkspaceRole,
} from "./auth-types.ts";
import { AGENT_IDS } from "./agents-catalog.ts";
import * as db from "./db.ts";

export function emptyWorkspaceResources(): WorkspaceResources {
  return {
    agents: ["reception"],
    knowledge: [],
    conversations: [],
    analytics: [],
    leads: [],
  };
}

export function defaultAgentConfigs(now = new Date().toISOString()): WorkspaceAgentConfig[] {
  return AGENT_IDS.map((id) => ({
    id,
    enabled: id === "reception",
    lastUpdated: now,
    notes: "",
  }));
}

function ensureWorkspaceShape(workspace: WorkspaceRecord): WorkspaceRecord {
  const now = workspace.createdAt || new Date().toISOString();
  const agentConfigs =
    workspace.agentConfigs?.length === AGENT_IDS.length
      ? workspace.agentConfigs
      : defaultAgentConfigs(now);

  const resources = workspace.resources ?? emptyWorkspaceResources();
  if (!resources.agents?.length) {
    resources.agents = agentConfigs.filter((agent) => agent.enabled).map((agent) => agent.id);
  }

  return {
    ...workspace,
    publicKey: workspace.publicKey || createId("pk"),
    resources,
    agentConfigs,
  };
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  return db.getUserByEmail(email);
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return db.getUserById(id);
}

export async function findWorkspaceById(id: string): Promise<WorkspaceRecord | null> {
  const workspace = await db.getWorkspace(id);
  if (!workspace) return null;
  return ensureWorkspaceShape(workspace);
}

export async function findWorkspaceByPublicKey(
  publicKey: string,
): Promise<WorkspaceRecord | null> {
  const workspace = await db.getWorkspaceByPublicKey(publicKey);
  if (!workspace) return null;
  return ensureWorkspaceShape(workspace);
}

export async function listWorkspaceIds(): Promise<string[]> {
  return db.listWorkspaceIds();
}

export async function getWorkspaceRoleForUser(
  workspaceId: string,
  userId: string,
  ownerId: string,
): Promise<WorkspaceRole> {
  const role = await db.getWorkspaceUserRole(workspaceId, userId);
  if (role) return role;
  return ownerId === userId ? "owner" : "staff";
}

export async function createUserWithWorkspace(input: {
  userId: string;
  email: string;
  name: string;
  passwordHash: string;
  workspaceId: string;
  companyName: string;
}): Promise<{ user: UserRecord; workspace: WorkspaceRecord }> {
  const existing = await findUserByEmail(input.email);
  if (existing) throw new Error("EMAIL_TAKEN");

  const now = new Date().toISOString();
  const agentConfigs = defaultAgentConfigs(now);
  const resources = emptyWorkspaceResources();
  resources.agents = agentConfigs.filter((agent) => agent.enabled).map((agent) => agent.id);
  const publicKey = createId("pk");

  await db.createUserWithWorkspace({
    userId: input.userId,
    email: input.email,
    name: input.name,
    passwordHash: input.passwordHash,
    workspaceId: input.workspaceId,
    companyName: input.companyName,
    publicKey,
    resources,
    agentConfigs,
  });

  const user = await findUserById(input.userId);
  const workspace = await findWorkspaceById(input.workspaceId);
  if (!user || !workspace) throw new Error("CREATE_FAILED");

  return { user, workspace };
}

export async function updateUserPassword(userId: string, passwordHash: string): Promise<void> {
  await db.updateUserPassword(userId, passwordHash);
}

export async function savePasswordReset(record: PasswordResetRecord): Promise<void> {
  await db.savePasswordReset(record);
}

export async function consumePasswordReset(tokenHash: string): Promise<PasswordResetRecord | null> {
  return db.consumePasswordReset(tokenHash);
}

export async function updateUserProfile(
  userId: string,
  patch: { name?: string },
): Promise<UserRecord> {
  if (patch.name?.trim()) {
    await db.updateUserProfile(userId, patch.name.trim());
  }
  const user = await findUserById(userId);
  if (!user) throw new Error("USER_NOT_FOUND");
  return user;
}

export async function updateWorkspaceProfile(
  workspaceId: string,
  patch: { name?: string },
): Promise<WorkspaceRecord> {
  if (patch.name?.trim()) {
    await db.updateWorkspaceProfile(workspaceId, patch.name.trim());
  }
  const workspace = await findWorkspaceById(workspaceId);
  if (!workspace) throw new Error("WORKSPACE_NOT_FOUND");
  return workspace;
}

export async function setWorkspaceKnowledgeIds(
  workspaceId: string,
  knowledgeIds: string[],
): Promise<void> {
  const workspace = await findWorkspaceById(workspaceId);
  if (!workspace) return;
  workspace.resources.knowledge = knowledgeIds;
  await db.updateWorkspaceResources(workspaceId, workspace.resources);
}

export async function updateWorkspaceAgent(
  workspaceId: string,
  agentId: AgentId,
  patch: { enabled?: boolean; notes?: string },
): Promise<WorkspaceAgentConfig> {
  return db.updateAgent(workspaceId, agentId, patch);
}
