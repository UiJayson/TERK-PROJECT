/**
 * Security test suite — run with: npx tsx tests/security.test.ts
 *
 * Covers: password hashing, JWT integrity/expiry/revocation fields, session
 * cookies, rate limiting, secret/placeholder validation, admin token guard,
 * webhook signature verification, upload validation, reset tokens, RBAC.
 *
 * No database required — env below satisfies config validation only.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://tester:not-a-real-password@localhost:6543/postgres";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "security-test-secret-0123456789abcdef";

import { createHmac } from "node:crypto";
import {
  createResetToken,
  createSessionToken,
  hashPassword,
  hashToken,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  sessionCookieHeader,
  verifyPassword,
  verifySessionToken,
} from "../web/netlify/functions/_shared/auth-crypto.ts";
import { isConfiguredSecret } from "../web/netlify/functions/_shared/config.ts";
import { isAdminAuthorized } from "../web/netlify/functions/_shared/admin-auth.ts";
import { checkRateLimit, clientIp } from "../web/netlify/functions/_shared/rate-limit.ts";
import { verifyMetaWebhookSignature } from "../web/netlify/functions/_shared/whatsapp.ts";
import { verifyStripeWebhookSignature } from "../web/netlify/functions/_shared/stripe-billing.ts";
import {
  scanExtractedText,
  validateUploadFile,
} from "../web/netlify/functions/_shared/upload-validation.ts";
import { hasMinimumRole, isWorkspaceRole } from "../web/netlify/functions/_shared/rbac.ts";
import { redactString } from "../web/netlify/functions/_shared/redact.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Minimal HS256 JWT signer for forging attacker-style tokens in tests. */
function signHs256(claims: Record<string, unknown>, secret: string): string {
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode(claims);
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const SESSION = {
  sub: "user_test",
  email: "tester@example.com",
  name: "Tester",
  workspaceId: "ws_test",
  role: "owner" as const,
  sessionVersion: 3,
};

// --- Passwords ---------------------------------------------------------------

async function testBcryptCostFactor(): Promise<void> {
  const hash = await hashPassword("correct horse battery staple");
  assert(/^\$2[aby]\$12\$/.test(hash), `bcrypt hash must use cost 12, got: ${hash.slice(0, 7)}`);
}

async function testPasswordVerifyRoundtrip(): Promise<void> {
  const hash = await hashPassword("s3cret-password!");
  assert(await verifyPassword("s3cret-password!", hash), "correct password must verify");
}

async function testPasswordVerifyRejectsWrong(): Promise<void> {
  const hash = await hashPassword("s3cret-password!");
  assert(!(await verifyPassword("wrong-password", hash)), "wrong password must fail");
}

function testPasswordPolicy(): void {
  assert(!isValidPassword("short"), "7-char password must be rejected");
  assert(isValidPassword("long-enough-pass"), "8+ char password must pass");
}

function testEmailValidation(): void {
  assert(isValidEmail("a@b.co"), "valid email must pass");
  assert(!isValidEmail("not-an-email"), "invalid email must fail");
  assert(!isValidEmail("a b@c.com"), "email with space must fail");
  assert(normalizeEmail("  USER@Example.COM ") === "user@example.com", "email must normalize");
}

// --- JWT session tokens --------------------------------------------------------

async function testJwtRoundtrip(): Promise<void> {
  const token = await createSessionToken(SESSION);
  const payload = await verifySessionToken(token);
  assert(payload !== null, "valid token must verify");
  assert(payload!.sub === "user_test", "sub must roundtrip");
  assert(payload!.workspaceId === "ws_test", "workspaceId must roundtrip");
  assert(payload!.sessionVersion === 3, "sessionVersion must roundtrip (revocation field)");
}

async function testJwtTamperRejected(): Promise<void> {
  const token = await createSessionToken(SESSION);
  const [h, p, s] = token.split(".");
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), role: "owner", sub: "user_evil" }),
  ).toString("base64url");
  const tampered = `${h}.${tamperedPayload}.${s}`;
  assert((await verifySessionToken(tampered)) === null, "tampered payload must be rejected");
}

async function testJwtWrongSecretRejected(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const forged = signHs256(
    {
      sub: SESSION.sub,
      email: SESSION.email,
      workspaceId: SESSION.workspaceId,
      iat: now,
      exp: now + 3600,
    },
    "attacker-guessed-secret-1234567890",
  );
  assert((await verifySessionToken(forged)) === null, "token signed with wrong secret must fail");
}

async function testJwtExpiryEnforced(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expired = signHs256(
    {
      sub: SESSION.sub,
      email: SESSION.email,
      workspaceId: SESSION.workspaceId,
      iat: now - 7200,
      exp: now - 3600,
    },
    process.env.AUTH_SECRET!,
  );
  assert((await verifySessionToken(expired)) === null, "expired token must be rejected");
}

async function testJwtHasExpiry(): Promise<void> {
  const token = await createSessionToken(SESSION);
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert(typeof claims.exp === "number", "token must carry exp claim");
  const ttl = claims.exp - claims.iat;
  assert(ttl <= 60 * 60 * 24, `token TTL must be <= 24h, got ${ttl}s`);
}

function testSessionCookieFlags(): void {
  const header = sessionCookieHeader("tok");
  assert(header.includes("HttpOnly"), "cookie must be HttpOnly");
  assert(header.includes("SameSite=Lax"), "cookie must be SameSite=Lax");
  assert(header.includes("Path=/"), "cookie must scope to /");
}

// --- Rate limiting -------------------------------------------------------------

function testRateLimitAllowsWithinBudget(): void {
  for (let i = 0; i < 5; i++) {
    assert(checkRateLimit("t:allow", 5, 60_000).allowed, `attempt ${i + 1}/5 must be allowed`);
  }
}

function testRateLimitBlocksOverBudget(): void {
  for (let i = 0; i < 5; i++) checkRateLimit("t:block", 5, 60_000);
  const result = checkRateLimit("t:block", 5, 60_000);
  assert(!result.allowed, "6th attempt must be blocked");
  assert(result.retryAfterSeconds >= 1, "must return Retry-After");
}

async function testRateLimitWindowResets(): Promise<void> {
  for (let i = 0; i < 3; i++) checkRateLimit("t:reset", 3, 50);
  assert(!checkRateLimit("t:reset", 3, 50).allowed, "must be blocked inside window");
  await new Promise((r) => setTimeout(r, 60));
  assert(checkRateLimit("t:reset", 3, 50).allowed, "must reset after window elapses");
}

function testClientIpHeaderPriority(): void {
  const req = new Request("http://x/", {
    headers: {
      "x-nf-client-connection-ip": "1.2.3.4",
      "x-forwarded-for": "5.6.7.8, 9.9.9.9",
    },
  });
  assert(clientIp(req) === "1.2.3.4", "Netlify header must win over XFF");
  const xffOnly = new Request("http://x/", { headers: { "x-forwarded-for": "5.6.7.8, 9.9.9.9" } });
  assert(clientIp(xffOnly) === "5.6.7.8", "first XFF hop must be used");
}

// --- Secrets & config ------------------------------------------------------------

function testPlaceholderSecretsRejected(): void {
  assert(!isConfiguredSecret("dev-admin-change-me"), "change-me placeholder must be rejected");
  assert(!isConfiguredSecret("sk-ant-api03-xxxxxxxx"), "masked anthropic key must be rejected");
  assert(!isConfiguredSecret("your-auth-secret-min-32-chars"), "your- prefix must be rejected");
  assert(!isConfiguredSecret("short"), "sub-8-char value must be rejected");
  assert(!isConfiguredSecret(""), "empty must be rejected");
  assert(!isConfiguredSecret(null), "null must be rejected");
}

function testRealSecretAccepted(): void {
  assert(isConfiguredSecret("Zk8!pQ2vX9mL4nR7wT1cB5"), "realistic secret must be accepted");
}

// --- Admin token guard ------------------------------------------------------------

function testAdminGuardRejectsMissingHeader(): void {
  assert(!isAdminAuthorized(new Request("http://x/")), "no header must be unauthorized");
}

function testAdminGuardRejectsWrongToken(): void {
  const req = new Request("http://x/", { headers: { authorization: "Bearer wrong-token-value" } });
  assert(!isAdminAuthorized(req), "wrong token must be unauthorized");
}

function testAdminGuardAcceptsDevTokenOutsideProduction(): void {
  const req = new Request("http://x/", {
    headers: { authorization: "Bearer dev-admin-change-me" },
  });
  assert(isAdminAuthorized(req), "dev token must authorize in non-production");
}

// --- Webhook signatures -------------------------------------------------------------

function testMetaSignatureValid(): void {
  const body = '{"object":"whatsapp_business_account"}';
  const secret = "meta-app-secret";
  const sig = "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
  assert(verifyMetaWebhookSignature(body, sig, secret), "valid Meta signature must verify");
}

function testMetaSignatureInvalid(): void {
  const body = '{"object":"whatsapp_business_account"}';
  assert(
    !verifyMetaWebhookSignature(body, "sha256=" + "0".repeat(64), "meta-app-secret"),
    "forged Meta signature must fail",
  );
  assert(!verifyMetaWebhookSignature(body, null, "meta-app-secret"), "missing header must fail");
  assert(!verifyMetaWebhookSignature(body, "sha256=abc", ""), "empty secret must fail");
}

function testStripeSignatureRejectedWithoutSecret(): void {
  // STRIPE_WEBHOOK_SECRET is unset in this test env — verification must fail
  // closed rather than accept anything.
  assert(
    !verifyStripeWebhookSignature('{"type":"invoice.paid"}', "t=123,v1=deadbeef"),
    "stripe verification without configured secret must fail closed",
  );
}

// --- Upload validation ---------------------------------------------------------------

function testUploadBlocksExecutable(): void {
  const result = validateUploadFile({
    filename: "invoice.exe",
    mimeType: "application/octet-stream",
    size: 100,
    maxBytes: 10 * 1024 * 1024,
    buffer: Buffer.from("MZ"),
  });
  assert(!result.ok, ".exe upload must be blocked");
}

function testUploadBlocksOversize(): void {
  const result = validateUploadFile({
    filename: "doc.pdf",
    mimeType: "application/pdf",
    size: 11 * 1024 * 1024,
    maxBytes: 10 * 1024 * 1024,
    buffer: Buffer.from("%PDF-1.4"),
  });
  assert(!result.ok, "oversized upload must be blocked");
}

function testUploadBlocksScriptContent(): void {
  const result = validateUploadFile({
    filename: "notes.txt",
    mimeType: "text/plain",
    size: 40,
    maxBytes: 10 * 1024 * 1024,
    buffer: Buffer.from('<script>alert("xss")</script>'),
  });
  assert(!result.ok, "script content in upload must be blocked");
}

function testUploadAcceptsValidPdf(): void {
  const result = validateUploadFile({
    filename: "brochure.pdf",
    mimeType: "application/pdf",
    size: 2048,
    maxBytes: 10 * 1024 * 1024,
    buffer: Buffer.concat([Buffer.from([0x25, 0x50, 0x44, 0x46]), Buffer.alloc(2044)]),
  });
  assert(result.ok, "valid PDF (magic bytes + mime) must pass");
}

function testUploadRejectsMimeSpoofedPdf(): void {
  const result = validateUploadFile({
    filename: "fake.pdf",
    mimeType: "application/octet-stream",
    size: 100,
    maxBytes: 10 * 1024 * 1024,
    buffer: Buffer.from("not a pdf at all, no magic bytes here"),
  });
  assert(!result.ok, "pdf without magic bytes or pdf mime must be rejected");
}

function testExtractedTextScan(): void {
  assert(!scanExtractedText("<script>steal()</script>").ok, "script in extracted text must flag");
  assert(scanExtractedText("Perfectly normal document text.").ok, "clean text must pass");
}

// --- Reset tokens ----------------------------------------------------------------------

function testResetTokenEntropy(): void {
  const a = createResetToken();
  const b = createResetToken();
  assert(/^[0-9a-f]{64}$/.test(a), "reset token must be 32 random bytes hex-encoded");
  assert(a !== b, "reset tokens must be unique");
}

function testTokenHashingOneWay(): void {
  const token = createResetToken();
  const hash = hashToken(token);
  assert(hash !== token, "stored token must be hashed");
  assert(hashToken(token) === hash, "hash must be deterministic for lookup");
  assert(/^[0-9a-f]{64}$/.test(hash), "hash must be sha256 hex");
}

// --- RBAC ------------------------------------------------------------------------------

function testRoleHierarchy(): void {
  assert(hasMinimumRole("owner", "admin"), "owner must satisfy admin requirement");
  assert(hasMinimumRole("admin", "staff"), "admin must satisfy staff requirement");
  assert(!hasMinimumRole("staff", "admin"), "staff must NOT satisfy admin requirement");
  assert(!hasMinimumRole("admin", "owner"), "admin must NOT satisfy owner requirement");
}

function testRoleValidation(): void {
  assert(isWorkspaceRole("owner") && isWorkspaceRole("staff"), "known roles must validate");
  assert(!isWorkspaceRole("superuser"), "unknown role must be rejected");
  assert(!isWorkspaceRole(""), "empty role must be rejected");
}

// --- Log redaction (secrets never reach logs) -------------------------------------------

function testJwtRedactedFromLogs(): void {
  const fakeJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
  const line = redactString(`token leaked: ${fakeJwt}`);
  assert(!line.includes(fakeJwt), "JWT-shaped strings must be redacted from logs");
}

// --- Runner ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const tests: ReadonlyArray<readonly [string, () => void | Promise<void>]> = [
    ["bcrypt cost factor is 12", testBcryptCostFactor],
    ["password verify roundtrip", testPasswordVerifyRoundtrip],
    ["password verify rejects wrong password", testPasswordVerifyRejectsWrong],
    ["password policy minimum length", testPasswordPolicy],
    ["email validation + normalization", testEmailValidation],
    ["jwt roundtrip with revocation field", testJwtRoundtrip],
    ["jwt tampered payload rejected", testJwtTamperRejected],
    ["jwt wrong secret rejected", testJwtWrongSecretRejected],
    ["jwt expiry enforced", testJwtExpiryEnforced],
    ["jwt TTL <= 24h", testJwtHasExpiry],
    ["session cookie flags", testSessionCookieFlags],
    ["rate limit allows within budget", testRateLimitAllowsWithinBudget],
    ["rate limit blocks over budget", testRateLimitBlocksOverBudget],
    ["rate limit window resets", testRateLimitWindowResets],
    ["client IP header priority", testClientIpHeaderPriority],
    ["placeholder secrets rejected", testPlaceholderSecretsRejected],
    ["real secret accepted", testRealSecretAccepted],
    ["admin guard rejects missing header", testAdminGuardRejectsMissingHeader],
    ["admin guard rejects wrong token", testAdminGuardRejectsWrongToken],
    ["admin guard accepts dev token outside production", testAdminGuardAcceptsDevTokenOutsideProduction],
    ["meta webhook signature valid", testMetaSignatureValid],
    ["meta webhook signature forgery rejected", testMetaSignatureInvalid],
    ["stripe webhook fails closed without secret", testStripeSignatureRejectedWithoutSecret],
    ["upload blocks executable", testUploadBlocksExecutable],
    ["upload blocks oversize", testUploadBlocksOversize],
    ["upload blocks script content", testUploadBlocksScriptContent],
    ["upload accepts valid pdf", testUploadAcceptsValidPdf],
    ["upload rejects mime-spoofed pdf", testUploadRejectsMimeSpoofedPdf],
    ["extracted text scanning", testExtractedTextScan],
    ["reset token entropy", testResetTokenEntropy],
    ["reset token hashed at rest", testTokenHashingOneWay],
    ["rbac role hierarchy", testRoleHierarchy],
    ["rbac role validation", testRoleValidation],
    ["jwt redacted from logs", testJwtRedactedFromLogs],
  ];

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

  console.log(`\nSecurity tests: ${passed}/${tests.length} passed`);
}

void main();
