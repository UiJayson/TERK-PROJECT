import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { usePermissions } from "../../auth/usePermissions";
import {
  connectInstagram,
  connectWhatsApp,
  fetchChannelsStatus,
  fetchWhatsAppWebhookLogs,
  sendWhatsAppTestMessage,
  type PublicChannelsStatus,
  type WhatsAppWebhookLog,
} from "../../api/channels";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";

const emptyStatus: PublicChannelsStatus = {
  whatsapp: {
    connected: false,
    status: "disconnected",
    phoneNumberId: null,
    wabaId: null,
    accessTokenMasked: null,
    webhookVerifyTokenMasked: null,
    connectedAt: null,
    webhookUrl: null,
    lastWebhookAt: null,
    lastError: null,
  },
  instagram: {
    connected: false,
    businessAccountId: null,
    accessTokenMasked: null,
    webhookVerifyTokenMasked: null,
    webhookUrl: null,
    connectedAt: null,
    lastError: null,
  },
};

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function ChannelBadge({ status }: { status: PublicChannelsStatus["whatsapp"]["status"] }) {
  const label =
    status === "connected" ? "Connected" : status === "error" ? "Error" : "Not connected";
  const className =
    status === "connected"
      ? "channel-badge--connected"
      : status === "error"
        ? "channel-badge--error"
        : "channel-badge--disconnected";
  return <span className={`channel-badge ${className}`}>{label}</span>;
}

export function IntegrationsPage() {
  const { workspace } = useAuth();
  const { canManageChannels, isStaff } = usePermissions();
  const [copied, setCopied] = useState<"link" | "snippet" | "webhook" | null>(null);
  const [channels, setChannels] = useState<PublicChannelsStatus>(emptyStatus);
  const [logs, setLogs] = useState<WhatsAppWebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  const [instagramBusy, setInstagramBusy] = useState(false);

  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("");

  const [businessAccountId, setBusinessAccountId] = useState("");
  const [instagramAccessToken, setInstagramAccessToken] = useState("");
  const [instagramWebhookVerifyToken, setInstagramWebhookVerifyToken] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedUrl = useMemo(() => {
    if (!workspace?.publicKey) return "";
    return `${origin}/embed/${workspace.publicKey}`;
  }, [origin, workspace?.publicKey]);

  const webhookUrl =
    channels.whatsapp.webhookUrl ?? `${origin}/api/whatsapp/webhook`;

  const instagramWebhookUrl =
    channels.instagram.webhookUrl ?? `${origin}/api/instagram/webhook`;

  const snippet = useMemo(() => {
    if (!embedUrl) return "";
    return `<!-- AI Business OS website chat -->
<iframe
  src="${embedUrl}"
  title="AI chat"
  style="position:fixed;right:0;bottom:0;width:420px;height:640px;border:0;z-index:9999;"
  sandbox="allow-scripts allow-same-origin allow-forms"
  referrerpolicy="strict-origin"
  allow="clipboard-write"
></iframe>`;
  }, [embedUrl]);

  const loadChannels = useCallback(async () => {
    setError("");
    try {
      const next = await fetchChannelsStatus();
      setChannels(next);
      setPhoneNumberId(next.whatsapp.phoneNumberId ?? "");
      setWabaId(next.whatsapp.wabaId ?? "");
      setBusinessAccountId(next.instagram.businessAccountId ?? "");
      setAccessToken("");
      setWebhookVerifyToken("");
      setInstagramAccessToken("");
      setInstagramWebhookVerifyToken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const next = await fetchWhatsAppWebhookLogs();
      setLogs(next);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChannels();
    void loadLogs();
  }, [loadChannels, loadLogs]);

  async function copy(value: string, kind: "link" | "snippet" | "webhook") {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  }

  async function handleWhatsAppSubmit(event: FormEvent) {
    event.preventDefault();
    setWhatsappBusy(true);
    setError("");
    setSuccess("");

    try {
      const next = await connectWhatsApp({
        phoneNumberId,
        wabaId: wabaId || undefined,
        accessToken,
        webhookVerifyToken,
      });
      setChannels(next);
      setAccessToken("");
      setWebhookVerifyToken("");
      setSuccess("WhatsApp connected. Point Meta webhook to the URL below.");
      void loadLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect WhatsApp");
    } finally {
      setWhatsappBusy(false);
    }
  }

  async function handleInstagramSubmit(event: FormEvent) {
    event.preventDefault();
    setInstagramBusy(true);
    setError("");
    setSuccess("");

    try {
      const next = await connectInstagram({
        businessAccountId,
        accessToken: instagramAccessToken,
        webhookVerifyToken: instagramWebhookVerifyToken,
      });
      setChannels(next);
      setInstagramAccessToken("");
      setInstagramWebhookVerifyToken("");
      setSuccess("Instagram connected. Point Meta webhook to the URL below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect Instagram");
    } finally {
      setInstagramBusy(false);
    }
  }

  async function handleTestSend(event: FormEvent) {
    event.preventDefault();
    setTestBusy(true);
    setError("");
    setSuccess("");

    try {
      const next = await sendWhatsAppTestMessage({
        to: testPhone,
        message: testMessage || undefined,
      });
      setChannels(next);
      setSuccess("Test message sent.");
      void loadLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test send failed");
    } finally {
      setTestBusy(false);
    }
  }

  if (!workspace?.publicKey) {
    return (
      <div className="page-stack">
        <PageHeader title="Integrations" description="Connect customer channels." />
        <EmptyState
          title="Workspace key unavailable"
          description="Refresh the page or sign in again to load your public chat key."
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Integrations"
        description="Connect website chat and WhatsApp Business. Agents use memory and semantic Knowledge Base on every channel."
      />

      {error ? <ErrorBanner message={error} onRetry={() => void loadChannels()} /> : null}
      {success ? <p className="auth-form__success">{success}</p> : null}
      {isStaff ? (
        <p className="settings-form__hint">
          Staff access is view-only. An owner or admin must connect or change integrations.
        </p>
      ) : null}

      {loading ? (
        <LoadingState label="Loading integrations…" />
      ) : (
        <section className="integrations-grid">
          <Card title="Website chat">
            <p className="integrations-copy">
              Embed this on your site. Messages use your workspace routing, active agents, and
              Knowledge Base.
            </p>

            <label className="kb-field">
              Public key
              <input value={workspace.publicKey} readOnly />
            </label>

            <label className="kb-field">
              Embed link
              <input value={embedUrl} readOnly />
            </label>

            <div className="kb-header-actions">
              <button
                type="button"
                className="agent-btn agent-btn--ghost"
                onClick={() => void copy(embedUrl, "link")}
              >
                {copied === "link" ? "Copied link" : "Copy link"}
              </button>
              <a className="agent-btn agent-btn--primary" href={embedUrl} target="_blank" rel="noreferrer">
                Open preview
              </a>
            </div>

            <label className="kb-field" style={{ marginTop: "1rem" }}>
              Embed snippet
              <textarea rows={8} value={snippet} readOnly />
            </label>
            <button
              type="button"
              className="agent-btn agent-btn--ghost"
              onClick={() => void copy(snippet, "snippet")}
            >
              {copied === "snippet" ? "Copied snippet" : "Copy snippet"}
            </button>
          </Card>

          <Card title="WhatsApp Business">
            <div className="channel-card__header">
              <p className="integrations-copy">
                Connect Meta WhatsApp Cloud API. Credentials are encrypted at rest. See{" "}
                <code>docs/whatsapp-setup.md</code> in the repository for Meta setup steps.
              </p>
              <ChannelBadge status={channels.whatsapp.status} />
            </div>

            {channels.whatsapp.lastWebhookAt ? (
              <p className="integrations-copy">
                Last webhook: {formatDate(channels.whatsapp.lastWebhookAt)}
              </p>
            ) : null}

            {channels.whatsapp.lastError ? (
              <ErrorBanner
                message={`${channels.whatsapp.lastError.message} (${formatDate(channels.whatsapp.lastError.at)})`}
                onRetry={() => void loadChannels()}
              />
            ) : null}

            <label className="kb-field">
              Meta webhook URL
              <input value={webhookUrl} readOnly />
            </label>
            <button
              type="button"
              className="agent-btn agent-btn--ghost"
              onClick={() => void copy(webhookUrl, "webhook")}
            >
              {copied === "webhook" ? "Copied webhook URL" : "Copy webhook URL"}
            </button>

            {canManageChannels ? (
            <form className="channel-form" onSubmit={(event) => void handleWhatsAppSubmit(event)}>
              <label className="kb-field">
                Phone Number ID
                <input
                  value={phoneNumberId}
                  onChange={(event) => setPhoneNumberId(event.target.value)}
                  placeholder="From Meta Business Suite"
                  required
                />
              </label>

              <label className="kb-field">
                WhatsApp Business Account ID (optional)
                <input
                  value={wabaId}
                  onChange={(event) => setWabaId(event.target.value)}
                  placeholder="WABA ID"
                />
              </label>

              <label className="kb-field">
                Access Token
                <input
                  type="password"
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                  placeholder={
                    channels.whatsapp.accessTokenMasked
                      ? channels.whatsapp.accessTokenMasked
                      : "Permanent access token"
                  }
                  required={!channels.whatsapp.connected}
                  autoComplete="off"
                />
              </label>

              <label className="kb-field">
                Webhook Verify Token
                <input
                  type="password"
                  value={webhookVerifyToken}
                  onChange={(event) => setWebhookVerifyToken(event.target.value)}
                  placeholder={
                    channels.whatsapp.webhookVerifyTokenMasked
                      ? channels.whatsapp.webhookVerifyTokenMasked
                      : "Same string configured in Meta"
                  }
                  required={!channels.whatsapp.connected}
                  autoComplete="off"
                />
              </label>

              <button
                type="submit"
                className="agent-btn agent-btn--primary"
                disabled={whatsappBusy}
              >
                {whatsappBusy ? "Connecting…" : "Connect WhatsApp"}
              </button>
            </form>
            ) : null}

            {channels.whatsapp.connected && canManageChannels ? (
              <form className="channel-form" onSubmit={(event) => void handleTestSend(event)}>
                <h3 className="integrations-subtitle">Send test message</h3>
                <label className="kb-field">
                  Recipient phone (country code, no +)
                  <input
                    value={testPhone}
                    onChange={(event) => setTestPhone(event.target.value)}
                    placeholder="447700900123"
                    required
                  />
                </label>
                <label className="kb-field">
                  Message (optional)
                  <input
                    value={testMessage}
                    onChange={(event) => setTestMessage(event.target.value)}
                    placeholder="Test from AI Business OS"
                  />
                </label>
                <button type="submit" className="agent-btn agent-btn--ghost" disabled={testBusy}>
                  {testBusy ? "Sending…" : "Send test message"}
                </button>
              </form>
            ) : null}
          </Card>

          <Card title="Instagram Business">
            <div className="channel-card__header">
              <p className="integrations-copy">
                Connect Meta Instagram Messaging. Uses the same Meta Business access token as
                WhatsApp. Configure the Instagram webhook in Meta Developer Console.
              </p>
              <ChannelBadge
                status={
                  channels.instagram.lastError
                    ? "error"
                    : channels.instagram.connected
                      ? "connected"
                      : "disconnected"
                }
              />
            </div>

            {channels.instagram.lastError ? (
              <ErrorBanner
                message={`${channels.instagram.lastError.message} (${formatDate(channels.instagram.lastError.at)})`}
                onRetry={() => void loadChannels()}
              />
            ) : null}

            <label className="kb-field">
              Meta Instagram webhook URL
              <input value={instagramWebhookUrl} readOnly />
            </label>
            <button
              type="button"
              className="agent-btn agent-btn--ghost"
              onClick={() => void copy(instagramWebhookUrl, "webhook")}
            >
              {copied === "webhook" ? "Copied webhook URL" : "Copy Instagram webhook URL"}
            </button>

            {canManageChannels ? (
              <form
                className="channel-form"
                onSubmit={(event) => void handleInstagramSubmit(event)}
              >
                <label className="kb-field">
                  Instagram Business Account ID
                  <input
                    value={businessAccountId}
                    onChange={(event) => setBusinessAccountId(event.target.value)}
                    placeholder="From Meta Business Suite"
                    required
                  />
                </label>

                <label className="kb-field">
                  Access Token
                  <input
                    type="password"
                    value={instagramAccessToken}
                    onChange={(event) => setInstagramAccessToken(event.target.value)}
                    placeholder={
                      channels.instagram.accessTokenMasked
                        ? channels.instagram.accessTokenMasked
                        : "Meta Business access token"
                    }
                    required={!channels.instagram.connected}
                    autoComplete="off"
                  />
                </label>

                <label className="kb-field">
                  Webhook Verify Token
                  <input
                    type="password"
                    value={instagramWebhookVerifyToken}
                    onChange={(event) => setInstagramWebhookVerifyToken(event.target.value)}
                    placeholder={
                      channels.instagram.webhookVerifyTokenMasked
                        ? channels.instagram.webhookVerifyTokenMasked
                        : "Separate verify string for Instagram"
                    }
                    required={!channels.instagram.connected}
                    autoComplete="off"
                  />
                </label>

                <button
                  type="submit"
                  className="agent-btn agent-btn--primary"
                  disabled={instagramBusy}
                >
                  {instagramBusy ? "Connecting…" : "Connect Instagram"}
                </button>
              </form>
            ) : null}
          </Card>

          <Card title="WhatsApp delivery log">
            <p className="integrations-copy">
              Last 5 webhook events and delivery status. Failed events appear here for debugging.
            </p>
            {logsLoading ? (
              <LoadingState label="Loading webhook logs…" />
            ) : logs.length === 0 ? (
              <p className="integrations-copy">No webhook events yet.</p>
            ) : (
              <ul className="whatsapp-log-list">
                {logs.slice(0, 5).map((log) => (
                  <li key={log.id} className={`whatsapp-log whatsapp-log--${log.status}`}>
                    <p className="whatsapp-log__meta">
                      {formatDate(log.createdAt)} · {log.status} · {log.direction} · {log.eventType}
                    </p>
                    {log.errorMessage ? (
                      <p className="whatsapp-log__error">{log.errorMessage}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="agent-btn agent-btn--ghost" onClick={() => void loadLogs()}>
              Refresh logs
            </button>
          </Card>

          <Card title="More channels">
            <ul className="checklist">
              <li>Email inbox connection</li>
              <li>CRM sync</li>
            </ul>
            <p className="integrations-copy">
              Manage agents in <Link to="/app/agents">My Agents</Link> before going live.
            </p>
          </Card>
        </section>
      )}
    </div>
  );
}
