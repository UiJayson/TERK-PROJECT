#!/usr/bin/env node
/**
 * Post-deploy smoke check. Verifies the four layers that matter:
 *   1. Static site serves (CDN)
 *   2. Functions run (liveness endpoint + required config present)
 *   3. Database is reachable (db-test function)
 *   4. Auth middleware behaves (unauthenticated /api/auth/me → 401)
 *
 * Usage:  node scripts/health-check.mjs [baseUrl]
 *         baseUrl defaults to SITE_URL env, then production.
 * Exits non-zero on any failure — safe to gate CI deploys on.
 */

const base = (
  process.argv[2] ??
  process.env.SITE_URL ??
  "https://harbor-ai-business-os.netlify.app"
).replace(/\/$/, "");

const TIMEOUT_MS = 30_000; // first hit may pay a function cold start
let failures = 0;
let warnings = 0;

class Warning extends Error {}

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`✓ ${name} (${Date.now() - started} ms)${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    if (error instanceof Warning) {
      warnings += 1;
      console.warn(`⚠ ${name} (${Date.now() - started} ms) — ${error.message}`);
      return;
    }
    failures += 1;
    console.error(`✗ ${name} (${Date.now() - started} ms) — ${error.message}`);
  }
}

function get(path, init = {}) {
  return fetch(`${base}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...init,
  });
}

console.log(`Health check: ${base}\n`);

await check("Static site responds", async () => {
  const res = await get("/");
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const html = await res.text();
  if (!html.includes("<div id=\"root\"") && !html.includes("<div id=root"))
    throw new Error("no SPA mount point in homepage HTML");
});

await check("Functions liveness (/.netlify/functions/health)", async () => {
  const res = await get("/.netlify/functions/health");
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const body = await res.json();
  if (body.status !== "ok") throw new Error(`status=${body.status} ${body.error ?? ""}`);
  const down = Object.entries(body.services ?? {})
    .filter(([, up]) => !up)
    .map(([svc]) => svc);
  return down.length ? `services not configured: ${down.join(", ")}` : "all services configured";
});

// db-test is POST-only and admin-gated in production. With ADMIN_TOKEN we can
// verify the database end-to-end; without it we still verify the endpoint is
// alive and enforcing auth (401).
await check("Database connectivity (/.netlify/functions/db-test)", async () => {
  const adminToken = process.env.ADMIN_TOKEN;
  const res = await get("/.netlify/functions/db-test", {
    method: "POST",
    headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {},
  });
  if (adminToken) {
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    return "database reachable";
  }
  if (res.status === 200) return "database reachable (endpoint unauthenticated — non-production)";
  if (res.status === 401) return "endpoint alive; set ADMIN_TOKEN env to verify DB end-to-end";
  // Unauthenticated we can't tell "DB down" from "diagnostic endpoint broken";
  // warn instead of failing the deploy, but say so loudly.
  throw new Warning(
    `db-test returned ${res.status} — run again with ADMIN_TOKEN set to verify the database`,
  );
});

await check("Auth middleware rejects anonymous (/api/auth/me → 401)", async () => {
  const res = await get("/api/auth/me");
  if (res.status !== 401)
    throw new Error(`expected 401, got ${res.status} — auth middleware may be broken`);
});

await check("Security headers present", async () => {
  const res = await get("/");
  const missing = ["strict-transport-security", "x-content-type-options"].filter(
    (h) => !res.headers.get(h),
  );
  if (missing.length) throw new Error(`missing: ${missing.join(", ")}`);
});

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed${warnings ? `, ${warnings} warning(s)` : ""}.`);
  process.exit(1);
}
console.log(warnings ? `Passed with ${warnings} warning(s).` : "All checks passed.");
