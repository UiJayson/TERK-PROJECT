import type { NotificationPreferences } from "./notification-preferences.ts";

export type WorkspaceRole = "owner" | "admin" | "staff";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  workspaceIds: string[];
  sessionVersion: number;
}

export interface WorkspaceResources {
  agents: string[];
  knowledge: string[];
  conversations: string[];
  analytics: string[];
  leads: string[];
}

export type AgentId = "reception" | "sales" | "marketing";

/** Per-workspace agent state. Behavior prompts stay in agents/*.md. */
export interface WorkspaceAgentConfig {
  id: AgentId;
  enabled: boolean;
  lastUpdated: string;
  notes: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  publicKey: string;
  resources: WorkspaceResources;
  agentConfigs: WorkspaceAgentConfig[];
}

export interface PasswordResetRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  used: boolean;
}

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  workspaceId: string;
  role: WorkspaceRole;
  sessionVersion: number;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export interface PublicWorkspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  publicKey: string;
  resources: WorkspaceResources;
  agentConfigs: WorkspaceAgentConfig[];
}

export interface AuthResponse {
  user: PublicUser;
  workspace: PublicWorkspace;
  role: WorkspaceRole;
  notificationPreferences?: NotificationPreferences;
}

export interface AuthenticatedSession extends AuthResponse {}
