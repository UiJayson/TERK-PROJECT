import { getStoredToken } from "../auth/api";

export interface DashboardNotification {
  id: string;
  workspaceId: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  adminEmail: string | null;
  adminWhatsApp: string | null;
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

export async function fetchNotifications(): Promise<{
  notifications: DashboardNotification[];
  unreadCount: number;
}> {
  const data = await request("/api/notifications");
  return {
    notifications: (data.notifications as DashboardNotification[]) ?? [],
    unreadCount: Number(data.unreadCount ?? 0),
  };
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const data = await request("/api/notifications/unread-count");
  return Number(data.unreadCount ?? 0);
}

export async function markNotificationRead(id: string): Promise<number> {
  const data = await request(`/api/notifications/${id}/read`, { method: "PATCH" });
  return Number(data.unreadCount ?? 0);
}

export async function markAllNotificationsRead(): Promise<number> {
  const data = await request("/api/notifications/read-all", { method: "POST" });
  return Number(data.unreadCount ?? 0);
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const data = await request("/api/settings");
  return (data.notificationPreferences as NotificationPreferences) ?? {
    emailEnabled: true,
    whatsappEnabled: true,
    adminEmail: null,
    adminWhatsApp: null,
  };
}

export async function saveNotificationPreferences(
  notificationPreferences: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const data = await request("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ notificationPreferences }),
  });
  return (data.notificationPreferences as NotificationPreferences) ?? {
    emailEnabled: true,
    whatsappEnabled: true,
    adminEmail: null,
    adminWhatsApp: null,
  };
}
