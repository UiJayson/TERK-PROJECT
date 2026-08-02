import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH_API_VERSION = "v21.0";

export interface WhatsAppSendResult {
  messageId?: string;
}

export class WhatsAppApiError extends Error {
  status: number;
  code?: number;
  body: string;

  constructor(status: number, body: string, code?: number) {
    super(`WhatsApp API error (${status}): ${body}`);
    this.name = "WhatsAppApiError";
    this.status = status;
    this.body = body;
    this.code = code;
  }

  get isTokenExpired(): boolean {
    return this.status === 401;
  }
}

function graphUrl(phoneNumberId: string, path = "messages"): string {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/${path}`;
}

async function parseApiError(response: Response): Promise<WhatsAppApiError> {
  const body = await response.text();
  let code: number | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; message?: string } };
    code = parsed.error?.code;
  } catch {
    // ignore JSON parse errors
  }
  return new WhatsAppApiError(response.status, body, code);
}

export async function sendTextMessage(input: {
  phone: string;
  text: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<WhatsAppSendResult> {
  const response = await fetch(graphUrl(input.phoneNumberId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.phone,
      type: "text",
      text: { body: input.text },
    }),
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  const data = (await response.json()) as { messages?: Array<{ id?: string }> };
  return { messageId: data.messages?.[0]?.id };
}

export async function sendTypingIndicator(input: {
  phone: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<void> {
  const response = await fetch(graphUrl(input.phoneNumberId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.phone,
      typing_indicator: { type: "text" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.warn(`WhatsApp typing indicator failed (${response.status}): ${detail}`);
  }
}

export async function markMessageRead(input: {
  messageId: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<void> {
  const response = await fetch(graphUrl(input.phoneNumberId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: input.messageId,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.warn(`WhatsApp mark-read failed (${response.status}): ${detail}`);
  }
}

export interface WhatsAppTemplateComponent {
  type: "body" | "header" | "button";
  parameters: Array<{ type: "text"; text: string }>;
}

export async function sendTemplateMessage(input: {
  phone: string;
  templateName: string;
  languageCode?: string;
  components?: WhatsAppTemplateComponent[];
  phoneNumberId: string;
  accessToken: string;
}): Promise<WhatsAppSendResult> {
  const response = await fetch(graphUrl(input.phoneNumberId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.phone,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.languageCode ?? "en" },
        ...(input.components?.length ? { components: input.components } : {}),
      },
    }),
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  const data = (await response.json()) as { messages?: Array<{ id?: string }> };
  return { messageId: data.messages?.[0]?.id };
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !appSecret) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.slice("sha256=".length);

  try {
    return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
