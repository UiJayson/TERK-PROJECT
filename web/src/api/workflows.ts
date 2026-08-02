import { getStoredToken } from "../auth/api";

async function request(path: string, init: RequestInit = {}) {
  const token = getStoredToken();
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error ?? "Request failed"));
  }
  return data;
}

export type WorkflowTrigger =
  | "new_lead"
  | "appointment_booked"
  | "conversation_escalated"
  | "subscription_expired"
  | "scheduled";

export type WorkflowStepType =
  | "send_email"
  | "send_whatsapp"
  | "update_lead_status"
  | "assign_to_agent"
  | "wait"
  | "condition";

export interface WorkflowStep {
  type: WorkflowStepType;
  config: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  triggers: WorkflowTrigger[];
  steps: WorkflowStep[];
  status: "active" | "paused";
  isPrebuilt: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: "pending" | "running" | "waiting" | "completed" | "failed";
  currentStepIndex: number;
  context: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface WorkflowStats {
  activeWorkflows: number;
  totalExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  successRate: number;
}

export async function fetchWorkflowsDashboard(): Promise<{
  workflows: Workflow[];
  executions: WorkflowExecution[];
  stats: WorkflowStats;
}> {
  const data = await request("/api/workflows");
  return {
    workflows: (data.workflows as Workflow[]) ?? [],
    executions: (data.executions as WorkflowExecution[]) ?? [],
    stats: data.stats as WorkflowStats,
  };
}

export async function createWorkflow(input: {
  name: string;
  triggers: WorkflowTrigger[];
  steps: WorkflowStep[];
}): Promise<Workflow> {
  const data = await request("/api/workflows", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.workflow as Workflow;
}

export async function executeWorkflow(
  workflowId: string,
  context?: Record<string, unknown>,
): Promise<WorkflowExecution> {
  const data = await request("/api/workflows/execute", {
    method: "POST",
    body: JSON.stringify({ workflowId, context: context ?? {} }),
  });
  return data.execution as WorkflowExecution;
}

export async function updateWorkflowStatus(
  workflowId: string,
  status: "active" | "paused",
): Promise<Workflow> {
  const data = await request(`/api/workflows/${workflowId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return data.workflow as Workflow;
}

export async function seedPrebuiltWorkflows(): Promise<Workflow[]> {
  const data = await request("/api/workflows/seed", { method: "POST" });
  return (data.workflows as Workflow[]) ?? [];
}
