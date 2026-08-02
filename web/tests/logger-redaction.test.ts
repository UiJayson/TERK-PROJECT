import { redactString, redactValue } from "../web/netlify/functions/_shared/redact.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function testRedactString(): void {
  const input =
    "Contact user@example.com or Bearer sk_live_secret and phone +447700900123";
  const redacted = redactString(input);
  assert(!redacted.includes("user@example.com"), "email must be redacted");
  assert(!redacted.includes("sk_live_secret"), "bearer token must be redacted");
  assert(!redacted.includes("447700900123"), "phone must be redacted");
}

function testRedactObject(): void {
  const redacted = redactValue({
    workspace_id: "ws_123",
    email: "owner@example.com",
    password: "super-secret",
    nested: { access_token: "abc", count: 2 },
  }) as Record<string, unknown>;

  assert(redacted.workspace_id === "ws_123", "workspace id should remain");
  assert(redacted.email === "[REDACTED]", "email key must redact");
  assert(redacted.password === "[REDACTED]", "password key must redact");
  assert(
    (redacted.nested as Record<string, unknown>).access_token === "[REDACTED]",
    "nested token must redact",
  );
}

function main(): void {
  const tests = [
    ["redact string", testRedactString],
    ["redact object", testRedactObject],
  ] as const;

  let passed = 0;
  for (const [name, run] of tests) {
    try {
      run();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (error) {
      console.error(`FAIL  ${name}:`, error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }

  console.log(`\nLogger redaction tests: ${passed}/${tests.length} passed`);
  if (process.exitCode) process.exit(process.exitCode);
}

main();
