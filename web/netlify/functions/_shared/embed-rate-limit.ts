import { checkRateLimitInMemory, clientIp } from "./rate-limit.ts";

/**
 * Rate limits for the public embed/chat surface.
 *
 * Three layers, all enforced in chat.ts:
 *  - per client IP: stops a single machine flooding any widget.
 *  - per public key: caps total AI spend per workspace widget even when the
 *    traffic is distributed across many IPs (botnets, large NATs).
 *  - invalid-key probes per IP: slows public-key enumeration attempts to a
 *    crawl (keys are 122-bit random UUIDs, so enumeration is already
 *    infeasible — this just makes probing loud and slow).
 *
 * Note: buckets are in-memory per warm function instance (see rate-limit.ts),
 * so real-world ceilings are `limit × concurrent instances`. That is still an
 * effective abuse brake; for hard global limits move the buckets to Postgres
 * or an edge store.
 */
export const EMBED_LIMITS = {
  perIpPerMinute: 30,
  perKeyPerMinute: 120,
  invalidKeyProbesPerIpPer10Min: 10,
} as const;

const MINUTE_MS = 60 * 1000;

export interface EmbedRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  reason?: "ip" | "public_key" | "invalid_key_probes";
}

/** Per-IP throttle for the public chat endpoint. */
export function checkEmbedIpLimit(req: Request): EmbedRateLimitResult {
  const result = checkRateLimitInMemory(`chat:${clientIp(req)}`, EMBED_LIMITS.perIpPerMinute, MINUTE_MS);
  return { ...result, reason: result.allowed ? undefined : "ip" };
}

/** Per-public-key throttle — caps a workspace widget's total message rate. */
export function checkEmbedKeyLimit(publicKey: string): EmbedRateLimitResult {
  const result = checkRateLimitInMemory(
    `embed-key:${publicKey}`,
    EMBED_LIMITS.perKeyPerMinute,
    MINUTE_MS,
  );
  return { ...result, reason: result.allowed ? undefined : "public_key" };
}

/**
 * Call after a public-key lookup misses. Returns not-allowed once an IP has
 * burned through its probe budget, letting the caller reply 429 instead of
 * 404 and starving enumeration scripts of signal.
 */
export function recordInvalidKeyProbe(req: Request): EmbedRateLimitResult {
  const result = checkRateLimitInMemory(
    `embed-badkey:${clientIp(req)}`,
    EMBED_LIMITS.invalidKeyProbesPerIpPer10Min,
    10 * MINUTE_MS,
  );
  return { ...result, reason: result.allowed ? undefined : "invalid_key_probes" };
}
