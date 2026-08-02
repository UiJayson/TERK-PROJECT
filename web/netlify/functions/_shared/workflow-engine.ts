import { createId } from "./auth-crypto.ts";
import * as db from "./db.ts";
import { sendEmail, renderEmailTemplate } from "./email.ts";
import { log } from "./logger.ts";
import { getSiteUrl } from "./config.ts";
import { sendTextMessage } from "./whatsapp-sender.ts";
import type { RuntimeLead } from "./runtime-store.ts";

export type WorkflowTrigger = db.WorkflowTriggerType;
export type WorkflowStep = db.WorkflowStep;

const MAX_STEP_ITERATIONS = 50;

function parseDelayMs(config: Record<string, unknown>): number {
  const duration = Number(config.duration ?? 0);
  const unit = String(config.unit ?? "hours");
  if (unit === "minutes") return duration * 60 * 1000;
  if (unit === "days") return duration * 24 * 60 * 60 * 1000;
  return duration * 60 * 60 * 1000;
}

function evaluateCondition(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): boolean {
  const field = String(config.field ?? "");
  const operator = String(config.operator ?? "equals");
  const expected = config.value;
  const actual = context[field];

  switch (operator) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "not_equals":
      return actual !== expected;
    case "greater_than":
      return Number(actual) > Number(expected);
    case "less_than":
      return Number(actual) < Number(expected);
    default:
      return actual === expected;
  }
}

async function executeStep(
  workspaceId: string,
  step: WorkflowStep,
  context: Record<string, unknown>,
): Promise<{ nextIndex: number; context: Record<string, unknown>; waitUntil?: string }> {
  switch (step.type) {
    case "wait": {
      const delayMs = parseDelayMs(step.config);
      const waitUntil = new Date(Date.now() + delayMs).toISOString();
      return { nextIndex: -1, context, waitUntil };
    }

    case "condition": {
      const passes = evaluateCondition(step.config, context);
      const thenIndex = Number(step.config.thenStep ?? -1);
      const elseIndex = Number(step.config.elseStep ?? -1);
      return { nextIndex: passes ? thenIndex : elseIndex, context };
    }

    case "send_email": {
      const to = String(context.leadEmail ?? context.email ?? step.config.to ?? "");
      if (to) {
        const subject = String(step.config.subject ?? "[AI OS] Message from your business");
        const body = String(step.config.body ?? step.config.template ?? "Hello from your AI Business OS workflow.");
        const template = step.config.templateName as Parameters<typeof renderEmailTemplate>[0] | undefined;
        await sendEmail({
          to,
          subject,
          text: body,
          html: template
            ? renderEmailTemplate(template, {
                customerName: String(context.customerName ?? context.name ?? "there"),
                message: body,
                dashboardUrl: getSiteUrl(),
                email: to,
                phone: String(context.phone ?? "—"),
                interest: String(context.interest ?? "—"),
                budget: String(context.budget ?? "—"),
                timeline: String(context.timeline ?? "—"),
                date: String(context.appointmentDate ?? "—"),
                time: String(context.appointmentTime ?? "—"),
                channel: String(context.channel ?? "email"),
              })
            : `<p>${body}</p>`,
        });
      }
      return { nextIndex: -1, context: { ...context, emailSent: true } };
    }

    case "send_whatsapp": {
      const phone = String(context.leadPhone ?? context.phone ?? step.config.to ?? "");
      const text = String(step.config.message ?? step.config.body ?? "Follow-up from your business.");
      if (phone) {
        const channelConfig = await db.getChannelConfig(workspaceId);
        const whatsapp = channelConfig?.whatsapp as Record<string, unknown> | undefined;
        const phoneNumberId = whatsapp?.phoneNumberId as string | undefined;
        if (phoneNumberId && whatsapp?.accessTokenEnc) {
          const { decryptSecret } = await import("./secret-crypto.ts");
          const accessToken = decryptSecret(String(whatsapp.accessTokenEnc));
          await sendTextMessage(phone.replace(/\D/g, ""), text, phoneNumberId, accessToken);
        }
      }
      return { nextIndex: -1, context: { ...context, whatsappSent: true } };
    }

    case "update_lead_status": {
      const leadId = String(context.leadId ?? "");
      const status = String(step.config.status ?? "contacted");
      if (leadId) {
        await db.updateLeadStatus(workspaceId, leadId, status as RuntimeLead["status"]);
      }
      return { nextIndex: -1, context: { ...context, leadStatus: status } };
    }

    case "assign_to_agent": {
      const agent = String(step.config.agent ?? "reception");
      return { nextIndex: -1, context: { ...context, assignedAgent: agent } };
    }

    default:
      return { nextIndex: -1, context };
  }
}

export async function createWorkflow(
  workspaceId: string,
  name: string,
  triggers: WorkflowTrigger[],
  steps: WorkflowStep[],
): Promise<db.WorkflowRecord> {
  return db.saveWorkflow(workspaceId, {
    id: createId("wf"),
    name,
    triggers,
    steps,
    status: "active",
    isPrebuilt: false,
  });
}

export async function executeWorkflow(
  workspaceId: string,
  workflowId: string,
  context: Record<string, unknown> = {},
  existingExecutionId?: string,
): Promise<db.WorkflowExecutionRecord> {
  const workflow = await db.getWorkflow(workspaceId, workflowId);
  if (!workflow) {
    throw new Error("Workflow not found");
  }

  let execution: db.WorkflowExecutionRecord;

  if (existingExecutionId) {
    const existing = await db.getWorkflowExecution(workspaceId, existingExecutionId);
    if (!existing) throw new Error("Execution not found");
    execution = existing;
  } else {
    execution = await db.saveWorkflowExecution(workspaceId, {
      id: createId("wfx"),
      workflowId,
      status: "running",
      currentStepIndex: 0,
      context,
      result: null,
      error: null,
      scheduledAt: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
  }

  let stepIndex = execution.currentStepIndex;
  let stepContext = { ...execution.context, ...context };
  const stepLog: Array<Record<string, unknown>> = [];
  let iterations = 0;

  while (stepIndex < workflow.steps.length && iterations < MAX_STEP_ITERATIONS) {
    iterations += 1;
    const step = workflow.steps[stepIndex]!;

    try {
      const result = await executeStep(workspaceId, step, stepContext);
      stepLog.push({ step: stepIndex, type: step.type, status: "ok" });

      if (result.waitUntil) {
        await db.saveWorkflowExecution(workspaceId, {
          ...execution,
          status: "waiting",
          currentStepIndex: stepIndex + 1,
          context: result.context,
          scheduledAt: result.waitUntil,
        });
        return (await db.getWorkflowExecution(workspaceId, execution.id))!;
      }

      stepContext = result.context;
      stepIndex = result.nextIndex === -1 ? stepIndex + 1 : result.nextIndex;
    } catch (error) {
      const message = error instanceof Error ? error.message : "step failed";
      await db.saveWorkflowExecution(workspaceId, {
        ...execution,
        status: "failed",
        currentStepIndex: stepIndex,
        context: stepContext,
        error: message,
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  const completed = await db.saveWorkflowExecution(workspaceId, {
    ...execution,
    status: "completed",
    currentStepIndex: stepIndex,
    context: stepContext,
    result: { steps: stepLog },
    completedAt: new Date().toISOString(),
  });

  return completed;
}

export async function getWorkflowStatus(
  workspaceId: string,
  workflowId: string,
): Promise<{
  workflow: db.WorkflowRecord | null;
  executions: db.WorkflowExecutionRecord[];
  stats: Awaited<ReturnType<typeof db.getWorkflowStats>>;
}> {
  const [workflow, executions, stats] = await Promise.all([
    db.getWorkflow(workspaceId, workflowId),
    db.listWorkflowExecutions(workspaceId, workflowId, 20),
    db.getWorkflowStats(workspaceId),
  ]);

  return { workflow, executions, stats };
}

export async function triggerWorkflowsByEvent(
  workspaceId: string,
  trigger: WorkflowTrigger,
  context: Record<string, unknown>,
): Promise<string[]> {
  const workflows = await db.listWorkflowsByTrigger(workspaceId, trigger);
  const executionIds: string[] = [];

  for (const workflow of workflows) {
    try {
      const execution = await executeWorkflow(workspaceId, workflow.id, context);
      executionIds.push(execution.id);
    } catch (error) {
      log.warn("workflow_trigger_failed", {
        workspaceId,
        workflowId: workflow.id,
        trigger,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return executionIds;
}

export async function resumeDueWorkflowExecutions(): Promise<number> {
  const due = await db.listDueWorkflowExecutions(50);
  let resumed = 0;

  for (const execution of due) {
    try {
      await executeWorkflow(
        execution.workspaceId,
        execution.workflowId,
        execution.context,
        execution.id,
      );
      resumed += 1;
    } catch (error) {
      log.warn("workflow_resume_failed", {
        executionId: execution.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return resumed;
}

export const PREBUILT_WORKFLOWS: Array<{
  name: string;
  triggers: WorkflowTrigger[];
  steps: WorkflowStep[];
}> = [
  {
    name: "New Lead Nurture",
    triggers: ["new_lead"],
    steps: [
      { type: "wait", config: { duration: 1, unit: "hours" } },
      {
        type: "send_email",
        config: {
          subject: "Welcome — glad you reached out!",
          body: "Thanks for your interest. Here is a quick overview of how we can help.",
          templateName: "lead",
        },
      },
      { type: "wait", config: { duration: 1, unit: "days" } },
      {
        type: "send_email",
        config: {
          subject: "See how others succeeded",
          body: "Here is a case study showing results similar customers achieved with us.",
        },
      },
      { type: "wait", config: { duration: 3, unit: "days" } },
      {
        type: "send_whatsapp",
        config: {
          message: "Hi! Just checking in — any questions about our services? Happy to help.",
        },
      },
    ],
  },
  {
    name: "Appointment Reminder",
    triggers: ["appointment_booked"],
    steps: [
      { type: "wait", config: { duration: 24, unit: "hours", beforeAppointment: true } },
      {
        type: "send_whatsapp",
        config: {
          message: "Reminder: your appointment is coming up soon. Reply if you need to reschedule.",
        },
      },
    ],
  },
  {
    name: "Churn Prevention",
    triggers: ["subscription_expired"],
    steps: [
      {
        type: "send_email",
        config: {
          subject: "We'd love to have you back",
          body: "Your subscription has expired. Renew now to keep your AI agents running.",
        },
      },
      { type: "wait", config: { duration: 3, unit: "days" } },
      {
        type: "send_whatsapp",
        config: {
          message: "Your AI Business OS subscription expired. Reply to renew or get help.",
        },
      },
    ],
  },
];

export async function seedPrebuiltWorkflows(workspaceId: string): Promise<db.WorkflowRecord[]> {
  const existing = await db.listWorkflows(workspaceId);
  const existingNames = new Set(existing.map((w) => w.name));
  const created: db.WorkflowRecord[] = [];

  for (const template of PREBUILT_WORKFLOWS) {
    if (existingNames.has(template.name)) continue;
    const workflow = await db.saveWorkflow(workspaceId, {
      id: createId("wf"),
      name: template.name,
      triggers: template.triggers,
      steps: template.steps,
      status: "active",
      isPrebuilt: true,
    });
    created.push(workflow);
  }

  return created;
}
