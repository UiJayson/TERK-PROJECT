import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import { jsonResponse, optionsResponse, requireAuthWithWorkspaceAccess } from "./_shared/auth-http.ts";
import * as db from "./_shared/db.ts";

async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  const workspaceId = auth.workspace.id;
  const segment = context.params?.segment;
  const notificationId = context.params?.id;
  const action = context.params?.action;

  try {
    if (req.method === "GET" && !segment && !notificationId) {
      const notifications = await db.listDashboardNotifications(workspaceId);
      const unreadCount = await db.countUnreadDashboardNotifications(workspaceId);
      return jsonResponse({ notifications, unreadCount });
    }

    if (req.method === "GET" && segment === "unread-count") {
      const unreadCount = await db.countUnreadDashboardNotifications(workspaceId);
      return jsonResponse({ unreadCount });
    }

    if (req.method === "POST" && segment === "read-all") {
      const updated = await db.markAllDashboardNotificationsRead(workspaceId);
      const unreadCount = await db.countUnreadDashboardNotifications(workspaceId);
      return jsonResponse({ ok: true, updated, unreadCount });
    }

    if (req.method === "PATCH" && notificationId && action === "read") {
      const ok = await db.markDashboardNotificationRead(workspaceId, notificationId);
      if (!ok) {
        return jsonResponse({ error: "Notification not found" }, { status: 404 });
      }
      const unreadCount = await db.countUnreadDashboardNotifications(workspaceId);
      return jsonResponse({ ok: true, unreadCount });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("notifications.ts request failed:", error);
    const message = publicErrorMessage(error, "Request failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: [
    "/api/notifications",
    "/api/notifications/:segment",
    "/api/notifications/:id/:action",
  ],
};

export default withObservability(handler);
