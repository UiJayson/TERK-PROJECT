import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import { createSessionToken, createId } from "./_shared/auth-crypto.ts";
import {
  authSuccessResponse,
  jsonResponse,
  optionsResponse,
  requireAuthWithWorkspaceAccess,
  toPublicUser,
  toPublicWorkspace,
  withRole,
} from "./_shared/auth-http.ts";
import {
  updateUserProfile,
  updateWorkspaceProfile,
  findUserById,
  findWorkspaceById,
} from "./_shared/auth-store.ts";
import * as db from "./_shared/db.ts";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  parseNotificationPreferences,
  type NotificationPreferences,
} from "./_shared/notification-preferences.ts";

function mergeNotificationPreferences(
  current: NotificationPreferences,
  patch: Partial<NotificationPreferences> | undefined,
): NotificationPreferences {
  if (!patch) return current;
  return {
    emailEnabled:
      typeof patch.emailEnabled === "boolean" ? patch.emailEnabled : current.emailEnabled,
    whatsappEnabled:
      typeof patch.whatsappEnabled === "boolean"
        ? patch.whatsappEnabled
        : current.whatsappEnabled,
    adminEmail:
      patch.adminEmail === null
        ? null
        : typeof patch.adminEmail === "string"
          ? patch.adminEmail.trim() || null
          : current.adminEmail,
    adminWhatsApp:
      patch.adminWhatsApp === null
        ? null
        : typeof patch.adminWhatsApp === "string"
          ? patch.adminWhatsApp.trim() || null
          : current.adminWhatsApp,
  };
}

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  try {
    if (req.method === "GET") {
      const profile = await db.getBusinessProfile(auth.workspace.id);
      const notificationPreferences = parseNotificationPreferences(profile);

      return jsonResponse({
        user: auth.user,
        workspace: auth.workspace,
        notificationPreferences,
        role: auth.role,
      });
    }

    if (req.method === "PATCH") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as {
        name?: string;
        workspaceName?: string;
        notificationPreferences?: Partial<NotificationPreferences>;
      };

      const user = await updateUserProfile(auth.user.id, { name: body.name });
      const workspace = await updateWorkspaceProfile(auth.workspace.id, {
        name: body.workspaceName,
      });

      let notificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };

      if (body.notificationPreferences) {
        const profile = (await db.getBusinessProfile(auth.workspace.id)) ?? {};
        const current = parseNotificationPreferences(profile);
        notificationPreferences = mergeNotificationPreferences(
          current,
          body.notificationPreferences,
        );

        await db.saveBusinessProfile(auth.workspace.id, {
          ...profile,
          notificationPreferences,
        });
      } else {
        const profile = await db.getBusinessProfile(auth.workspace.id);
        notificationPreferences = parseNotificationPreferences(profile);
      }

      const dbUser = await findUserById(user.id);
      const sessionVersion = dbUser?.sessionVersion ?? 0;

      const token = await createSessionToken({
        sub: user.id,
        email: user.email,
        name: user.name,
        workspaceId: workspace.id,
        role: auth.role,
        sessionVersion,
      });

      return authSuccessResponse(
        {
          user: toPublicUser(user),
          workspace: toPublicWorkspace(workspace),
          notificationPreferences,
          role: auth.role,
        },
        token,
      );
    }

    if (req.method === "POST") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;

      const body = (await req.json()) as { action?: string };
      if (body.action === "rotate_public_key") {
        // Revoke the embed key: the old key stops working immediately and
        // every widget install must be updated with the new one.
        const newKey = createId("pk");
        await db.rotateWorkspacePublicKey(auth.workspace.id, newKey);
        const workspace = await findWorkspaceById(auth.workspace.id);
        if (!workspace) {
          return jsonResponse({ error: "Workspace not found." }, { status: 404 });
        }
        return jsonResponse({
          ok: true,
          workspace: toPublicWorkspace(workspace),
        });
      }

      return jsonResponse({ error: "Unknown action." }, { status: 400 });
    }

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("settings.ts request failed:", error);
    const message = publicErrorMessage(error, "Request failed");
    return jsonResponse({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/settings",
};

export default withObservability(handler);
