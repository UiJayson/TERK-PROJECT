import { randomUUID } from "node:crypto";
import { getConfig } from "./config.ts";
import { log } from "./logger.ts";
import { redactString } from "./redact.ts";

interface SentryDsn {
  publicKey: string;
  host: string;
  projectId: string;
}

function parseDsn(dsn: string): SentryDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) return null;
    return {
      publicKey: url.username,
      host: url.host,
      projectId,
    };
  } catch {
    return null;
  }
}

function stackFrames(stack?: string) {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(1, 12)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ filename: line }));
}

export async function captureException(
  error: unknown,
  context?: {
    workspaceId?: string | null;
    userId?: string | null;
    endpoint?: string;
    tags?: Record<string, string>;
  },
): Promise<void> {
  const dsn = getConfig().sentry.dsn;
  const err = error instanceof Error ? error : new Error(String(error));

  log.error("unhandled_exception", {
    endpoint: context?.endpoint,
    workspace_id: context?.workspaceId ?? undefined,
    user_id: context?.userId ?? undefined,
    error_name: err.name,
    error_message: redactString(err.message),
  });

  if (!dsn) return;

  const parsed = parseDsn(dsn);
  if (!parsed) return;

  const eventId = randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    tags: {
      ...(context?.workspaceId ? { workspace_id: context.workspaceId } : {}),
      ...(context?.userId ? { user_id: context.userId } : {}),
      ...(context?.endpoint ? { endpoint: context.endpoint } : {}),
      ...(context?.tags ?? {}),
    },
    exception: {
      values: [
        {
          type: err.name,
          value: redactString(err.message),
          stacktrace: { frames: stackFrames(err.stack) },
        },
      ],
    },
  };

  const envelopeHeader = JSON.stringify({ event_id: eventId, dsn });
  const itemHeader = JSON.stringify({ type: "event" });
  const body = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}\n`;

  try {
    await fetch(`https://${parsed.host}/api/${parsed.projectId}/envelope/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=ai-os/1.0`,
      },
      body,
    });
  } catch (sendError) {
    log.warn("sentry_send_failed", {
      error_message: sendError instanceof Error ? sendError.message : "send failed",
    });
  }
}
