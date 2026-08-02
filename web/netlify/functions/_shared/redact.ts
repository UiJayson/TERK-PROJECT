const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "token",
  "accesstoken",
  "access_token",
  "accesstokenenc",
  "access_token_enc",
  "refreshtoken",
  "refresh_token",
  "authorization",
  "apikey",
  "api_key",
  "secret",
  "auth_secret",
  "stripe_secret_key",
  "resend_api_key",
  "webhookverifytoken",
  "webhook_verify_token",
  "cookie",
  "set-cookie",
  "email",
  "phone",
  "customerphone",
  "customer_phone",
  "message",
  "body",
  "content",
  "text",
  "name",
  "customername",
  "customer_name",
]);

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\b\+?\d[\d\s().-]{7,}\d\b/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._-]+/gi;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export function redactString(value: string): string {
  return value
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]");
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return SENSITIVE_KEYS.has(normalized);
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[REDACTED_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      next[key] = isSensitiveKey(key) ? "[REDACTED]" : redactValue(child, depth + 1);
    }
    return next;
  }
  return "[REDACTED]";
}
