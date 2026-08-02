import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAgents } from "../../api/agents";
import { fetchBillingOverview, type BillingOverview } from "../../api/billing";
import { fetchChannelsStatus, type PublicChannelsStatus } from "../../api/channels";
import type { WorkspaceAgent } from "../../auth/types";
import { Card } from "../../components/ui/Card";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";

type ChannelId = "website" | "whatsapp" | "instagram" | "email";

interface ChannelMeta {
  id: ChannelId;
  label: string;
  description: string;
}

const CHANNEL_META: ChannelMeta[] = [
  { id: "website", label: "Website chat", description: "Embedded chat widget on your site." },
  { id: "whatsapp", label: "WhatsApp", description: "Meta WhatsApp Cloud API." },
  { id: "instagram", label: "Instagram", description: "Meta Instagram Messaging." },
  { id: "email", label: "Email", description: "Inbound email routed to your agents." },
];

function badge(label: string, tone: "connected" | "disconnected") {
  return <span className={`channel-badge channel-badge--${tone}`}>{label}</span>;
}

export function ChannelsPage() {
  const [channels, setChannels] = useState<PublicChannelsStatus | null>(null);
  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [channelsResult, agentsResult, billingResult] = await Promise.all([
        fetchChannelsStatus(),
        fetchAgents(),
        fetchBillingOverview(),
      ]);
      setChannels(channelsResult);
      setAgents(agentsResult);
      setBilling(billingResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const includedChannels = useMemo(
    () => new Set(billing?.planDetails.channels ?? ["website"]),
    [billing],
  );

  const agentsByChannel = useMemo(() => {
    const map = new Map<string, WorkspaceAgent[]>();
    for (const agent of agents) {
      for (const channel of agent.channelsConnected) {
        map.set(channel, [...(map.get(channel) ?? []), agent]);
      }
    }
    return map;
  }, [agents]);

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader title="Channels" description="Where your agents talk to customers." />
        <LoadingState label="Loading channels…" />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Channels"
        description="Connection status and agent coverage across every channel your workspace can use."
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <section className="integrations-grid">
        {CHANNEL_META.map((meta) => {
          const included = includedChannels.has(meta.id);
          const attached = agentsByChannel.get(meta.id) ?? [];

          let status: { label: string; tone: "connected" | "disconnected" };
          if (!included) {
            status = { label: "Requires upgrade", tone: "disconnected" };
          } else if (meta.id === "website") {
            status = { label: "Available", tone: "connected" };
          } else if (meta.id === "email") {
            status = { label: "Coming soon", tone: "disconnected" };
          } else {
            const channelStatus = channels?.[meta.id as "whatsapp" | "instagram"];
            const connected =
              channelStatus && "connected" in channelStatus ? channelStatus.connected : false;
            const hasError =
              channelStatus && "lastError" in channelStatus ? Boolean(channelStatus.lastError) : false;
            status = hasError
              ? { label: "Error", tone: "disconnected" }
              : connected
                ? { label: "Connected", tone: "connected" }
                : { label: "Not connected", tone: "disconnected" };
          }

          return (
            <Card key={meta.id} title={meta.label}>
              <div className="channel-card__header">
                <p className="integrations-copy">{meta.description}</p>
                {badge(status.label, status.tone)}
              </div>

              <p className="integrations-copy">
                {attached.length > 0
                  ? `${attached.length} agent${attached.length === 1 ? "" : "s"} attached: ${attached
                      .map((agent) => agent.name)
                      .join(", ")}`
                  : "No agents attached to this channel yet."}
              </p>

              {!included ? (
                <Link className="agent-btn agent-btn--primary" to="/app/billing">
                  View plans
                </Link>
              ) : meta.id === "email" ? null : (
                <Link className="agent-btn agent-btn--ghost" to="/app/integrations">
                  {meta.id === "website" ? "Configure embed" : "Manage connection"}
                </Link>
              )}
            </Card>
          );
        })}
      </section>
    </div>
  );
}
