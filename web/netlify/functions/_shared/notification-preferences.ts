export interface NotificationPreferences {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  adminEmail: string | null;
  adminWhatsApp: string | null;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  emailEnabled: true,
  whatsappEnabled: true,
  adminEmail: null,
  adminWhatsApp: null,
};

export function parseNotificationPreferences(
  profile: Record<string, unknown> | null | undefined,
): NotificationPreferences {
  const raw = profile?.notificationPreferences as Partial<NotificationPreferences> | undefined;
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  return {
    emailEnabled: raw.emailEnabled !== false,
    whatsappEnabled: raw.whatsappEnabled !== false,
    adminEmail: typeof raw.adminEmail === "string" ? raw.adminEmail.trim() || null : null,
    adminWhatsApp:
      typeof raw.adminWhatsApp === "string" ? raw.adminWhatsApp.trim() || null : null,
  };
}

export function resolveAdminEmail(
  prefs: NotificationPreferences,
  ownerEmail: string | null,
): string | null {
  return prefs.adminEmail || ownerEmail;
}

export function resolveAdminWhatsApp(
  prefs: NotificationPreferences,
  profile: Record<string, unknown> | null,
): string | null {
  if (prefs.adminWhatsApp) return prefs.adminWhatsApp;

  const fromProfile =
    (profile?.adminPhone as string | undefined) ||
    (profile?.contact as { phone?: string } | undefined)?.phone ||
    (profile?.phone as string | undefined);

  return fromProfile?.trim() || null;
}
