import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess, withRole } from "./_shared/auth-http.ts";
import {
  getChannelsStatus,
  listWhatsAppWebhookLogs,
  saveInstagramChannel,
  saveWhatsAppChannel,
  sendWhatsAppTestMessage,
} from "./_shared/channels-store.ts";
import { WhatsAppApiError } from "./_shared/whatsapp.ts";
import { WhatsAppSenderError } from "./_shared/whatsapp-sender.ts";

async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const workspaceId = auth.workspace.id;
  const channel = context.params?.channel;
  const action = context.params?.action;

  try {
    if (req.method === "GET" && !channel) {
      const channels = await getChannelsStatus(workspaceId);
      return jsonResponse({ channels });
    }

    if (req.method === "GET" && channel === "whatsapp" && action === "logs") {
      const logs = await listWhatsAppWebhookLogs(workspaceId, 50);
      return jsonResponse({ logs });
    }

    if (req.method === "POST" && channel === "whatsapp" && action === "test") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as { to?: string; message?: string };
      if (!body.to?.trim()) {
        return jsonResponse({ error: "Recipient phone number is required." }, { status: 400 });
      }

      const result = await sendWhatsAppTestMessage(workspaceId, {
        to: body.to,
        message: body.message,
      });

      const channels = await getChannelsStatus(workspaceId);
      return jsonResponse({ ok: true, result, channels });
    }

    if (req.method === "PATCH" && channel === "whatsapp") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as {
        phoneNumberId?: string;
        wabaId?: string;
        accessToken?: string;
        webhookVerifyToken?: string;
      };

      if (!body.phoneNumberId?.trim()) {
        return jsonResponse({ error: "Phone Number ID is required." }, { status: 400 });
      }

      const channels = await saveWhatsAppChannel(workspaceId, {
        phoneNumberId: body.phoneNumberId,
        wabaId: body.wabaId,
        accessToken: body.accessToken,
        webhookVerifyToken: body.webhookVerifyToken,
      });

      return jsonResponse({ channels });
    }

    if (req.method === "PATCH" && channel === "instagram") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as {
        businessAccountId?: string;
        accessToken?: string;
        webhookVerifyToken?: string;
      };

      if (!body.businessAccountId?.trim()) {
        return jsonResponse(
          { error: "Instagram Business Account ID is required." },
          { status: 400 },
        );
      }

      const channels = await saveInstagramChannel(workspaceId, {
        businessAccountId: body.businessAccountId,
        accessToken: body.accessToken,
        webhookVerifyToken: body.webhookVerifyToken,
      });

      return jsonResponse({ channels });
    }

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("channels.ts request failed:", error);
    const message = publicErrorMessage(error, "Request failed");
    if (message === "ALL_WHATSAPP_FIELDS_REQUIRED") {
      return jsonResponse(
        { error: "Phone Number ID, Access Token, and Webhook Verify Token are required." },
        { status: 400 },
      );
    }
    if (message === "ALL_INSTAGRAM_FIELDS_REQUIRED") {
      return jsonResponse(
        {
          error:
            "Instagram Business Account ID, Access Token, and Webhook Verify Token are required.",
        },
        { status: 400 },
      );
    }
    if (message === "WHATSAPP_NOT_CONNECTED") {
      return jsonResponse({ error: "Connect WhatsApp before sending a test message." }, { status: 400 });
    }
    if (error instanceof WhatsAppApiError || error instanceof WhatsAppSenderError) {
      const channels = await getChannelsStatus(workspaceId);
      return jsonResponse(
        {
          error: error.isTokenExpired
            ? "WhatsApp access token expired or invalid. Update your token in Integrations."
            : error.message,
          channels,
        },
        { status: error.status >= 400 && error.status < 500 ? error.status : 502 },
      );
    }
    return jsonResponse({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: [
    "/api/channels",
    "/api/channels/:channel",
    "/api/channels/:channel/:action",
  ],
};

export default withObservability(handler);
