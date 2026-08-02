import postgres, { type Sql } from "postgres";
import { DbUnavailableError, mapDbError } from "./db-errors.ts";
import { log } from "./logger.ts";

const RETRY_DELAYS_MS = [1000, 2000, 4000];

export type QueryType = "select" | "insert" | "update" | "delete" | "other";

export interface QueryMeta {
  query_type: QueryType;
  table: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function inferQueryMeta(strings: readonly string[]): QueryMeta {
  const text = strings.join(" ").trim().toLowerCase();
  let query_type: QueryType = "other";
  if (text.startsWith("select")) query_type = "select";
  else if (text.startsWith("insert")) query_type = "insert";
  else if (text.startsWith("update")) query_type = "update";
  else if (text.startsWith("delete")) query_type = "delete";

  const tableMatch =
    text.match(/\bfrom\s+([a-z0-9_."`]+)/i) ??
    text.match(/\binto\s+([a-z0-9_."`]+)/i) ??
    text.match(/\bupdate\s+([a-z0-9_."`]+)/i) ??
    text.match(/\bdelete\s+from\s+([a-z0-9_."`]+)/i);

  const table = tableMatch?.[1]?.replace(/["`]/g, "") ?? null;
  return { query_type, table };
}

async function runWithLogging<T>(
  operation: () => Promise<T>,
  meta: QueryMeta,
  workspaceId: string | null,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await operation();
    log.info("db_query", {
      timestamp: new Date().toISOString(),
      query_type: meta.query_type,
      table: meta.table,
      duration_ms: Date.now() - started,
      workspace_id: workspaceId,
      success: true,
    });
    return result;
  } catch (error) {
    log.error("db_query", {
      timestamp: new Date().toISOString(),
      query_type: meta.query_type,
      table: meta.table,
      duration_ms: Date.now() - started,
      workspace_id: workspaceId,
      success: false,
      error_message: error instanceof Error ? error.message : "query failed",
    });
    throw mapDbError(error);
  }
}

function wrapSql(base: Sql, getWorkspaceId: () => string | null): Sql {
  const handler: ProxyHandler<Sql> = {
    apply(_target, _thisArg, args) {
      const strings = (args[0] as TemplateStringsArray | undefined) ?? [];
      const meta = inferQueryMeta(strings);
      return runWithLogging(
        () => Reflect.apply(base, undefined, args as never),
        meta,
        getWorkspaceId(),
      );
    },
    get(target, prop, receiver) {
      if (prop === "begin") {
        return (callback: (tx: Sql) => Promise<unknown>) =>
          target.begin(async (tx) => callback(wrapSql(tx as unknown as Sql, getWorkspaceId)));
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  };

  return new Proxy(base, handler);
}

export function wrapClient(base: Sql, getWorkspaceId: () => string | null): Sql {
  return wrapSql(base, getWorkspaceId);
}

export async function connectPostgres(
  databaseUrl: string,
  getWorkspaceId: () => string | null,
): Promise<Sql> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      const client = postgres(databaseUrl, {
        max: 1,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,
      });

      await client`SELECT 1 AS ok`;
      return wrapSql(client, getWorkspaceId);
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length - 1) {
        log.warn("db_connect_retry", {
          attempt: attempt + 1,
          delay_ms: RETRY_DELAYS_MS[attempt],
          error_message: error instanceof Error ? error.message : "connect failed",
        });
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  throw new DbUnavailableError(
    lastError instanceof Error ? lastError.message : "Service temporarily unavailable",
  );
}
