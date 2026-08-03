import { getSql } from "./db.ts";
import { log } from "./logger.ts";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Per-instance fallback used only when the shared store is unreachable. On
// serverless this is isolated per warm instance, so it is a soft backstop —
// the Postgres-backed path below is the real, cross-instance limiter.
const buckets = new Map<string, RateLimitEntry>();

/**
 * Synchronous, per-instance limiter. Used directly by the high-volume public
 * embed/chat surface (where a DB write per message would be too costly) and as
 * the fallback for the Postgres-backed limiter below.
 */
export function checkRateLimitInMemory(
  key: string,
  maxAttempts: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now >= entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count >= maxAttempts) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count += 1;
  buckets.set(key, entry);
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Atomically increments the counter for `key` in Postgres. A single upsert
 * both resets the window when expired and increments within it, so concurrent
 * requests across instances share one counter. Falls back to the in-memory
 * limiter if the database is unavailable (e.g. cold DB, missing migration) so
 * auth endpoints never hard-fail on the rate-limit check itself.
 */
export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  try {
    const db = getSql();
    const rows = await db`
      INSERT INTO rate_limits (key, count, reset_at)
      VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.reset_at <= now() THEN 1
          ELSE rate_limits.count + 1
        END,
        reset_at = CASE
          WHEN rate_limits.reset_at <= now() THEN now() + make_interval(secs => ${windowSeconds})
          ELSE rate_limits.reset_at
        END
      RETURNING count, reset_at
    `;

    const count = Number(rows[0]?.count ?? 1);
    const resetAtMs = new Date(String(rows[0]?.reset_at)).getTime();

    if (count > maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000)),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (error) {
    // Never let the limiter take down the endpoint it protects.
    log.warn("rate_limit_fallback", {
      function: "rate-limit",
      key,
      error: error instanceof Error ? error.message : "unknown",
    });
    return checkRateLimitInMemory(key, maxAttempts, windowMs);
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}
