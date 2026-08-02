/**
 * Performance-infrastructure test suite.
 * Run: npm run test:perf  (tsx tests/performance.test.ts)
 *
 * Covers the building blocks the scale work relies on:
 *  - TTL cache: hit/miss/expiry/eviction/prefix invalidation
 *  - Request deduplication: concurrent identical requests share one compute
 *  - Cursor codec: round-trips and rejects malformed input
 *  - HTTP caching: ETag generation and 304 revalidation
 *  - Circuit breaker: opens after threshold, fails fast, recovers via half-open
 *  - Concurrency limiter: caps parallelism, rejects when the queue is full
 */

import { TtlCache, getOrCompute } from "../web/netlify/functions/_shared/cache.ts";
import { decodeCursor, encodeCursor } from "../web/netlify/functions/_shared/db.ts";
import { cachedJsonResponse, computeEtag } from "../web/netlify/functions/_shared/http-cache.ts";
import {
  CircuitBreaker,
  CircuitOpenError,
  ConcurrencyLimiter,
} from "../web/netlify/functions/_shared/circuit-breaker.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ok - ${name}`);
}

// --- TtlCache ---------------------------------------------------------------

await test("TtlCache returns cached value before TTL and misses after", async () => {
  const cache = new TtlCache<string>(10, 50);
  cache.set("k", "v");
  assert(cache.get("k") === "v", "expected cache hit");
  await sleep(70);
  assert(cache.get("k") === undefined, "expected expiry after TTL");
});

await test("TtlCache evicts oldest entry at capacity", () => {
  const cache = new TtlCache<number>(3, 10_000);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  cache.set("d", 4); // evicts "a"
  assert(cache.get("a") === undefined, "oldest entry should be evicted");
  assert(cache.get("d") === 4, "newest entry should be present");
  assert(cache.size === 3, "size should stay at capacity");
});

await test("TtlCache prefix invalidation only removes matching keys", () => {
  const cache = new TtlCache<number>(10, 10_000);
  cache.set("ws:a:leads", 1);
  cache.set("ws:a:conversations", 2);
  cache.set("ws:b:leads", 3);
  const removed = cache.invalidatePrefix("ws:a:");
  assert(removed === 2, `expected 2 removed, got ${removed}`);
  assert(cache.get("ws:b:leads") === 3, "other workspace must be untouched");
});

// --- Request deduplication ---------------------------------------------------

await test("getOrCompute deduplicates concurrent identical requests", async () => {
  const cache = new TtlCache<number>(10, 5_000);
  let computeCount = 0;
  const compute = async () => {
    computeCount++;
    await sleep(30);
    return 42;
  };
  const results = await Promise.all([
    getOrCompute(cache, "dedup", 5_000, compute),
    getOrCompute(cache, "dedup", 5_000, compute),
    getOrCompute(cache, "dedup", 5_000, compute),
    getOrCompute(cache, "dedup", 5_000, compute),
    getOrCompute(cache, "dedup", 5_000, compute),
  ]);
  assert(results.every((r) => r === 42), "all callers get the value");
  assert(computeCount === 1, `expected 1 compute, got ${computeCount}`);
  // Follow-up within TTL is a cache hit, still no recompute:
  assert((await getOrCompute(cache, "dedup", 5_000, compute)) === 42, "cache hit");
  assert(computeCount === 1, "cache hit must not recompute");
});

await test("getOrCompute does not cache failures", async () => {
  const cache = new TtlCache<number>(10, 5_000);
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return 7;
  };
  let threw = false;
  try {
    await getOrCompute(cache, "flaky", 5_000, flaky);
  } catch {
    threw = true;
  }
  assert(threw, "first call should propagate the error");
  assert((await getOrCompute(cache, "flaky", 5_000, flaky)) === 7, "retry succeeds");
});

// --- Cursor codec ------------------------------------------------------------

await test("cursor round-trips and rejects garbage", () => {
  const cursor = { u: "2026-07-10T12:00:00.000Z", i: "conv_abc123" };
  const encoded = encodeCursor(cursor);
  const decoded = decodeCursor(encoded);
  assert(decoded !== null && decoded.u === cursor.u && decoded.i === cursor.i, "round-trip");
  assert(decodeCursor("not-base64-json!!") === null, "garbage → null (first page)");
  assert(decodeCursor(null) === null, "null → null");
  assert(decodeCursor(Buffer.from('{"x":1}').toString("base64url")) === null, "wrong shape → null");
});

// --- HTTP caching ------------------------------------------------------------

await test("cachedJsonResponse sets ETag and answers If-None-Match with 304", async () => {
  const body = { leads: [{ id: "l1" }], nextCursor: null, hasMore: false };
  const first = cachedJsonResponse(new Request("http://x/api/leads"), body);
  assert(first.status === 200, "first response is 200");
  const etag = first.headers.get("etag");
  assert(Boolean(etag), "ETag header present");
  assert(
    (first.headers.get("cache-control") ?? "").includes("private"),
    "authenticated responses must be private",
  );

  const revalidated = cachedJsonResponse(
    new Request("http://x/api/leads", { headers: { "If-None-Match": etag! } }),
    body,
  );
  assert(revalidated.status === 304, "matching ETag → 304");

  const changed = cachedJsonResponse(
    new Request("http://x/api/leads", { headers: { "If-None-Match": etag! } }),
    { ...body, hasMore: true },
  );
  assert(changed.status === 200, "changed body → 200 with new ETag");
  assert(changed.headers.get("etag") !== etag, "ETag changes with body");
});

await test("computeEtag is deterministic and content-sensitive", () => {
  assert(computeEtag("abc") === computeEtag("abc"), "same content → same tag");
  assert(computeEtag("abc") !== computeEtag("abd"), "different content → different tag");
});

// --- Circuit breaker ----------------------------------------------------------

await test("circuit breaker opens after threshold and fails fast", async () => {
  const breaker = new CircuitBreaker("test", {
    failureThreshold: 3,
    windowMs: 10_000,
    openMs: 10_000,
  });
  const failing = () => Promise.reject(new Error("provider down"));

  for (let i = 0; i < 3; i++) {
    try {
      await breaker.execute(failing);
    } catch {
      // expected
    }
  }
  assert(breaker.getState() === "open", "breaker should be open after 3 failures");

  let failedFast = false;
  try {
    await breaker.execute(async () => "should not run");
  } catch (error) {
    failedFast = error instanceof CircuitOpenError;
  }
  assert(failedFast, "open breaker must throw CircuitOpenError without calling through");
});

await test("circuit breaker half-open probe recovers on success", async () => {
  const breaker = new CircuitBreaker("recovery", {
    failureThreshold: 1,
    windowMs: 1_000,
    openMs: 40, // fast for the test
  });
  try {
    await breaker.execute(() => Promise.reject(new Error("x")));
  } catch {
    // trips the breaker
  }
  assert(breaker.getState() === "open", "tripped");
  await sleep(60);
  assert(breaker.getState() === "half-open", "half-open after openMs");
  const result = await breaker.execute(async () => "recovered");
  assert(result === "recovered", "probe passes through");
  assert(breaker.getState() === "closed", "success closes the circuit");
});

// --- Concurrency limiter -------------------------------------------------------

await test("concurrency limiter caps parallel executions", async () => {
  const limiter = new ConcurrencyLimiter(2, 10);
  let inFlight = 0;
  let peak = 0;
  const job = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await sleep(20);
    inFlight--;
    return true;
  };
  const results = await Promise.all(Array.from({ length: 8 }, () => limiter.run(job)));
  assert(results.length === 8 && results.every(Boolean), "all jobs complete");
  assert(peak <= 2, `peak concurrency ${peak} must be <= 2`);
});

await test("concurrency limiter rejects when queue is full", async () => {
  const limiter = new ConcurrencyLimiter(1, 1);
  const slow = () => sleep(50).then(() => "done");
  const first = limiter.run(slow); // executing
  const second = limiter.run(slow); // queued (queue size 1)
  let rejected = false;
  try {
    await limiter.run(slow); // queue full → reject
  } catch {
    rejected = true;
  }
  assert(rejected, "third request must be rejected at capacity");
  await Promise.all([first, second]);
});

console.log(`\nperformance.test.ts: ${passed} tests passed`);
