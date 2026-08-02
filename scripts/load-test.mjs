#!/usr/bin/env node
/**
 * Load test — simulates N concurrent businesses hitting the API.
 *
 * Usage:
 *   node scripts/load-test.mjs                            # 1000 virtual users vs prod
 *   BASE_URL=http://localhost:5173 node scripts/load-test.mjs
 *   USERS=200 DURATION_S=15 node scripts/load-test.mjs
 *   TOKEN=<jwt> node scripts/load-test.mjs                # also exercise authed endpoints
 *
 * Each virtual user loops through a scenario (think: one business's dashboard
 * polling + widget traffic) for DURATION_S seconds. Reports p50/p95/p99
 * latency, throughput, and error rate per endpoint — the numbers to compare
 * before/after any performance change (see docs/PERFORMANCE.md).
 *
 * Read-only: it only issues GET requests, so it's safe against production —
 * but coordinate before pointing high USERS values at a live site.
 */

const BASE_URL = process.env.BASE_URL ?? "https://harbor-ai-business-os.netlify.app";
const USERS = Number(process.env.USERS ?? 1000);
const DURATION_S = Number(process.env.DURATION_S ?? 30);
const RAMP_S = Number(process.env.RAMP_S ?? 5);
const TOKEN = process.env.TOKEN ?? "";

// GET-only scenario. Authed endpoints are included only when TOKEN is set;
// without it they still exercise the auth-reject path (cheap, but real).
const SCENARIO = [
  { name: "health", path: "/api/health", weight: 1 },
  { name: "conversations (page 1)", path: "/api/conversations?limit=50", weight: 3, auth: true },
  { name: "leads (page 1)", path: "/api/leads?limit=50", weight: 3, auth: true },
  { name: "analytics summary", path: "/api/analytics/summary", weight: 2, auth: true },
  { name: "static shell", path: "/", weight: 2 },
];

const weightedPaths = SCENARIO.flatMap((s) => Array(s.weight).fill(s));

/** @type {Map<string, number[]>} */
const latencies = new Map();
/** @type {Map<string, {ok: number, cached: number, errors: number, statuses: Map<number, number>}>} */
const counters = new Map();

for (const s of SCENARIO) {
  latencies.set(s.name, []);
  counters.set(s.name, { ok: 0, cached: 0, errors: 0, statuses: new Map() });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function virtualUser(id, deadline) {
  // Per-user ETag store: models a real browser revalidating with If-None-Match.
  const etags = new Map();
  // Stagger start across the ramp window.
  await new Promise((r) => setTimeout(r, (id / USERS) * RAMP_S * 1000));

  while (Date.now() < deadline) {
    const target = weightedPaths[Math.floor(Math.random() * weightedPaths.length)];
    const headers = {};
    if (target.auth && TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
    const knownEtag = etags.get(target.path);
    if (knownEtag) headers["If-None-Match"] = knownEtag;

    const started = performance.now();
    try {
      const res = await fetch(`${BASE_URL}${target.path}`, { headers });
      const elapsed = performance.now() - started;
      await res.arrayBuffer(); // drain the body so keep-alive sockets recycle

      latencies.get(target.name).push(elapsed);
      const stats = counters.get(target.name);
      stats.statuses.set(res.status, (stats.statuses.get(res.status) ?? 0) + 1);
      if (res.status === 304) stats.cached++;
      else if (res.ok) {
        stats.ok++;
        const etag = res.headers.get("etag");
        if (etag) etags.set(target.path, etag);
      } else if (res.status >= 500) stats.errors++;
      else stats.ok++; // 4xx (auth rejects without TOKEN) count as handled
    } catch {
      counters.get(target.name).errors++;
      latencies.get(target.name).push(performance.now() - started);
    }

    // ~1 request/sec per user with jitter — 1000 users ≈ 1000 rps offered load.
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 600));
  }
}

console.log(`Load test: ${USERS} virtual users, ${DURATION_S}s, ramp ${RAMP_S}s`);
console.log(`Target: ${BASE_URL}${TOKEN ? " (authenticated)" : " (anonymous)"}\n`);

const deadline = Date.now() + (DURATION_S + RAMP_S) * 1000;
const startedAt = Date.now();
await Promise.all(Array.from({ length: USERS }, (_, i) => virtualUser(i, deadline)));
const wallClockS = (Date.now() - startedAt) / 1000;

let totalRequests = 0;
let totalErrors = 0;

console.log(
  "endpoint".padEnd(28) +
    "reqs".padStart(8) +
    "p50 ms".padStart(9) +
    "p95 ms".padStart(9) +
    "p99 ms".padStart(9) +
    "304s".padStart(7) +
    "5xx/net".padStart(9),
);
console.log("-".repeat(79));

for (const s of SCENARIO) {
  const sorted = [...latencies.get(s.name)].sort((a, b) => a - b);
  const stats = counters.get(s.name);
  totalRequests += sorted.length;
  totalErrors += stats.errors;
  console.log(
    s.name.padEnd(28) +
      String(sorted.length).padStart(8) +
      percentile(sorted, 50).toFixed(0).padStart(9) +
      percentile(sorted, 95).toFixed(0).padStart(9) +
      percentile(sorted, 99).toFixed(0).padStart(9) +
      String(stats.cached).padStart(7) +
      String(stats.errors).padStart(9),
  );
}

const errorRate = totalRequests === 0 ? 0 : (totalErrors / totalRequests) * 100;
console.log("-".repeat(79));
console.log(
  `total: ${totalRequests} requests in ${wallClockS.toFixed(1)}s ` +
    `(${(totalRequests / wallClockS).toFixed(1)} rps), error rate ${errorRate.toFixed(2)}%`,
);

// Alert thresholds (mirrors docs/PERFORMANCE.md targets).
const allSorted = [...latencies.values()].flat().sort((a, b) => a - b);
const p95 = percentile(allSorted, 95);
if (p95 > 2000) console.log(`\n⚠ ALERT: overall p95 ${p95.toFixed(0)}ms exceeds 2s target`);
if (errorRate > 1) console.log(`⚠ ALERT: error rate ${errorRate.toFixed(2)}% exceeds 1% target`);
if (p95 <= 2000 && errorRate <= 1) console.log("\n✓ Within targets: p95 ≤ 2s, error rate ≤ 1%");
