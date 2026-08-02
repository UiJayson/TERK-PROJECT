/**
 * Embed widget security test suite — run with:
 *   npx tsx web/src/tests/embed-security/embed-security.test.ts
 *
 * Covers the public embed surface (Prompt 9):
 *  - public key format validation + enumeration resistance
 *  - image/URL sanitisation (XSS via javascript:/data: URLs)
 *  - message clamping / length limits
 *  - per-IP, per-key, and invalid-key-probe rate limiting
 *
 * No database or network required. Config env below satisfies validation only.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://tester:not-a-real-password@localhost:6543/postgres";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "embed-test-secret-0123456789abcdef";

import {
  clampMessage,
  isValidPublicKeyFormat,
  MAX_MESSAGE_LENGTH,
  safeImageUrl,
} from "../../lib/embed-security.ts";
import {
  checkEmbedIpLimit,
  checkEmbedKeyLimit,
  recordInvalidKeyProbe,
  EMBED_LIMITS,
} from "../../../netlify/functions/_shared/embed-rate-limit.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function requestFromIp(ip: string): Request {
  return new Request("https://harbor.example/api/chat", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "Content-Type": "application/json" },
  });
}

function testPublicKeyFormat(): void {
  assert(
    isValidPublicKeyFormat("pk_0123456789abcdef0123456789abcdef"),
    "valid pk_<32 hex> key must be accepted",
  );
  assert(!isValidPublicKeyFormat("pk_1"), "short key must be rejected");
  assert(!isValidPublicKeyFormat("ws_0123456789abcdef0123456789abcdef"), "wrong prefix rejected");
  assert(!isValidPublicKeyFormat("1"), "sequential/numeric id must be rejected");
  assert(!isValidPublicKeyFormat(null), "null key must be rejected");
  assert(
    !isValidPublicKeyFormat("pk_0123456789abcdef0123456789abcdefEXTRA"),
    "over-long key must be rejected",
  );
}

function testImageUrlSanitisation(): void {
  assert(safeImageUrl("https://cdn.example/p.png") === "https://cdn.example/p.png", "https allowed");
  assert(safeImageUrl("http://cdn.example/p.png") === "http://cdn.example/p.png", "http allowed");
  assert(safeImageUrl("javascript:alert(1)") === null, "javascript: URL must be blocked");
  assert(safeImageUrl("data:text/html,<script>alert(1)</script>") === null, "data: URL blocked");
  assert(safeImageUrl("vbscript:msgbox(1)") === null, "vbscript: URL blocked");
  assert(safeImageUrl("  javascript:alert(1)  ") === null, "whitespace-padded js URL blocked");
  assert(safeImageUrl(null) === null, "null image is null");
  assert(safeImageUrl("") === null, "empty image is null");
}

function testMessageClamp(): void {
  const long = "a".repeat(MAX_MESSAGE_LENGTH + 500);
  assert(clampMessage(long).length === MAX_MESSAGE_LENGTH, "message clamped to server limit");
  assert(clampMessage("  hi  ") === "hi", "message trimmed");
  assert(MAX_MESSAGE_LENGTH === 4000, "client cap mirrors server cap in chat.ts");
}

function testPerIpRateLimit(): void {
  const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  const req = requestFromIp(ip);
  let allowed = 0;
  for (let i = 0; i < EMBED_LIMITS.perIpPerMinute; i++) {
    if (checkEmbedIpLimit(req).allowed) allowed += 1;
  }
  assert(allowed === EMBED_LIMITS.perIpPerMinute, "all requests within the per-IP budget allowed");
  const blocked = checkEmbedIpLimit(req);
  assert(!blocked.allowed, "request over the per-IP budget is blocked");
  assert(blocked.retryAfterSeconds > 0, "blocked response carries Retry-After");
}

function testPerKeyRateLimit(): void {
  const key = `pk_${"b".repeat(32)}_${Date.now()}`;
  let allowed = 0;
  for (let i = 0; i < EMBED_LIMITS.perKeyPerMinute; i++) {
    if (checkEmbedKeyLimit(key).allowed) allowed += 1;
  }
  assert(allowed === EMBED_LIMITS.perKeyPerMinute, "per-key budget allows configured volume");
  assert(!checkEmbedKeyLimit(key).allowed, "per-key budget blocks the overflow request");
}

function testInvalidKeyProbeThrottle(): void {
  // A distinct IP so we don't collide with the per-IP test bucket.
  const req = requestFromIp(`198.51.100.${Math.floor(Math.random() * 250) + 1}`);
  let allowed = 0;
  for (let i = 0; i < EMBED_LIMITS.invalidKeyProbesPerIpPer10Min; i++) {
    if (recordInvalidKeyProbe(req).allowed) allowed += 1;
  }
  assert(
    allowed === EMBED_LIMITS.invalidKeyProbesPerIpPer10Min,
    "probe budget lets a few misses through",
  );
  assert(
    !recordInvalidKeyProbe(req).allowed,
    "enumeration attempts get throttled to 429 after the probe budget",
  );
}

async function main(): Promise<void> {
  const tests = [
    ["public key format / enumeration resistance", testPublicKeyFormat],
    ["image URL sanitisation (XSS sinks)", testImageUrlSanitisation],
    ["message length clamp", testMessageClamp],
    ["per-IP rate limit", testPerIpRateLimit],
    ["per-public-key rate limit", testPerKeyRateLimit],
    ["invalid-key probe throttle", testInvalidKeyProbeThrottle],
  ] as const;

  let passed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (error) {
      console.error(`FAIL  ${name}:`, error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }

  console.log(`\nEmbed security tests: ${passed}/${tests.length} passed`);
  if (process.exitCode) process.exit(process.exitCode);
}

void main();
