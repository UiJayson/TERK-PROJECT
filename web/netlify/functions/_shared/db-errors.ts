export class DbUnavailableError extends Error {
  readonly status = 503;
  readonly code = "DB_UNAVAILABLE";

  constructor(message = "Service temporarily unavailable") {
    super(message);
    this.name = "DbUnavailableError";
  }
}

export class DbAccessDeniedError extends Error {
  readonly status = 403;
  readonly code = "WORKSPACE_ACCESS_DENIED";

  constructor(message = "Workspace access denied") {
    super(message);
    this.name = "DbAccessDeniedError";
  }
}

const UNAVAILABLE_PG_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "57P01",
  "57P02",
  "57P03",
  "53300",
]);

const NETWORK_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"]);

function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code ?? "") : "";
  return NETWORK_ERROR_CODES.has(code);
}

function isRlsOrPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const pg = error as { code?: string; message?: string };
  if (pg.code === "42501") return true;
  const message = (pg.message ?? "").toLowerCase();
  return message.includes("row-level security") || message.includes("permission denied");
}

function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const pg = error as { code?: string; message?: string };
  if (pg.code && UNAVAILABLE_PG_CODES.has(pg.code)) return true;
  const message = (pg.message ?? "").toLowerCase();
  return (
    message.includes("connect") ||
    message.includes("connection") ||
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("getaddrinfo")
  );
}

export function mapDbError(error: unknown): Error {
  if (error instanceof DbUnavailableError || error instanceof DbAccessDeniedError) {
    return error;
  }

  if (isRlsOrPermissionError(error)) {
    return new DbAccessDeniedError();
  }

  if (isConnectionError(error) || isNetworkError(error)) {
    return new DbUnavailableError();
  }

  return error instanceof Error ? error : new Error(String(error));
}

const INTERNAL_MESSAGE_MARKERS = [
  "syntax error",
  "relation ",
  "column ",
  "duplicate key",
  "violates ",
  "constraint",
  "postgres",
  "pg_",
  "econnrefused",
  "getaddrinfo",
  "self signed",
  "certificate",
  " at ", // stack-trace fragments
];

/**
 * Returns an error message safe to send to API clients. Deliberate,
 * human-written errors (validation failures, provider errors surfaced on
 * purpose) pass through; anything that looks like a database/driver internal
 * or a stack trace is replaced with the fallback. The raw error should still
 * be logged server-side by the caller.
 */
export function publicErrorMessage(error: unknown, fallback = "Request failed"): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  // Postgres driver errors carry a `code`; never forward those verbatim.
  if ("code" in error && (error as { code?: unknown }).code) return fallback;
  const message = error.message;
  if (message.length > 200 || message.includes("\n")) return fallback;
  const lower = message.toLowerCase();
  if (INTERNAL_MESSAGE_MARKERS.some((marker) => lower.includes(marker))) return fallback;
  return message;
}

export function dbErrorToResponse(error: unknown): Response {
  const mapped = mapDbError(error);

  if (mapped instanceof DbAccessDeniedError) {
    return Response.json({ error: mapped.message }, { status: 403 });
  }

  if (mapped instanceof DbUnavailableError) {
    return Response.json({ error: mapped.message }, { status: 503 });
  }

  const message = mapped instanceof Error ? mapped.message : "Database error";
  return Response.json({ error: message }, { status: 500 });
}
