import type { ConversationState } from "./types.ts";
import type { ChatMessage } from "./types.ts";
import type { RuntimeConversation } from "./runtime-store.ts";
import { getSiteUrl } from "./config.ts";
import * as db from "./db.ts";
import {
  decryptSecret,
  encryptSecret,
  hashVerifyToken,
  isEncryptedSecret,
} from "./secret-crypto.ts";
import {
  InstagramSenderError,
} from "./instagram-sender.ts";
import {
  sendTextMessage,
  sendTemplateMessage,
  WhatsAppSenderError,
  type WhatsAppSendResult,
} from "./whatsapp-sender.ts";
import { WhatsAppApiError, type WhatsAppTemplateComponent } from "./whatsapp.ts";

export type WhatsAppChannelConfig = {
  phoneNumberId: string;
  wabaId?: string;
  accessToken?: string;
  accessTokenEnc?: string;
  webhookVerifyToken?: string;
  webhookVerifyTokenHash?: string;
  connectedAt: string;
  lastError?: {
    status: number;
    message: string;
    at: string;
  };
}

export type InstagramChannelConfig = {
  businessAccountId: string;
  accessToken?: string;
  accessTokenEnc?: string;
  webhookVerifyToken?: string;
  webhookVerifyTokenHash?: string;
  connectedAt: string;
  lastError?: {
    status: number;
    message: string;
    at: string;
  };
};

export interface ChannelsData {
  whatsapp?: WhatsAppChannelConfig;
  instagram?: InstagramChannelConfig;
}

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

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••••••";
  return `••••••••${value.slice(-4)}`;
}

function resolveAccessToken(config?: {
  accessToken?: string;
  accessTokenEnc?: string;
}): string {
  if (!config) return "";
  if (config.accessTokenEnc) return decryptSecret(config.accessTokenEnc);
  if (config.accessToken && !isEncryptedSecret(config.accessToken)) {
    return config.accessToken;
  }
  return config.accessToken ? decryptSecret(config.accessToken) : "";
}

function resolveVerifyToken(config?: WhatsAppChannelConfig): string {
  if (!config?.webhookVerifyToken) return "";
  return config.webhookVerifyToken;
}

function normalizeWhatsAppConfig(raw?: Record<string, unknown>): WhatsAppChannelConfig | undefined {
  if (!raw) return undefined;
  const config = raw as WhatsAppChannelConfig;
  return {
    phoneNumberId: String(config.phoneNumberId ?? ""),
    wabaId: config.wabaId ? String(config.wabaId) : undefined,
    accessToken: config.accessToken,
    accessTokenEnc: config.accessTokenEnc,
    webhookVerifyToken: config.webhookVerifyToken,
    webhookVerifyTokenHash: config.webhookVerifyTokenHash,
    connectedAt: String(config.connectedAt ?? new Date().toISOString()),
    lastError: config.lastError,
  };
}

function normalizeInstagramConfig(raw?: Record<string, unknown>): InstagramChannelConfig | undefined {
  if (!raw) return undefined;
  const config = raw as InstagramChannelConfig;
  return {
    businessAccountId: String(config.businessAccountId ?? ""),
    accessToken: config.accessToken,
    accessTokenEnc: config.accessTokenEnc,
    webhookVerifyToken: config.webhookVerifyToken,
    webhookVerifyTokenHash: config.webhookVerifyTokenHash,
    connectedAt: String(config.connectedAt ?? new Date().toISOString()),
    lastError: config.lastError,
  };
}

function serializeWhatsAppConfig(config: WhatsAppChannelConfig): Record<string, unknown> {
  const accessToken = resolveAccessToken(config);
  const verifyToken = resolveVerifyToken(config);
  return {
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId,
    accessTokenEnc: accessToken ? encryptSecret(accessToken) : config.accessTokenEnc,
    webhookVerifyTokenHash: verifyToken
      ? config.webhookVerifyTokenHash ?? hashVerifyToken(verifyToken)
      : config.webhookVerifyTokenHash,
    connectedAt: config.connectedAt,
    lastError: config.lastError ?? null,
  };
}

function serializeInstagramConfig(config: InstagramChannelConfig): Record<string, unknown> {
  const accessToken = resolveAccessToken(config);
  const verifyToken = config.webhookVerifyToken ?? "";
  return {
    businessAccountId: config.businessAccountId,
    accessTokenEnc: accessToken ? encryptSecret(accessToken) : config.accessTokenEnc,
    webhookVerifyTokenHash: verifyToken
      ? config.webhookVerifyTokenHash ?? hashVerifyToken(verifyToken)
      : config.webhookVerifyTokenHash,
    connectedAt: config.connectedAt,
    lastError: config.lastError ?? null,
  };
}

function isWhatsAppConnected(config?: WhatsAppChannelConfig): boolean {
  return Boolean(
    config?.phoneNumberId?.trim() &&
      resolveAccessToken(config) &&
      (config.webhookVerifyTokenHash || config.webhookVerifyToken?.trim()),
  );
}

function isInstagramConnected(config?: InstagramChannelConfig): boolean {
  return Boolean(
    config?.businessAccountId?.trim() &&
      resolveAccessToken(config) &&
      (config.webhookVerifyTokenHash || config.webhookVerifyToken?.trim()),
  );
}

function defaultInstagramWebhookUrl(): string | null {
  const siteUrl = getSiteUrl();
  return siteUrl ? `${siteUrl.replace(/\/$/, "")}/api/instagram/webhook` : null;
}

function defaultWebhookUrl(): string | null {
  const siteUrl = getSiteUrl();
  return siteUrl ? `${siteUrl.replace(/\/$/, "")}/api/whatsapp/webhook` : null;
}

export function toPublicChannels(
  data: ChannelsData,
  lastWebhookAt: string | null = null,
): PublicChannelsStatus {
  const whatsappToken = resolveAccessToken(data.whatsapp);
  const instagramToken = resolveAccessToken(data.instagram);
  const whatsappConnected = isWhatsAppConnected(data.whatsapp);
  const whatsappStatus: PublicWhatsAppChannel["status"] = data.whatsapp?.lastError
    ? "error"
    : whatsappConnected
      ? "connected"
      : "disconnected";

  return {
    whatsapp: {
      connected: whatsappConnected,
      status: whatsappStatus,
      phoneNumberId: data.whatsapp?.phoneNumberId ?? null,
      wabaId: data.whatsapp?.wabaId ?? null,
      accessTokenMasked: whatsappToken ? maskSecret(whatsappToken) : null,
      webhookVerifyTokenMasked: data.whatsapp?.webhookVerifyTokenHash
        ? "••••••••configured"
        : data.whatsapp?.webhookVerifyToken
          ? maskSecret(data.whatsapp.webhookVerifyToken)
          : null,
      connectedAt: data.whatsapp?.connectedAt ?? null,
      webhookUrl: defaultWebhookUrl(),
      lastWebhookAt,
      lastError: data.whatsapp?.lastError ?? null,
    },
    instagram: {
      connected: isInstagramConnected(data.instagram),
      businessAccountId: data.instagram?.businessAccountId ?? null,
      accessTokenMasked: instagramToken ? maskSecret(instagramToken) : null,
      webhookVerifyTokenMasked: data.instagram?.webhookVerifyTokenHash
        ? "••••••••configured"
        : data.instagram?.webhookVerifyToken
          ? maskSecret(data.instagram.webhookVerifyToken)
          : null,
      webhookUrl: defaultInstagramWebhookUrl(),
      connectedAt: data.instagram?.connectedAt ?? null,
      lastError: data.instagram?.lastError ?? null,
    },
  };
}

async function loadChannels(workspaceId: string): Promise<ChannelsData> {
  const row = await db.getChannelConfig(workspaceId);
  if (!row) return {};
  return {
    whatsapp: normalizeWhatsAppConfig(row.whatsapp),
    instagram: normalizeInstagramConfig(row.instagram),
  };
}

async function saveChannels(workspaceId: string, data: ChannelsData): Promise<void> {
  await db.saveChannelConfig(workspaceId, {
    whatsapp: data.whatsapp ? serializeWhatsAppConfig(data.whatsapp) : undefined,
    instagram: data.instagram ? serializeInstagramConfig(data.instagram) : undefined,
  });
}

export async function getChannelsStatus(workspaceId: string): Promise<PublicChannelsStatus> {
  const data = await loadChannels(workspaceId);
  const lastWebhookAt = await db.getLastWhatsAppWebhookAt(workspaceId);
  return toPublicChannels(data, lastWebhookAt);
}

export async function saveWhatsAppChannel(
  workspaceId: string,
  input: {
    phoneNumberId: string;
    wabaId?: string;
    accessToken?: string;
    webhookVerifyToken?: string;
  },
): Promise<PublicChannelsStatus> {
  const data = await loadChannels(workspaceId);
  const now = new Date().toISOString();
  const existing = data.whatsapp;

  const accessToken = input.accessToken?.trim() || resolveAccessToken(existing) || "";
  const verifyTokenInput = input.webhookVerifyToken?.trim() || resolveVerifyToken(existing) || "";
  const hasVerifyToken = Boolean(verifyTokenInput || existing?.webhookVerifyTokenHash);

  if (!input.phoneNumberId.trim() || !accessToken || !hasVerifyToken) {
    throw new Error("ALL_WHATSAPP_FIELDS_REQUIRED");
  }

  data.whatsapp = {
    phoneNumberId: input.phoneNumberId.trim(),
    wabaId: input.wabaId?.trim() || existing?.wabaId,
    accessToken,
    webhookVerifyTokenHash: verifyTokenInput
      ? hashVerifyToken(verifyTokenInput)
      : existing?.webhookVerifyTokenHash,
    connectedAt: existing?.connectedAt ?? now,
    lastError: undefined,
  };

  await saveChannels(workspaceId, data);
  return toPublicChannels(data);
}

export async function saveInstagramChannel(
  workspaceId: string,
  input: {
    businessAccountId: string;
    accessToken?: string;
    webhookVerifyToken?: string;
  },
): Promise<PublicChannelsStatus> {
  const data = await loadChannels(workspaceId);
  const now = new Date().toISOString();
  const existing = data.instagram;

  const accessToken = input.accessToken?.trim() || resolveAccessToken(existing) || "";
  const verifyTokenInput =
    input.webhookVerifyToken?.trim() || existing?.webhookVerifyToken?.trim() || "";
  const hasVerifyToken = Boolean(verifyTokenInput || existing?.webhookVerifyTokenHash);

  if (!input.businessAccountId.trim() || !accessToken || !hasVerifyToken) {
    throw new Error("ALL_INSTAGRAM_FIELDS_REQUIRED");
  }

  data.instagram = {
    businessAccountId: input.businessAccountId.trim(),
    accessToken,
    webhookVerifyTokenHash: verifyTokenInput
      ? hashVerifyToken(verifyTokenInput)
      : existing?.webhookVerifyTokenHash,
    connectedAt: existing?.connectedAt ?? now,
    lastError: undefined,
  };

  await saveChannels(workspaceId, data);
  return toPublicChannels(data);
}

export async function recordInstagramChannelError(
  workspaceId: string,
  error: InstagramSenderError,
): Promise<void> {
  const data = await loadChannels(workspaceId);
  if (!data.instagram) return;

  data.instagram.lastError = {
    status: error.status,
    message: error.isTokenExpired
      ? "Instagram access token expired or invalid. Reconnect in Integrations."
      : error.message.slice(0, 500),
    at: new Date().toISOString(),
  };

  await saveChannels(workspaceId, data);
}

export async function recordWhatsAppChannelError(
  workspaceId: string,
  error: WhatsAppApiError | WhatsAppSenderError,
): Promise<void> {
  const data = await loadChannels(workspaceId);
  if (!data.whatsapp) return;

  const isTokenExpired =
    error instanceof WhatsAppApiError
      ? error.isTokenExpired
      : error instanceof WhatsAppSenderError && error.isTokenExpired;

  data.whatsapp.lastError = {
    status: error.status,
    message: isTokenExpired
      ? "WhatsApp access token expired or invalid. Reconnect in Integrations."
      : error.message.slice(0, 500),
    at: new Date().toISOString(),
  };

  await saveChannels(workspaceId, data);
}

export async function sendWhatsAppTestMessage(
  workspaceId: string,
  input: { to: string; message?: string },
): Promise<WhatsAppSendResult> {
  const data = await loadChannels(workspaceId);
  if (!isWhatsAppConnected(data.whatsapp)) {
    throw new Error("WHATSAPP_NOT_CONNECTED");
  }

  const whatsapp = data.whatsapp!;
  const accessToken = resolveAccessToken(whatsapp);

  try {
    const result = await sendTextMessage(
      input.to.replace(/\D/g, ""),
      input.message?.trim() || "Test message from AI Business OS — your WhatsApp integration is working.",
      whatsapp.phoneNumberId,
      accessToken,
    );

    if (data.whatsapp?.lastError) {
      data.whatsapp.lastError = undefined;
      await saveChannels(workspaceId, data);
    }

    return result;
  } catch (error) {
    if (error instanceof WhatsAppApiError || error instanceof WhatsAppSenderError) {
      await recordWhatsAppChannelError(workspaceId, error);
    }
    throw error;
  }
}

export async function sendWhatsAppTemplate(
  workspaceId: string,
  input: {
    to: string;
    templateName: string;
    languageCode?: string;
    components?: WhatsAppTemplateComponent[];
  },
): Promise<WhatsAppSendResult> {
  const data = await loadChannels(workspaceId);
  if (!isWhatsAppConnected(data.whatsapp)) {
    throw new Error("WHATSAPP_NOT_CONNECTED");
  }

  const whatsapp = data.whatsapp!;
  try {
    return await sendTemplateMessage(
      input.to.replace(/\D/g, ""),
      input.templateName,
      input.languageCode ?? "en",
      whatsapp.phoneNumberId,
      resolveAccessToken(whatsapp),
    );
  } catch (error) {
    if (error instanceof WhatsAppApiError || error instanceof WhatsAppSenderError) {
      await recordWhatsAppChannelError(workspaceId, error);
    }
    throw error;
  }
}

export async function listWhatsAppWebhookLogs(workspaceId: string, limit = 50) {
  return db.listWhatsAppWebhookLogs(workspaceId, limit);
}

export type WhatsAppSession = {
  conversationId?: string;
  state: ConversationState;
  history: ChatMessage[];
};

export async function findWorkspaceByWhatsAppPhoneNumberId(phoneNumberId: string): Promise<{
  workspaceId: string;
  whatsapp: WhatsAppChannelConfig & { accessToken: string };
} | null> {
  const match = await db.findChannelConfigByWhatsAppPhoneNumberId(phoneNumberId);
  if (!match) return null;
  const whatsapp = normalizeWhatsAppConfig(match.whatsapp);
  if (!whatsapp || !isWhatsAppConnected(whatsapp)) return null;

  const accessToken = resolveAccessToken(whatsapp);
  return {
    workspaceId: match.workspaceId,
    whatsapp: { ...whatsapp, accessToken },
  };
}

export async function matchesAnyWhatsAppWebhookVerifyToken(
  verifyToken: string,
): Promise<boolean> {
  return db.matchesAnyWhatsAppWebhookVerifyToken(verifyToken);
}

export async function matchesAnyInstagramWebhookVerifyToken(
  verifyToken: string,
): Promise<boolean> {
  return db.matchesAnyInstagramWebhookVerifyToken(verifyToken);
}

export async function getWhatsAppSession(
  workspaceId: string,
  senderPhone: string,
): Promise<WhatsAppSession> {
  const data = await db.getChannelSession(workspaceId, "whatsapp", senderPhone);
  if (data) return data as WhatsAppSession;
  return {
    state: { active_agent: "reception", last_intent: "greeting" },
    history: [],
  };
}

export async function saveWhatsAppSession(
  workspaceId: string,
  senderPhone: string,
  session: WhatsAppSession,
): Promise<void> {
  await db.saveChannelSession(workspaceId, "whatsapp", senderPhone, session as Record<string, unknown>);
}

export async function saveWhatsAppConversationBlob(
  workspaceId: string,
  conversationId: string,
  conversation: RuntimeConversation,
): Promise<void> {
  await db.saveConversation(conversation);
}

export async function findWorkspaceByInstagramBusinessAccountId(
  businessAccountId: string,
): Promise<{
  workspaceId: string;
  instagram: InstagramChannelConfig & { accessToken: string };
} | null> {
  const match = await db.findChannelConfigByInstagramBusinessAccountId(businessAccountId);
  if (!match) return null;
  const instagram = normalizeInstagramConfig(match.instagram);
  if (!instagram || !isInstagramConnected(instagram)) return null;

  return {
    workspaceId: match.workspaceId,
    instagram: { ...instagram, accessToken: resolveAccessToken(instagram) },
  };
}

export async function getInstagramSession(
  workspaceId: string,
  senderId: string,
): Promise<WhatsAppSession> {
  const data = await db.getChannelSession(workspaceId, "instagram", senderId);
  if (data) return data as WhatsAppSession;
  return {
    state: { active_agent: "reception", last_intent: "greeting" },
    history: [],
  };
}

export async function saveInstagramSession(
  workspaceId: string,
  senderId: string,
  session: WhatsAppSession,
): Promise<void> {
  await db.saveChannelSession(workspaceId, "instagram", senderId, session as Record<string, unknown>);
}

export async function saveInstagramConversationBlob(
  workspaceId: string,
  _conversationId: string,
  conversation: RuntimeConversation,
): Promise<void> {
  await db.saveConversation(conversation);
}

export { claimWhatsAppMessageId, logWhatsAppWebhookEvent } from "./db.ts";
