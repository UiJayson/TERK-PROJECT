/**
 * Background function that owns the heavy per-message WhatsApp pipeline.
 *
 * The sync front-door (`whatsapp-webhook.ts`) verifies Meta's signature and
 * fans the parsed messages here so it can return `200 OK` to Meta well under
 * Netlify's synchronous-function timeout. This function gets up to 15 minutes
 * (Netlify's Background Function ceiling) to run the AI pipeline, DB writes,
 * and outbound WhatsApp Send API call.
 *
 * See plans/eager-sparking-kahan.md.
 */
import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { getConfig, isProduction } from "./_shared/config.ts";
import {
  handleIncomingMessage,
  type WhatsAppIncomingMessage,
} from "./_shared/whatsapp-processor.ts";

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
      console.warn("whatsapp-process-background: internal secret mismatch");
      return new Response("Forbidden", { status: 403 });
    }
  } else if (isProduction()) {
    // Fail closed in production so nobody can reach this endpoint and drive
    // AI spend + outbound WhatsApp sends without the shared secret.
    console.error(
      "whatsapp-process-background: INTERNAL_WEBHOOK_SECRET not set — refusing request",
    );
    return new Response("Forbidden", { status: 403 });
  }

  let messages: WhatsAppIncomingMessage[];
  try {
    const body = (await req.json()) as { messages?: WhatsAppIncomingMessage[] };
    messages = Array.isArray(body?.messages) ? body.messages : [];
  } catch (error) {
    console.error("whatsapp-process-background: invalid body", error);
    return new Response("Bad Request", { status: 400 });
  }

  for (const message of messages) {
    try {
      await handleIncomingMessage(message);
    } catch (error) {
      console.error("WhatsApp message handling failed:", error);
    }
  }

  return new Response("OK", { status: 200 });
}

// `background: true` isn't in @netlify/functions@3.1.10 types yet, but the
// runtime honors it. Cast keeps the rest of the object type-checked.
export const config = {
  path: "/internal/whatsapp/process",
  method: "POST",
  background: true,
} as Config & { background: true };

export default withObservability(handler);
