const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SCRIPT_TAG = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const EVENT_HANDLER = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

export function sanitizeText(input: string, maxLength = 10_000): string {
  return input
    .replace(CONTROL_CHARS, "")
    .replace(SCRIPT_TAG, "")
    .replace(EVENT_HANDLER, "")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeOptionalText(
  input: string | undefined,
  maxLength = 10_000,
): string | undefined {
  if (input === undefined) return undefined;
  return sanitizeText(input, maxLength);
}

export function sanitizeRecordStrings(
  record: Record<string, unknown>,
  keys: string[],
  maxLength = 10_000,
): Record<string, unknown> {
  const next = { ...record };
  for (const key of keys) {
    const value = next[key];
    if (typeof value === "string") {
      next[key] = sanitizeText(value, maxLength);
    }
  }
  return next;
}
