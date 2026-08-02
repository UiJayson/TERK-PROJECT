import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { usePermissions } from "../../auth/usePermissions";
import { getStoredToken, setStoredToken } from "../../auth/api";
import type { AuthSession } from "../../auth/types";
import {
  fetchNotificationPreferences,
  type NotificationPreferences,
} from "../../api/notifications";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { PageHeader } from "../../components/ui/PageHeader";

export function SettingsPage() {
  const { user, workspace, refresh } = useAuth();
  const { canManageSettings, isStaff } = usePermissions();
  const [name, setName] = useState(user?.name ?? "");
  const [workspaceName, setWorkspaceName] = useState(workspace?.name ?? "");
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>({
    emailEnabled: true,
    whatsappEnabled: true,
    adminEmail: null,
    adminWhatsApp: null,
  });

  useEffect(() => {
    setName(user?.name ?? "");
    setWorkspaceName(workspace?.name ?? "");
  }, [user?.name, workspace?.name]);

  useEffect(() => {
    void fetchNotificationPreferences()
      .then(setNotificationPrefs)
      .catch(() => {
        // Preferences load is optional until migration 007 is applied.
      });
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const token = getStoredToken();
      const response = await fetch("/api/settings", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name,
          workspaceName,
          notificationPreferences: notificationPrefs,
        }),
      });
      const data = (await response.json()) as AuthSession & {
        token?: string;
        error?: string;
        notificationPreferences?: NotificationPreferences;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not save settings");
      if (data.token) setStoredToken(data.token);
      if (data.notificationPreferences) {
        setNotificationPrefs(data.notificationPreferences);
      }
      await refresh();
      setSuccess("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Settings"
        description="Manage your profile, workspace details, and notification preferences."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {success ? <p className="auth-form__success">{success}</p> : null}

      <form className="settings-form card" onSubmit={(event) => void handleSubmit(event)}>
        {isStaff ? (
          <p className="settings-form__hint">Staff accounts have read-only access to settings.</p>
        ) : null}
        <section>
          <h2>Profile</h2>
          <label className="kb-field">
            Your name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              disabled={!canManageSettings}
              readOnly={!canManageSettings}
            />
          </label>
          <label className="kb-field">
            Email
            <input value={user?.email ?? ""} disabled readOnly />
          </label>
        </section>

        <section>
          <h2>Workspace</h2>
          <label className="kb-field">
            Company / workspace name
            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              required
              disabled={!canManageSettings}
              readOnly={!canManageSettings}
            />
          </label>
          <label className="kb-field">
            Workspace ID
            <input value={workspace?.id ?? ""} disabled readOnly />
          </label>
        </section>

        <section>
          <h2>Notification preferences</h2>
          <p className="settings-form__hint">
            Get alerted when AI escalates a conversation, qualifies a lead, or books an appointment.
          </p>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={notificationPrefs.emailEnabled}
              disabled={!canManageSettings}
              onChange={(event) =>
                setNotificationPrefs((prefs) => ({
                  ...prefs,
                  emailEnabled: event.target.checked,
                }))
              }
            />
            <span>Email alerts (Resend)</span>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={notificationPrefs.whatsappEnabled}
              disabled={!canManageSettings}
              onChange={(event) =>
                setNotificationPrefs((prefs) => ({
                  ...prefs,
                  whatsappEnabled: event.target.checked,
                }))
              }
            />
            <span>WhatsApp admin alerts</span>
          </label>

          <label className="kb-field">
            Admin notification email
            <input
              type="email"
              placeholder={user?.email ?? "owner@company.com"}
              value={notificationPrefs.adminEmail ?? ""}
              disabled={!canManageSettings}
              readOnly={!canManageSettings}
              onChange={(event) =>
                setNotificationPrefs((prefs) => ({
                  ...prefs,
                  adminEmail: event.target.value.trim() || null,
                }))
              }
            />
          </label>

          <label className="kb-field">
            Admin WhatsApp number
            <input
              type="tel"
              placeholder="447700900123"
              value={notificationPrefs.adminWhatsApp ?? ""}
              disabled={!canManageSettings}
              readOnly={!canManageSettings}
              onChange={(event) =>
                setNotificationPrefs((prefs) => ({
                  ...prefs,
                  adminWhatsApp: event.target.value.trim() || null,
                }))
              }
            />
          </label>
        </section>

        {canManageSettings ? (
          <button type="submit" className="agent-btn agent-btn--primary" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        ) : null}
      </form>
    </div>
  );
}
