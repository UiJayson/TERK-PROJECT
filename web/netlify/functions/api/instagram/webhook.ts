import type { Config, Context } from "@netlify/functions";
import { withObservability, setObservabilityContext, timedOperation } from "../../_shared/observability.ts";
import { getConfig, isProduction } from "../../_shared/config.ts";
import { createId } from "../../_shared/auth-crypto.ts";
import { processWorkspaceMessage } from "../../_shared/ai-runtime.ts";
import {
  findWorkspaceByInstagramBusinessAccountId,
  getInstagramSession,
  matchesAnyInstagramWebhookVerifyToken,
  recordInstagramChannelError,
  saveInstagramConversationBlob,
  saveInstagramSession,
} from "../../_shared/channels-store.ts";
import { tryAutoCaptureLead } from "../../_shared/lead-capture.ts";
import { verifyMetaWebhookSignature } from "../../_shared/whatsapp.ts";
import {
  sendDM,
  InstagramSenderError,
} from "../../_shared/instagram-sender.ts";
import { waitForHumanDelay } from "../../_shared/response-delay.ts";

interface InstagramIncomingMessage {
  messageId: string;
  senderId: string;
  messageText: string;
  timestamp: string;
  businessAccountId: string;
}

interface InstagramWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
      };
    }>;
  }>;
}

function parseIncomingMessages(payload: InstagramWebhookPayload): InstagramIncomingMessage[] {
  const results: InstagramIncomingMessage[] = [];
  if (payload.object !== "instagram") return results;

  for (const entry of payload.entry ?? []) {
    const businessAccountId = entry.id;
    if (!businessAccountId) continue;

    for (const event of entry.messaging ?? []) {
      const text = event.message?.text?.trim();
      const senderId = event.sender?.id;
      const messageId = event.message?.mid;
      if (!text || !senderId || !messageId) continue;

      results.push({
        messageId,
        senderId,
        messageText: text,
        timestamp: event.timestamp
          ? new Date(event.timestamp).toISOString()
          : new Date().toISOString(),
        businessAccountId,
      });
    }
  }

  return results;
}

function getAppSecret(): string {
  return getConfig().whatsapp.appSecret ?? "";
}

async function handleIncomingMessage(message: InstagramIncomingMessage): Promise<void> {
  const match = await findWorkspaceByInstagramBusinessAccountId(message.businessAccountId);
  if (!match) {
    console.warn(
      `No workspace for Instagram business account ID: ${message.businessAccountId}`,
    );
    return;
  }

  const { workspaceId, instagram } = match;
  setObservabilityContext({ workspaceId });

  try {
    await timedOperation(
      { category: "webhook", operation: "instagram_message", workspaceId },
      async () => {
        const session = await getInstagramSession(workspaceId, message.senderId);

        const result = await processWorkspaceMessage({
          workspaceId,
          message: message.messageText,
          history: session.history,
          state: session.state,
          channel: "instagram",
          conversationId: session.conversationId,
          collectedFields: {
            instagram_id: message.senderId,
          },
        });

        if (result.conversation) {
          await saveInstagramConversationBlob(
            workspaceId,
            result.conversation.id,
            result.conversation,
          );
        }

        await saveInstagramSession(workspaceId, message.senderId, {
          conversationId: result.conversation?.id ?? session.conversationId,
          state: result.state,
          history: [
            ...session.history,
            { role: "user" as const, content: message.messageText },
            { role: "assistant" as const, content: result.reply },
          ].slice(-20),
        });

        await waitForHumanDelay(result.reply);

        console.info(
          `Sending Instagram reply to ${message.senderId} (workspace ${workspaceId})`,
        );
        await sendDM(
          message.senderId,
          result.reply,
          instagram.accessToken,
          instagram.businessAccountId,
          { workspaceId, queueOnFailure: true },
        );

        await tryAutoCaptureLead({
          workspaceId,
          message: message.messageText,
          channel: "instagram",
          conversationId: result.conversation?.id,
          agentUsed: result.agent,
          collectedFields: {
            instagram_id: message.senderId,
          },
        });
      },
    );
  } catch (error) {
    if (error instanceof InstagramSenderError) {
      await recordInstagramChannelError(workspaceId, error);
      if (error.isTokenExpired) {
        console.error("Instagram token expired — notify workspace admin via Integrations");
      }
    }
    throw error;
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

      for (const message of messages) {
        try {
          await handleIncomingMessage(message);
        } catch (error) {
          console.error("Instagram message handling failed:", error);
        }
      }

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
