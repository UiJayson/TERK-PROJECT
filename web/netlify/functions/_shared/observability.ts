import type { Context } from "@netlify/functions";
import { createId } from "./auth-crypto.ts";
import * as db from "./db.ts";
import { log } from "./logger.ts";
import { captureException } from "./sentry.ts";

export interface ObservabilityContext {
  workspaceId?: string | null;
  userId?: string | null;
}

let activeContext: ObservabilityContext = {};

export function setObservabilityContext(context: ObservabilityContext): void {
  activeContext = { ...activeContext, ...context };
}

export function getObservabilityContext(): ObservabilityContext {
  return activeContext;
}

export function clearObservabilityContext(): void {
  activeContext = {};
}

export async function recordPerformanceMetric(input: {
  category: "ai" | "db" | "webhook";
  operation: string;
  durationMs: number;
  workspaceId?: string | null;
  success?: boolean;
}): Promise<void> {
  const workspaceId = input.workspaceId ?? activeContext.workspaceId ?? null;
  log.performance({
    category: input.category,
    operation: input.operation,
    duration_ms: input.durationMs,
    workspace_id: workspaceId,
    success: input.success !== false,
  });

  const metricMap: Record<string, string> = {
    ai: "ai_latency_ms",
    db: "db_query_ms",
    webhook: "webhook_latency_ms",
  };

  try {
    await db.recordPerformanceLog({
      id: createId("perf"),
      workspaceId,
      category: input.category,
      operation: input.operation,
      durationMs: input.durationMs,
      success: input.success !== false,
    });

    await db.recordPerformanceMetric({
      id: createId("pmet"),
      workspaceId,
      date: new Date().toISOString().slice(0, 10),
      metricName: input.success === false ? "error_count" : metricMap[input.category],
      value: input.success === false ? 1 : input.durationMs,
      unit: input.success === false ? "count" : "ms",
    });
  } catch {
    // Metrics storage is best-effort when migration not applied.
  }
}

async function recordRequestMetric(input: {
  endpoint: string;
  method: string;
  status: number;
  latencyMs: number;
  workspaceId?: string | null;
  userId?: string | null;
  isError: boolean;
}): Promise<void> {
  log.request({
    endpoint: input.endpoint,
    method: input.method,
    status: input.status,
    latency_ms: input.latencyMs,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    is_error: input.isError,
  });

  try {
    await db.recordRequestLog({
      id: createId("reqlog"),
      workspaceId: input.workspaceId,
      userId: input.userId,
      endpoint: input.endpoint,
      method: input.method,
      status: input.status,
      latencyMs: input.latencyMs,
      isError: input.isError,
    });
  } catch {
    // Best-effort persistence.
  }
}

export function withObservability(
  handler: (req: Request, context: Context) => Promise<Response>,
  endpoint?: string,
) {
  return async (req: Request, context: Context): Promise<Response> => {
    clearObservabilityContext();
    const started = performance.now();
    const path = endpoint ?? new URL(req.url).pathname;
    let status = 500;

    try {
      const response = await handler(req, context);
      status = response.status;
      return response;
    } catch (error) {
      const ctx = getObservabilityContext();
      await captureException(error, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        endpoint: path,
      });
      if (ctx.workspaceId) {
        try {
          const { publish } = await import("./event-bus.ts");
          await publish(ctx.workspaceId, "error.occurred", {
            error: error instanceof Error ? error.message : String(error),
            message: error instanceof Error ? error.message : "Request failed",
            endpoint: path,
            critical: status >= 500,
          });
        } catch {
          // Best-effort event publish.
        }
      }
      throw error;
    } finally {
      const ctx = getObservabilityContext();
      const latencyMs = Math.round(performance.now() - started);
      const isError = status >= 500;
      await recordRequestMetric({
        endpoint: path,
        method: req.method,
        status,
        latencyMs,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        isError,
      });
      clearObservabilityContext();
    }
  };
}

export async function timedOperation<T>(
  input: {
    category: "ai" | "db" | "webhook";
    operation: string;
    workspaceId?: string | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    const result = await fn();
    await recordPerformanceMetric({
      category: input.category,
      operation: input.operation,
      durationMs: Math.round(performance.now() - started),
      workspaceId: input.workspaceId,
      success: true,
    });
    return result;
  } catch (error) {
    await recordPerformanceMetric({
      category: input.category,
      operation: input.operation,
      durationMs: Math.round(performance.now() - started),
      workspaceId: input.workspaceId,
      success: false,
    });
    throw error;
  }
}
