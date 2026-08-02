import { randomUUID } from "node:crypto";
import { redactValue } from "./redact.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  function?: string;
  workspaceId?: string | null;
  action?: string;
  durationMs?: number;
  status?: string | number;
  error?: string;
  requestId?: string;
  traceId?: string;
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  const payload = redactValue({
    level,
    message,
    timestamp: new Date().toISOString(),
    service: "ai-business-os",
    requestId: fields.requestId ?? randomUUID(),
    traceId: fields.traceId,
    function: fields.function,
    workspaceId: fields.workspaceId ?? undefined,
    action: fields.action ?? message,
    durationMs: fields.durationMs,
    status: fields.status,
    error: fields.error,
    ...fields,
  }) as Record<string, unknown>;

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const log = {
  debug(message: string, fields?: LogFields) {
    write("debug", message, fields);
  },
  info(message: string, fields?: LogFields) {
    write("info", message, fields);
  },
  warn(message: string, fields?: LogFields) {
    write("warn", message, fields);
  },
  error(message: string, fields?: LogFields) {
    write("error", message, fields);
  },
  request(fields: {
    endpoint: string;
    method: string;
    status: number;
    latency_ms: number;
    workspace_id?: string | null;
    user_id?: string | null;
    is_error?: boolean;
    requestId?: string;
    traceId?: string;
  }) {
    write("info", "api_request", {
      function: fields.endpoint,
      workspaceId: fields.workspace_id,
      action: "api_request",
      durationMs: fields.latency_ms,
      requestId: fields.requestId,
      traceId: fields.traceId,
      ...fields,
    });
  },
  performance(fields: {
    category: string;
    operation: string;
    duration_ms: number;
    workspace_id?: string | null;
    success?: boolean;
    requestId?: string;
  }) {
    write("info", "performance", {
      function: fields.category,
      workspaceId: fields.workspace_id,
      action: fields.operation,
      durationMs: fields.duration_ms,
      status: fields.success === false ? "error" : "ok",
      requestId: fields.requestId,
      ...fields,
    });
  },
};
