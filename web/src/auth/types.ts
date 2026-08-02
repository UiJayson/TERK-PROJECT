export type WorkspaceRole = "owner" | "admin" | "staff";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceResources {
  agents: string[];
  knowledge: string[];
  conversations: string[];
  analytics: string[];
  leads: string[];
}

export type AgentId = "reception" | "sales" | "marketing";
export type AgentRole = AgentId | "human_review";

export interface WorkspaceAgentConfig {
  id: AgentId;
  enabled: boolean;
  lastUpdated: string;
  notes: string;
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

export interface AuthSession {
  user: PublicUser;
  workspace: PublicWorkspace;
  role: WorkspaceRole;
}

export interface WorkspaceAgent {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  status: "active" | "paused";
  enabled: boolean;
  model: string;
  knowledgeSources: string[];
  channelsConnected: string[];
  lastUpdated: string;
  notes: string;
  prompt: string;
}
