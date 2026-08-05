/**
 * Background function that owns the heavy per-message Instagram DM pipeline.
 * Mirrors `whatsapp-process-background.ts` — see that file's header and
 * plans/eager-sparking-kahan.md for the design.
 */
import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { getConfig, isProduction } from "./_shared/config.ts";
import {
  handleIncomingMessage,
  type InstagramIncomingMessage,
} from "./_shared/instagram-processor.ts";

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function handler(req: Request, _context: Context) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedSecret = getConfig().app.internalWebhookSecret;
  const providedSecret = req.headers.get("x-internal-secret");

  if (expectedSecret) {
    if (!providedSecret || !timingSafeEqualStrings(providedSecret, expectedSecret)) {
      console.warn("instagram-process-background: internal secret mismatch");
      return new Response("Forbidden", { status: 403 });
    }
  } else if (isProduction()) {
    console.error(
      "instagram-process-background: INTERNAL_WEBHOOK_SECRET not set — refusing request",
    );
    return new Response("Forbidden", { status: 403 });
  }

  let messages: InstagramIncomingMessage[];
  try {
    const body = (await req.json()) as { messages?: InstagramIncomingMessage[] };
    messages = Array.isArray(body?.messages) ? body.messages : [];
  } catch (error) {
    console.error("instagram-process-background: invalid body", error);
    return new Response("Bad Request", { status: 400 });
  }

  for (const message of messages) {
    try {
      await handleIncomingMessage(message);
    } catch (error) {
      console.error("Instagram message handling failed:", error);
    }
  }

  return new Response("OK", { status: 200 });
}

export const config = {
  path: "/internal/instagram/process",
  method: "POST",
  background: true,
} as Config & { background: true };

export default withObservability(handler);
