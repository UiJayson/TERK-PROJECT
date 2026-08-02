import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { getConfig, isProduction } from "./_shared/config.ts";
import { createId } from "./_shared/auth-crypto.ts";
import { processWorkspaceMessage } from "./_shared/ai-runtime.ts";
import {
  claimWhatsAppMessageId,
  findWorkspaceByWhatsAppPhoneNumberId,
  getWhatsAppSession,
  logWhatsAppWebhookEvent,
  matchesAnyWhatsAppWebhookVerifyToken,
  recordWhatsAppChannelError,
  saveWhatsAppConversationBlob,
  saveWhatsAppSession,
} from "./_shared/channels-store.ts";
import { tryAutoCaptureLead } from "./_shared/lead-capture.ts";
import {
  markMessageRead,
  verifyMetaWebhookSignature,
} from "./_shared/whatsapp.ts";
import {
  sendTextMessage,
  sendTypingIndicator,
  WhatsAppSenderError,
} from "./_shared/whatsapp-sender.ts";
import { waitForHumanDelay } from "./_shared/response-delay.ts";
import { setObservabilityContext, timedOperation } from "./_shared/observability.ts";

interface WhatsAppIncomingMessage {
  messageId: string;
  senderPhone: string;
  messageText: string;
  messageType: string;
  timestamp: string;
  phoneNumberId: string;
  customerName?: string;
}

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: {
          phone_number_id?: string;
        };
        contacts?: Array<{
          profile?: { name?: string };
          wa_id?: string;
        }>;
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          image?: { caption?: string; id?: string };
          document?: { caption?: string; filename?: string; id?: string };
          audio?: { id?: string };
          location?: { latitude?: number; longitude?: number; name?: string; address?: string };
        }>;
      };
    }>;
  }>;
}

function extractMessageContent(message: {
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  document?: { caption?: string; filename?: string };
  audio?: { id?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
}): { text: string; type: string } | null {
  if (!message?.type) return null;

  switch (message.type) {
    case "text":
      if (!message.text?.body?.trim()) return null;
      return { text: message.text.body.trim(), type: "text" };
    case "image":
      return {
        text: message.image?.caption?.trim() || "[Image received]",
        type: "image",
      };
    case "document":
      return {
        text:
          message.document?.caption?.trim() ||
          `[Document received: ${message.document?.filename ?? "file"}]`,
        type: "document",
      };
    case "audio":
      return { text: "[Voice message received]", type: "audio" };
    case "location": {
      const loc = message.location;
      if (!loc) return null;
      const label = loc.name || loc.address || `${loc.latitude}, ${loc.longitude}`;
      return { text: `[Location shared: ${label}]`, type: "location" };
    }
    default:
      return null;
  }
}

function parseIncomingMessages(payload: WhatsAppWebhookPayload): WhatsAppIncomingMessage[] {
  const results: WhatsAppIncomingMessage[] = [];
  if (payload.object !== "whatsapp_business_account") return results;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const contactName = value.contacts?.[0]?.profile?.name;

      for (const message of value.messages ?? []) {
        const content = extractMessageContent(message);
        if (!content || !message.from || !message.id) continue;

        results.push({
          messageId: message.id,
          senderPhone: message.from,
          messageText: content.text,
          messageType: content.type,
          timestamp: message.timestamp ?? new Date().toISOString(),
          phoneNumberId,
          customerName: contactName,
        });
      }
    }
  }

  return results;
}

function getAppSecret(): string {
  return getConfig().whatsapp.appSecret ?? "";
}

async function handleIncomingMessage(message: WhatsAppIncomingMessage): Promise<void> {
  const match = await findWorkspaceByWhatsAppPhoneNumberId(message.phoneNumberId);
  if (!match) {
    await logWhatsAppWebhookEvent({
      id: createId("walog"),
      phoneNumberId: message.phoneNumberId,
      messageId: message.messageId,
      status: "failed",
      errorMessage: "No workspace matched phone_number_id",
      payload: { senderPhone: message.senderPhone },
    });
    console.warn(`No workspace for WhatsApp phone number ID: ${message.phoneNumberId}`);
    return;
  }

  const claimed = await claimWhatsAppMessageId({
    messageId: message.messageId,
    workspaceId: match.workspaceId,
    phoneNumberId: message.phoneNumberId,
    senderPhone: message.senderPhone,
  });

  if (!claimed) {
    await logWhatsAppWebhookEvent({
      id: createId("walog"),
      workspaceId: match.workspaceId,
      phoneNumberId: message.phoneNumberId,
      messageId: message.messageId,
      status: "duplicate",
      payload: { senderPhone: message.senderPhone },
    });
    return;
  }

  const { workspaceId, whatsapp } = match;
  setObservabilityContext({ workspaceId });

  await logWhatsAppWebhookEvent({
    id: createId("walog"),
    workspaceId,
    phoneNumberId: message.phoneNumberId,
    messageId: message.messageId,
    eventType: message.messageType,
    status: "received",
    payload: {
      senderPhone: message.senderPhone,
      preview: message.messageText.slice(0, 120),
    },
  });

  try {
    await timedOperation(
      { category: "webhook", operation: "whatsapp_message", workspaceId },
      async () => {
    await markMessageRead({
      messageId: message.messageId,
      phoneNumberId: whatsapp.phoneNumberId,
      accessToken: whatsapp.accessToken,
    });

    await sendTypingIndicator(
      message.senderPhone,
      whatsapp.phoneNumberId,
      whatsapp.accessToken,
    );

    const session = await getWhatsAppSession(workspaceId, message.senderPhone);

    const result = await processWorkspaceMessage({
      workspaceId,
      message: message.messageText,
      history: session.history,
      state: session.state,
      channel: "whatsapp",
      conversationId: session.conversationId,
      collectedFields: {
        phone: message.senderPhone,
        ...(message.customerName ? { name: message.customerName } : {}),
      },
    });

    if (result.conversation) {
      await saveWhatsAppConversationBlob(workspaceId, result.conversation.id, result.conversation);
    }

    await saveWhatsAppSession(workspaceId, message.senderPhone, {
      conversationId: result.conversation?.id ?? session.conversationId,
      state: result.state,
      history: [
        ...session.history,
        { role: "user" as const, content: message.messageText },
        { role: "assistant" as const, content: result.reply },
      ].slice(-20),
    });

    await sendTypingIndicator(
      message.senderPhone,
      whatsapp.phoneNumberId,
      whatsapp.accessToken,
    );

    await waitForHumanDelay(result.reply);

    console.info(`Sending WhatsApp reply to ${message.senderPhone} (workspace ${workspaceId})`);
    const sendResult = await sendTextMessage(
      message.senderPhone,
      result.reply,
      whatsapp.phoneNumberId,
      whatsapp.accessToken,
      { workspaceId, queueOnFailure: true },
    );
    console.info(`WhatsApp send complete:`, sendResult.messageId ?? "queued-or-sent");

    await tryAutoCaptureLead({
      workspaceId,
      message: message.messageText,
      channel: "whatsapp",
      conversationId: result.conversation?.id,
      agentUsed: result.agent,
      collectedFields: {
        phone: message.senderPhone,
        ...(message.customerName ? { name: message.customerName } : {}),
      },
    });

    await logWhatsAppWebhookEvent({
      id: createId("walog"),
      workspaceId,
      phoneNumberId: message.phoneNumberId,
      messageId: message.messageId,
      eventType: "message",
      direction: "outbound",
      status: "processed",
      payload: {
        agent: result.agent,
        replyPreview: result.reply.slice(0, 120),
      },
    });
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "WhatsApp handling failed";

    if (error instanceof WhatsAppSenderError) {
      await recordWhatsAppChannelError(workspaceId, error);
      if (error.isTokenExpired) {
        console.error("WhatsApp token expired — notify workspace admin via Integrations");
      }
    }

    await logWhatsAppWebhookEvent({
      id: createId("walog"),
      workspaceId,
      phoneNumberId: message.phoneNumberId,
      messageId: message.messageId,
      status: "failed",
      errorMessage,
      payload: { senderPhone: message.senderPhone },
    });

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

      for (const message of messages) {
        try {
          await handleIncomingMessage(message);
        } catch (error) {
          console.error("WhatsApp message handling failed:", error);
        }
      }

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
};

export const config: Config = {
  path: "/api/whatsapp/webhook",
};

export default withObservability(handler);
