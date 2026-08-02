/**
 * In-memory TTL cache for Netlify Functions.
 *
 * Serverless caveat: each warm function instance has its own cache, so this is
 * a per-instance read-through cache, not a shared cache. That is exactly what
 * we want for hot-path deduplication (repeated dashboard polls, identical FAQ
 * questions) without adding a Redis dependency the platform doesn't have.
 * Entries are capped and evicted oldest-first so a busy instance can't grow
 * without bound.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T = unknown> {
  private entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly maxEntries = 500,
    private readonly defaultTtlMs = 60_000,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      // Map preserves insertion order; the first key is the oldest.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drop every key starting with the prefix (e.g. one workspace's entries). */
  invalidatePrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

const inflight = new Map<string, Promise<unknown>>();

/**
 * Read-through cache with request deduplication.
 *
 * - A cache hit returns immediately.
 * - Concurrent calls for the same key while a computation is in flight share
 *   one promise (thundering-herd protection), so N simultaneous identical
 *   requests cost one DB round trip.
 * - Failures are never cached; the next caller recomputes.
 */
export async function getOrCompute<T>(
  cache: TtlCache<T>,
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await compute();
      cache.set(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** Shared caches, segmented by concern so invalidation stays targeted. */
export const apiResponseCache = new TtlCache<unknown>(1000, 5_000);
export const aiResponseCache = new TtlCache<unknown>(500, 3_600_000);
export const analyticsCache = new TtlCache<unknown>(300, 60_000);

/** Invalidate every cached API/analytics payload for one workspace. */
export function invalidateWorkspaceCaches(workspaceId: string): void {
  apiResponseCache.invalidatePrefix(`ws:${workspaceId}:`);
  analyticsCache.invalidatePrefix(`ws:${workspaceId}:`);
}

export function workspaceCacheKey(
  workspaceId: string,
  resource: string,
  variant = "",
): string {
  return `ws:${workspaceId}:${resource}:${variant}`;
}
