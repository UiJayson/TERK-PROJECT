import { createId } from "./auth-crypto.ts";
import * as db from "./db.ts";
import { log } from "./logger.ts";
import { captureException } from "./sentry.ts";
import { sendNotification } from "./notifications.ts";
import { getSiteUrl } from "./config.ts";
import { triggerWorkflowsByEvent } from "./workflow-engine.ts";

export type EventType = db.EventType;

type EventHandler = (event: db.EventRecord) => Promise<void>;

const MAX_RETRIES = 3;

const handlers = new Map<EventType, EventHandler[]>();

function registerDefaultHandlers(): void {
  subscribe("conversation.started", async (event) => {
    log.info("event_conversation_started", {
      workspaceId: event.workspaceId,
      conversationId: event.payload.conversationId,
    });
  });

  subscribe("conversation.ended", async (event) => {
    log.info("event_conversation_ended", {
      workspaceId: event.workspaceId,
      conversationId: event.payload.conversationId,
      status: event.payload.status as string | number | undefined,
    });
  });

  subscribe("lead.qualified", async (event) => {
    await triggerWorkflowsByEvent(event.workspaceId, "new_lead", event.payload);
  });

  subscribe("appointment.booked", async (event) => {
    await triggerWorkflowsByEvent(event.workspaceId, "appointment_booked", event.payload);
  });

  subscribe("agent.handoff", async (event) => {
    log.info("event_agent_handoff", {
      workspaceId: event.workspaceId,
      from: event.payload.from,
      to: event.payload.to,
    });
  });

  subscribe("error.occurred", async (event) => {
    const error = event.payload.error;
    const critical = Boolean(event.payload.critical);

    if (error instanceof Error || typeof error === "string") {
      await captureException(error instanceof Error ? error : new Error(String(error)), {
        workspaceId: event.workspaceId,
        ...event.payload,
      });
    }

    if (critical) {
      await sendNotification({
        workspaceId: event.workspaceId,
        event: "bi_risk_alert",
        title: "Critical error occurred",
        message: String(event.payload.message ?? error ?? "An error occurred in the system"),
        link: `${getSiteUrl()}/app/analytics`,
        metadata: event.payload,
      });
    }
  });
}

let defaultsRegistered = false;

function ensureDefaults(): void {
  if (!defaultsRegistered) {
    // Set the flag BEFORE registering, because registerDefaultHandlers() calls
    // subscribe() → ensureDefaults() re-entrantly. Guarding first turns those
    // nested calls into plain handler appends instead of infinite recursion.
    defaultsRegistered = true;
    registerDefaultHandlers();
  }
}

export function subscribe(eventType: EventType, handler: EventHandler): void {
  ensureDefaults();
  const list = handlers.get(eventType) ?? [];
  list.push(handler);
  handlers.set(eventType, list);
}

export async function publish(
  workspaceId: string,
  eventType: EventType,
  payload: Record<string, unknown>,
): Promise<db.EventRecord> {
  return db.saveEvent(workspaceId, {
    id: createId("evt"),
    type: eventType,
    payload,
    status: "pending",
  });
}

async function dispatchEvent(event: db.EventRecord): Promise<void> {
  ensureDefaults();
  const eventHandlers = handlers.get(event.type) ?? [];

  for (const handler of eventHandlers) {
    await handler(event);
  }
}

export async function processEvents(limit = 100): Promise<{
  processed: number;
  failed: number;
  deadLettered: number;
}> {
  ensureDefaults();
  const pending = await db.listPendingEvents(limit);
  let processed = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const event of pending) {
    await db.updateEventStatus(event.workspaceId, event.id, { status: "processing" });

    try {
      await dispatchEvent(event);
      await db.updateEventStatus(event.workspaceId, event.id, {
        status: "completed",
        processedAt: new Date().toISOString(),
      });
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "dispatch failed";
      const retryCount = event.retryCount + 1;

      if (retryCount >= MAX_RETRIES) {
        await db.updateEventStatus(event.workspaceId, event.id, {
          status: "failed",
          retryCount,
          error: message,
          processedAt: new Date().toISOString(),
        });
        await db.saveDeadLetterEvent(event.workspaceId, {
          id: createId("dlq"),
          eventId: event.id,
          type: event.type,
          payload: event.payload,
          error: message,
          retryCount,
        });
        deadLettered += 1;
        log.error("event_dead_lettered", {
          eventId: event.id,
          type: event.type,
          workspaceId: event.workspaceId,
          error: message,
        });
      } else {
        await db.updateEventStatus(event.workspaceId, event.id, {
          status: "pending",
          retryCount,
          error: message,
        });
        failed += 1;
      }
    }
  }

  return { processed, failed, deadLettered };
}
