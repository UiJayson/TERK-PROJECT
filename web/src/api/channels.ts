import { getStoredToken } from "../auth/api";



export interface PublicWhatsAppChannel {
  connected: boolean;
  status: "connected" | "disconnected" | "error";
  phoneNumberId: string | null;
  wabaId: string | null;
  accessTokenMasked: string | null;
  webhookVerifyTokenMasked: string | null;
  connectedAt: string | null;
  webhookUrl: string | null;
  lastWebhookAt: string | null;
  lastError: { status: number; message: string; at: string } | null;
}



export interface PublicInstagramChannel {
  connected: boolean;
  businessAccountId: string | null;
  accessTokenMasked: string | null;
  webhookVerifyTokenMasked: string | null;
  webhookUrl: string | null;
  connectedAt: string | null;
  lastError: { status: number; message: string; at: string } | null;
}



export interface PublicChannelsStatus {

  whatsapp: PublicWhatsAppChannel;

  instagram: PublicInstagramChannel;

}



export interface WhatsAppWebhookLog {

  id: string;

  workspaceId: string | null;

  phoneNumberId: string | null;

  messageId: string | null;

  eventType: string;

  direction: string;

  status: string;

  payload: Record<string, unknown>;

  errorMessage: string | null;

  createdAt: string;

}



async function request(path: string, init: RequestInit = {}) {

  const token = getStoredToken();

  const response = await fetch(path, {

    ...init,

    credentials: "include",

    headers: {

      "Content-Type": "application/json",

      ...(token ? { Authorization: `Bearer ${token}` } : {}),

      ...(init.headers ?? {}),

    },

  });



  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {

    throw new Error(String(data.error ?? "Request failed"));

  }

  return data;

}



export async function fetchChannelsStatus(): Promise<PublicChannelsStatus> {

  const data = await request("/api/channels");

  return data.channels as PublicChannelsStatus;

}



export async function connectWhatsApp(input: {

  phoneNumberId: string;

  wabaId?: string;

  accessToken: string;

  webhookVerifyToken: string;

}): Promise<PublicChannelsStatus> {

  const data = await request("/api/channels/whatsapp", {

    method: "PATCH",

    body: JSON.stringify(input),

  });

  return data.channels as PublicChannelsStatus;

}



export async function connectInstagram(input: {
  businessAccountId: string;
  accessToken: string;
  webhookVerifyToken: string;
}): Promise<PublicChannelsStatus> {

  const data = await request("/api/channels/instagram", {

    method: "PATCH",

    body: JSON.stringify(input),

  });

  return data.channels as PublicChannelsStatus;

}



export async function sendWhatsAppTestMessage(input: {

  to: string;

  message?: string;

}): Promise<PublicChannelsStatus> {

  const data = await request("/api/channels/whatsapp/test", {

    method: "POST",

    body: JSON.stringify(input),

  });

  return data.channels as PublicChannelsStatus;

}



export async function fetchWhatsAppWebhookLogs(): Promise<WhatsAppWebhookLog[]> {

  const data = await request("/api/channels/whatsapp/logs");

  return (data.logs as WhatsAppWebhookLog[]) ?? [];

}

