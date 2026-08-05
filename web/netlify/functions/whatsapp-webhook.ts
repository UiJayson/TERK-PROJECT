/**
 * Sync front-door for Meta's WhatsApp webhook.
 *
 * Meta's synchronous request lands here. We do only fast, security-critical
 * work — signature verification and payload parsing — then fan the parsed
 * messages to `whatsapp-process-background.ts` (a Netlify Background Function
 * that gets 15 minutes to run the AI pipeline). This keeps Meta's request
 * well under Netlify's synchronous-function timeout even when the AI is
 * slow. See plans/eager-sparking-kahan.md.
 */
import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { createId } from "./_shared/auth-crypto.ts";
import { getConfig, getSiteUrl, isProduction } from "./_shared/config.ts";
import {
  logWhatsAppWebhookEvent,
  matchesAnyWhatsAppWebhookVerifyToken,
} from "./_shared/channels-store.ts";
import { verifyMetaWebhookSignature } from "./_shared/whatsapp.ts";
import {
  parseIncomingMessages,
  type WhatsAppIncomingMessage,
  type WhatsAppWebhookPayload,
} from "./_shared/whatsapp-processor.ts";

function getAppSecret(): string {
  return getConfig().whatsapp.appSecret ?? "";
}

async function forwardToBackground(messages: WhatsAppIncomingMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const target = new URL("/internal/whatsapp/process", getSiteUrl()).toString();
  const secret = getConfig().app.internalWebhookSecret;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["x-internal-secret"] = secret;

  try {
    // Background functions return 202 immediately, so awaiting this call is
    // effectively awaiting the round trip to Netlify's edge — cheap. We do
    // wait for the response so an internal delivery failure surfaces in
    // logs; we never block on the heavy pipeline itself.
    const response = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify({ messages }),
    });
    if (!response.ok && response.status !== 202) {
      console.warn(
        `whatsapp background dispatch returned ${response.status}: ${await response.text().catch(() => "")}`,
      );
    }
  } catch (error) {
    console.error("Failed to dispatch WhatsApp messages to background:", error);
  }
}

async function handler(req: Request, _context: Context) {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (
      mode === "subscribe" &&
      verifyToken &&
      challenge &&
      (await matchesAnyWhatsAppWebhookVerifyToken(verifyToken))
    ) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST") {
    const rawBody = await req.text();
    const appSecret = getAppSecret();

    if (appSecret) {
      const signature = req.headers.get("x-hub-signature-256");
      if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
        console.warn("WhatsApp webhook signature verification failed");
        return new Response("Forbidden", { status: 403 });
      }
    } else if (isProduction()) {
      // Fail closed: without the app secret we cannot verify the payload came
      // from Meta, and unsigned payloads can trigger AI spend + outbound sends.
      console.error("WHATSAPP_APP_SECRET not set — rejecting unverified webhook in production");
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
      const messages = parseIncomingMessages(payload);

      await logWhatsAppWebhookEvent({
        id: createId("walog"),
        status: "received",
        eventType: "webhook",
        payload: { messageCount: messages.length },
      });

      // Fan out to the background function. Handoff is fast (fetch to
      // Netlify's edge), so we can await it and still return 200 to Meta
      // well before the sync timeout.
      await forwardToBackground(messages);

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("WhatsApp webhook error:", error);
      await logWhatsAppWebhookEvent({
        id: createId("walog"),
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Webhook parse error",
        payload: {},
      }).catch(() => undefined);
      return new Response("OK", { status: 200 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}

export const config: Config = {
  path: "/api/whatsapp/webhook",
};

export default withObservability(handler);
