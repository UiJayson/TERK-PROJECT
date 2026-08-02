/**
 * Security utilities for the public embed widget.
 *
 * The widget runs on untrusted third-party pages, and everything it renders
 * comes back from the chat API (agent replies, product cards configured by
 * the workspace owner). React already escapes text nodes, so the remaining
 * sinks are URL-shaped attributes — lock those down here.
 */

/** Hard client-side cap, mirrors the server's 4000-char limit in chat.ts. */
export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Allow only http(s) URLs for images rendered inside the widget.
 * Blocks javascript:, data:, blob:, vbscript: and anything unparseable.
 * Returns null when the URL must not be rendered.
 */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://localhost";
    const parsed = new URL(url, base);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

/** Trim and clamp an outgoing chat message to the server-enforced limit. */
export function clampMessage(text: string): string {
  return text.trim().slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Validates a widget public key shape before it is sent anywhere:
 * `pk_` + 32 hex chars (UUIDv4 without dashes). Anything else is noise and
 * gets rejected client-side without burning a request.
 */
export function isValidPublicKeyFormat(key: string | null | undefined): boolean {
  return typeof key === "string" && /^pk_[a-f0-9]{32}$/i.test(key);
}
