import { createId } from "./auth-crypto.ts";
import * as db from "./db.ts";

const GRAPH_API_VERSION = "v18.0";

export interface WhatsAppSendResult {
  messageId?: string;
}

export class WhatsAppSenderError extends Error {
  status: number;
  code?: number;
  body: string;

  constructor(status: number, body: string, code?: number) {
    super(`WhatsApp API error (${status}): ${body}`);
    this.name = "WhatsAppSenderError";
    this.status = status;
    this.body = body;
    this.code = code;
  }

  get isTokenExpired(): boolean {
    return this.status === 401;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}

function graphUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
}

async function parseApiError(response: Response): Promise<WhatsAppSenderError> {
  const body = await response.text();
  let code: number | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; message?: string } };
    code = parsed.error?.code;
  } catch {
    // ignore JSON parse errors
  }
  return new WhatsAppSenderError(response.status, body, code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postMessage(
  phoneNumberId: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(graphUrl(phoneNumberId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function queuePendingMessage(input: {
  workspaceId: string;
  toPhone: string;
  messageText: string;
  phoneNumberId: string;
  errorMessage: string;
}): Promise<void> {
  await db.insertPendingMessage({
    id: createId("pmsg"),
    workspaceId: input.workspaceId,
    toPhone: input.toPhone,
    messageText: input.messageText,
    phoneNumberId: input.phoneNumberId,
    errorMessage: input.errorMessage,
  });
}

async function executeWithRetries(
  phoneNumberId: string,
  accessToken: string,
  body: Record<string, unknown>,
  logContext: string,
): Promise<WhatsAppSendResult> {
  const rateLimitDelays = [2000, 4000];
  let serverRetried = false;

  for (let attempt = 0; attempt < rateLimitDelays.length + 2; attempt++) {
    const response = await postMessage(phoneNumberId, accessToken, body);

    if (response.ok) {
      const data = (await response.json()) as { messages?: Array<{ id?: string }> };
      console.info(`WhatsApp send OK (${logContext}):`, data.messages?.[0]?.id ?? "no-id");
      return { messageId: data.messages?.[0]?.id };
    }

    const error = await parseApiError(response);

    if (error.isTokenExpired) {
      console.error("WhatsApp token expired");
      throw error;
    }

    if (error.isRateLimited && attempt < rateLimitDelays.length) {
      const delay = rateLimitDelays[attempt];
      console.warn(`WhatsApp rate limited (${logContext}), retrying in ${delay}ms`);
      await sleep(delay);
      continue;
    }

    if (error.isServerError && !serverRetried) {
      serverRetried = true;
      console.warn(`WhatsApp server error (${logContext}), retrying once`);
      await sleep(1000);
      continue;
    }

    throw error;
  }

  throw new WhatsAppSenderError(429, "Rate limit retries exhausted");
}

export async function sendTextMessage(
  toPhone: string,
  text: string,
  phoneNumberId: string,
  accessToken: string,
  options?: { workspaceId?: string; queueOnFailure?: boolean },
): Promise<WhatsAppSendResult> {
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toPhone,
    type: "text",
    text: { body: text, preview_url: false },
  };

  try {
    return await executeWithRetries(phoneNumberId, accessToken, body, `text to ${toPhone}`);
  } catch (error) {
    if (
      options?.queueOnFailure &&
      options.workspaceId &&
      error instanceof WhatsAppSenderError &&
      error.isServerError
    ) {
      await queuePendingMessage({
        workspaceId: options.workspaceId,
        toPhone,
        messageText: text,
        phoneNumberId,
        errorMessage: error.message,
      });
      console.warn(`WhatsApp message queued for retry (workspace ${options.workspaceId})`);
      return {};
    }
    throw error;
  }
}

export async function sendTypingIndicator(
  toPhone: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  try {
    const response = await postMessage(phoneNumberId, accessToken, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toPhone,
      typing_indicator: { type: "text" },
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn(`WhatsApp typing indicator not supported or failed (${response.status}): ${detail}`);
    }
  } catch (error) {
    console.warn("WhatsApp typing indicator skipped:", error);
  }
}

export async function sendTemplateMessage(
  toPhone: string,
  templateName: string,
  languageCode: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<WhatsAppSendResult> {
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  };

  return executeWithRetries(
    phoneNumberId,
    accessToken,
    body,
    `template ${templateName} to ${toPhone}`,
  );
}
