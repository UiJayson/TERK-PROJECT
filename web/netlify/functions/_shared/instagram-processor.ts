/**
 * Heavy per-message processing for Instagram DM webhooks.
 *
 * Extracted from `api/instagram/webhook.ts` so the sync front-door and the
 * background function share one canonical implementation. See
 * plans/eager-sparking-kahan.md.
 */
import { setObservabilityContext, timedOperation } from "./observability.ts";
import { processWorkspaceMessage } from "./ai-runtime.ts";
import {
  findWorkspaceByInstagramBusinessAccountId,
  getInstagramSession,
  recordInstagramChannelError,
  saveInstagramConversationBlob,
  saveInstagramSession,
} from "./channels-store.ts";
import { tryAutoCaptureLead } from "./lead-capture.ts";
import { sendDM, InstagramSenderError } from "./instagram-sender.ts";
import { waitForHumanDelay } from "./response-delay.ts";

export interface InstagramIncomingMessage {
  messageId: string;
  senderId: string;
  messageText: string;
  timestamp: string;
  businessAccountId: string;
}

export interface InstagramWebhookPayload {
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

export function parseIncomingMessages(payload: InstagramWebhookPayload): InstagramIncomingMessage[] {
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

export async function handleIncomingMessage(message: InstagramIncomingMessage): Promise<void> {
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
