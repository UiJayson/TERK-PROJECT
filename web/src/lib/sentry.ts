type SentryDsn = {
  publicKey: string;
  host: string;
  projectId: string;
};

function parseDsn(dsn: string): SentryDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) return null;
    return { publicKey: url.username, host: url.host, projectId };
  } catch {
    return null;
  }
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b\+?\d[\d\s().-]{7,}\d\b/g, "[REDACTED_PHONE]");
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

let initialized = false;
let sentryUser: { id: string; workspaceId?: string } | null = null;

export function initSentry(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("error", (event) => {
    void captureException(event.error ?? new Error(event.message));
  });

  window.addEventListener("unhandledrejection", (event) => {
    void captureException(event.reason);
  });
}

export async function captureException(
  error: unknown,
  context?: {
    workspaceId?: string | null;
    userId?: string | null;
    tags?: Record<string, string>;
  },
): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  const err = error instanceof Error ? error : new Error(String(error));

  if (!dsn) {
    console.error("[sentry-disabled]", err);
    return;
  }

  const parsed = parseDsn(dsn);
  if (!parsed) return;

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: "error",
    tags: {
      ...(context?.workspaceId ?? sentryUser?.workspaceId
        ? { workspace_id: context?.workspaceId ?? sentryUser?.workspaceId }
        : {}),
      ...(context?.userId ?? sentryUser?.id
        ? { user_id: context?.userId ?? sentryUser?.id }
        : {}),
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
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=ai-os-web/1.0`,
      },
      body,
      keepalive: true,
    });
  } catch {
    // Ignore client-side Sentry transport failures.
  }
}

export function setSentryUser(input: {
  id: string;
  workspaceId?: string;
}): void {
  sentryUser = input;
}
