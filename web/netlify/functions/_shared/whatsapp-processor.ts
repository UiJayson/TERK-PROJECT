/**
 * Heavy per-message processing for WhatsApp webhooks.
 *
 * Extracted from `whatsapp-webhook.ts` so both the sync front-door (which
 * verifies Meta's signature and immediately returns 200) and the background
 * function (which owns the actual AI + outbound-send pipeline) share one
 * canonical implementation. See plans/eager-sparking-kahan.md.
 */
import { createId } from "./auth-crypto.ts";
import { processWorkspaceMessage } from "./ai-runtime.ts";
import {
  claimWhatsAppMessageId,
  findWorkspaceByWhatsAppPhoneNumberId,
  getWhatsAppSession,
  logWhatsAppWebhookEvent,
  recordWhatsAppChannelError,
  saveWhatsAppConversationBlob,
  saveWhatsAppSession,
} from "./channels-store.ts";
import { tryAutoCaptureLead } from "./lead-capture.ts";
import { markMessageRead } from "./whatsapp.ts";
import {
  sendTextMessage,
  sendTypingIndicator,
  WhatsAppSenderError,
} from "./whatsapp-sender.ts";
import { waitForHumanDelay } from "./response-delay.ts";
import { setObservabilityContext, timedOperation } from "./observability.ts";

export interface WhatsAppIncomingMessage {
  messageId: string;
  senderPhone: string;
  messageText: string;
  messageType: string;
  timestamp: string;
  phoneNumberId: string;
  customerName?: string;
}

export interface WhatsAppWebhookPayload {
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

export function parseIncomingMessages(payload: WhatsAppWebhookPayload): WhatsAppIncomingMessage[] {
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

export async function handleIncomingMessage(message: WhatsAppIncomingMessage): Promise<void> {
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
