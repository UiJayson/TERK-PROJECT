/**
 * Sync front-door for Meta's Instagram DM webhook. Mirrors the WhatsApp
 * front-door — signature verify, parse, fan out to the background function,
 * return 200. See `whatsapp-webhook.ts` and plans/eager-sparking-kahan.md.
 */
import type { Config, Context } from "@netlify/functions";
import { withObservability } from "../../_shared/observability.ts";
import { getConfig, getSiteUrl, isProduction } from "../../_shared/config.ts";
import { matchesAnyInstagramWebhookVerifyToken } from "../../_shared/channels-store.ts";
import { verifyMetaWebhookSignature } from "../../_shared/whatsapp.ts";
import {
  parseIncomingMessages,
  type InstagramIncomingMessage,
  type InstagramWebhookPayload,
} from "../../_shared/instagram-processor.ts";

function getAppSecret(): string {
  return getConfig().whatsapp.appSecret ?? "";
}

async function forwardToBackground(messages: InstagramIncomingMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const target = new URL("/internal/instagram/process", getSiteUrl()).toString();
  const secret = getConfig().app.internalWebhookSecret;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["x-internal-secret"] = secret;

  try {
    const response = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify({ messages }),
    });
    if (!response.ok && response.status !== 202) {
      console.warn(
        `instagram background dispatch returned ${response.status}: ${await response.text().catch(() => "")}`,
      );
    }
  } catch (error) {
    console.error("Failed to dispatch Instagram messages to background:", error);
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
      (await matchesAnyInstagramWebhookVerifyToken(verifyToken))
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
        console.warn("Instagram webhook signature verification failed");
        return new Response("Forbidden", { status: 403 });
      }
    } else if (isProduction()) {
      // Fail closed: unsigned payloads can trigger AI spend + outbound DMs.
      console.error("META_APP_SECRET not set — rejecting unverified webhook in production");
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const payload = JSON.parse(rawBody) as InstagramWebhookPayload;
      const messages = parseIncomingMessages(payload);
      await forwardToBackground(messages);
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Instagram webhook error:", error);
      return new Response("OK", { status: 200 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}

export const config: Config = {
  path: "/api/instagram/webhook",
};

export default withObservability(handler);
