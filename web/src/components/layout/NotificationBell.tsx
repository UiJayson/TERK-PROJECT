import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type DashboardNotification,
} from "../../api/notifications";
import { NavIcon } from "../ui/NavIcon";

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function linkForNotification(notification: DashboardNotification): string {
  if (notification.link) {
    try {
      const url = new URL(notification.link, window.location.origin);
      return `${url.pathname}${url.search}`;
    } catch {
      return notification.link;
    }
  }
  const conversationId = notification.metadata?.conversationId;
  if (typeof conversationId === "string" && conversationId) {
    return `/app/conversations?conversation=${encodeURIComponent(conversationId)}`;
  }
  if (notification.type === "lead_qualified") return "/app/leads";
  return "/app/conversations";
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  async function loadNotifications() {
    setLoading(true);
    try {
      const data = await fetchNotifications();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // Bell stays usable even if API is unavailable (e.g. migration not applied yet).
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadNotifications();
    const interval = window.setInterval(() => void loadNotifications(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) await loadNotifications();
  }

  async function handleMarkRead(notification: DashboardNotification) {
    if (notification.isRead) return;
    try {
      const count = await markNotificationRead(notification.id);
      setUnreadCount(count);
      setNotifications((items) =>
        items.map((item) =>
          item.id === notification.id ? { ...item, isRead: true } : item,
        ),
      );
    } catch {
      // ignore
    }
  }

  async function handleMarkAllRead() {
    try {
      const count = await markAllNotificationsRead();
      setUnreadCount(count);
      setNotifications((items) => items.map((item) => ({ ...item, isRead: true })));
    } catch {
      // ignore
    }
  }

  return (
    <div className="notification-bell" ref={panelRef}>
      <button
        type="button"
        className="topnav__icon-btn notification-bell__trigger"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        onClick={() => void handleToggle()}
      >
        <NavIcon name="bell" />
        {unreadCount > 0 ? (
          <span className="notification-bell__badge" aria-hidden="true">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notification-bell__panel" role="region" aria-label="Notifications">
          <div className="notification-bell__header">
            <h3>Notifications</h3>
            {unreadCount > 0 ? (
              <button type="button" className="notification-bell__mark-all" onClick={() => void handleMarkAllRead()}>
                Mark all read
              </button>
            ) : null}
          </div>

          {loading && notifications.length === 0 ? (
            <p className="notification-bell__empty">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="notification-bell__empty">No notifications yet.</p>
          ) : (
            <ul className="notification-bell__list">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={`notification-bell__item${notification.isRead ? "" : " notification-bell__item--unread"}`}
                >
                  <Link
                    to={linkForNotification(notification)}
                    className="notification-bell__link"
                    onClick={() => {
                      void handleMarkRead(notification);
                      setOpen(false);
                    }}
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <time dateTime={notification.createdAt}>
                      {formatRelativeTime(notification.createdAt)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
