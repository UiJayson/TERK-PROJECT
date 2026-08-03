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

// Postgres SQLSTATE codes that mean "the database is unreachable OR
// misconfigured OR not yet migrated" — i.e. a backend/ops problem the end user
// cannot act on, not a bad request. Distinct from UNAVAILABLE_PG_CODES (pure
// connectivity) so callers can surface a clear 503 instead of a mystery 500.
const CONFIG_OR_CONNECTION_PG_CODES = new Set<string>([
  ...UNAVAILABLE_PG_CODES,
  "28P01", // invalid_password
  "28000", // invalid_authorization_specification
  "3D000", // invalid_catalog_name (database does not exist)
  "42P01", // undefined_table (schema not migrated)
]);

/**
 * True when an error means the database is unavailable, unauthenticated,
 * misconfigured, or un-migrated — anything where the correct response is a 503
 * "backend not connected" rather than a generic 500. Detects by type and PG
 * code first, then falls back to matching our own stable internal messages
 * (never driver-internal text, which stays server-side).
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
  if (error instanceof DbUnavailableError) return true;
  if (!error || typeof error !== "object") return false;

  const e = error as { code?: string; message?: string };
  if (e.code && CONFIG_OR_CONNECTION_PG_CODES.has(e.code)) return true;

  const message = (e.message ?? "").toLowerCase();
  return (
    message.includes("missing database_url") || // our own config error
    message.includes("service temporarily unavailable") || // DbUnavailableError default
    message.includes("tenant or user not found") || // Supabase pooler auth
    message.includes("econnrefused") ||
    message.includes("getaddrinfo") ||
    message.includes("connect") ||
    message.includes("password authentication failed")
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
