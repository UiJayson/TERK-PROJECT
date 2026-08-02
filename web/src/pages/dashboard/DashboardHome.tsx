import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchAgents, updateAgent } from "../../api/agents";
import { openBillingPortal } from "../../api/billing";
import { fetchChannelsStatus } from "../../api/channels";
import { fetchKnowledgeItems } from "../../api/knowledge";
import {
  fetchAnalyticsSummary,
  fetchConversations,
  type AnalyticsSummary,
  type RuntimeConversation,
} from "../../api/runtime";
import { useAuth } from "../../auth/AuthContext";
import type { WorkspaceAgent } from "../../auth/types";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { BillingAlerts } from "../../components/billing/BillingAlerts";
import { NavIcon } from "../../components/ui/NavIcon";
import { PageHeader } from "../../components/ui/PageHeader";
import { loadUsageStatus, type BillingAlert } from "../../lib/billing/usage";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

const CHANNEL_LABELS: Record<string, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  email: "Email",
  dashboard: "Dashboard",
};

function agentAvatarClass(id: string): string {
  if (id.startsWith("sales")) return "dash-agent__avatar dash-agent__avatar--sales";
  if (id.startsWith("marketing")) return "dash-agent__avatar dash-agent__avatar--marketing";
  return "dash-agent__avatar";
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function DashboardSkeleton() {
  return (
    <div className="page-stack" aria-busy="true" aria-label="Loading dashboard">
      <div className="dash-row dash-row--split">
        <div className="skeleton" style={{ height: 280, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 280, borderRadius: 16 }} />
      </div>
      <div className="dash-row dash-row--thirds">
        <div className="skeleton" style={{ height: 220, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 220, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 220, borderRadius: 16 }} />
      </div>
    </div>
  );
}

export function DashboardHome() {
  const { user, workspace } = useAuth();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [conversations, setConversations] = useState<RuntimeConversation[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [channels, setChannels] = useState({ whatsapp: false, instagram: false });
  const [togglingAgent, setTogglingAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [billingAlertsList, setBillingAlertsList] = useState<BillingAlert[]>([]);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const [summaryData, agentList, conversationList, knowledge, channelStatus, billingStatus] =
        await Promise.all([
          fetchAnalyticsSummary(),
          fetchAgents(),
          fetchConversations(),
          fetchKnowledgeItems(),
          fetchChannelsStatus(),
          loadUsageStatus().catch(() => null),
        ]);

      setSummary(summaryData);
      setAgents(agentList);
      setConversations(conversationList);
      setKnowledgeCount(knowledge.length);
      setChannels({
        whatsapp: channelStatus.whatsapp.connected,
        instagram: channelStatus.instagram.connected,
      });
      setBillingAlertsList(billingStatus?.alerts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleToggleAgent(agent: WorkspaceAgent) {
    setTogglingAgent(agent.id);
    try {
      const updated = await updateAgent(agent.id, { enabled: !agent.enabled });
      setAgents((list) => list.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update agent");
    } finally {
      setTogglingAgent(null);
    }
  }

  const derived = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const todayCount = conversations.filter(
      (c) => new Date(c.createdAt) >= startOfDay,
    ).length;

    // Hourly buckets, last 12 hours, for the sparkline.
    const spark: Array<{ hour: string; count: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const bucketStart = new Date(now.getTime() - i * 3600_000);
      bucketStart.setMinutes(0, 0, 0);
      const bucketEnd = new Date(bucketStart.getTime() + 3600_000);
      spark.push({
        hour: `${bucketStart.getHours()}:00`,
        count: conversations.filter((c) => {
          const t = new Date(c.createdAt);
          return t >= bucketStart && t < bucketEnd;
        }).length,
      });
    }

    const byChannel = new Map<string, number>();
    for (const c of conversations) {
      byChannel.set(c.channel, (byChannel.get(c.channel) ?? 0) + 1);
    }
    const channelBars = [...byChannel.entries()]
      .map(([channel, count]) => ({
        channel: CHANNEL_LABELS[channel] ?? channel,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const resolved = conversations.filter((c) => c.conversationStatus === "resolved").length;
    const escalated = conversations.filter(
      (c) => c.conversationStatus === "escalated",
    ).length;
    const total = conversations.length;
    const escalationRate = total > 0 ? Math.round((escalated / total) * 100) : 0;
    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

    const latest = conversations[0] ?? null;

    return {
      todayCount,
      spark,
      channelBars,
      resolved,
      escalated,
      open: total - resolved - escalated,
      escalationRate,
      resolutionRate,
      latest,
    };
  }, [conversations]);

  const donutData = useMemo(
    () =>
      (summary?.agentActivity ?? [])
        .filter((entry) => entry.conversations > 0)
        .map((entry) => ({ name: entry.agent, value: entry.conversations })),
    [summary],
  );

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const plan = summary?.billing?.plan ?? "free";
  const hasData = conversations.length > 0;

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader
          title={`Welcome back, ${firstName}`}
          description="Agent performance summary"
        />
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={`${workspace?.name ?? "Your workspace"} · agent performance summary`}
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <BillingAlerts
        alerts={billingAlertsList}
        onManagePayment={() => void openBillingPortal().catch(() => undefined)}
      />

      {/* Row 1 — performance overview + quick actions */}
      <div className="dash-row dash-row--split">
        <section className="dash-card" aria-label="Agent performance">
          <div className="dash-card__header">
            <div>
              <h2 className="dash-card__title">Agent performance</h2>
              <p className="dash-card__crumb">Overview · all agents</p>
            </div>
            <Link to="/app/analytics" className="dash-card__link">
              Full analytics
            </Link>
          </div>

          <div className="dash-perf">
            <div className="dash-stats">
              <div>
                <p className="dash-stat__label">Total conversations</p>
                <div className="dash-stat__row">
                  <p className="dash-stat__value">{summary?.totalConversations ?? 0}</p>
                  <span
                    className={`dash-stat__trend ${derived.todayCount === 0 ? "dash-stat__trend--flat" : ""}`}
                  >
                    +{derived.todayCount} today
                  </span>
                </div>
              </div>
              <div>
                <p className="dash-stat__label">Leads captured</p>
                <div className="dash-stat__row">
                  <p className="dash-stat__value">{summary?.leadsCount ?? 0}</p>
                </div>
              </div>
              <div>
                <p className="dash-stat__label">AI response rate</p>
                <div className="dash-stat__row">
                  <p className="dash-stat__value">{Math.round(summary?.aiResponseRate ?? 0)}%</p>
                </div>
              </div>
              <div>
                <p className="dash-stat__label">Avg response time</p>
                <div className="dash-stat__row">
                  <p className="dash-stat__value">
                    {(summary?.averageResponseTimeSeconds ?? 0).toFixed(1)}s
                  </p>
                </div>
              </div>
            </div>

            <div>
              <div className="dash-donut">
                {donutData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={62}
                        outerRadius={88}
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {donutData.map((entry, index) => (
                          <Cell
                            key={entry.name}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          borderRadius: 10,
                          border: "1px solid var(--border-default)",
                          background: "var(--surface)",
                          color: "var(--text-primary)",
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div
                    className="dash-donut__center"
                    style={{ position: "static", height: "100%" }}
                  >
                    <p className="dash-donut__label">No conversations yet</p>
                  </div>
                )}
                {donutData.length > 0 ? (
                  <div className="dash-donut__center">
                    <p className="dash-donut__value">{summary?.totalConversations ?? 0}</p>
                    <p className="dash-donut__label">total</p>
                  </div>
                ) : null}
              </div>
              {donutData.length > 0 ? (
                <ul className="dash-legend">
                  {donutData.map((entry, index) => (
                    <li key={entry.name}>
                      <span
                        className="dash-legend__dot"
                        style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                      />
                      {entry.name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </section>

        <section className="dash-card dash-card--dark" aria-label="Quick actions">
          <div className="dash-card__header">
            <div>
              <h2 className="dash-card__title">Quick actions</h2>
            </div>
          </div>
          <p className="dash-dark-note">Run an action across your workspace.</p>
          <div className="dash-dark-actions">
            <Link to="/app/agents" className="btn-pill">
              Start a test conversation
            </Link>
            <Link to="/app/knowledge" className="btn-pill btn-pill--outline">
              Upload a knowledge doc
            </Link>
            <Link to="/app/channels" className="btn-pill btn-pill--outline">
              Connect a channel
            </Link>
          </div>
          <div className="dash-dark-footer">
            {derived.latest ? (
              <Link to="/app/conversations">
                Latest: “{derived.latest.preview.slice(0, 48)}
                {derived.latest.preview.length > 48 ? "…" : ""}”
              </Link>
            ) : (
              <Link to="/app/knowledge">Set up your Company Brain first</Link>
            )}
          </div>
        </section>
      </div>

      {/* Row 2 — today, agent status, workspace health */}
      <div className="dash-row dash-row--thirds">
        <section className="dash-card" aria-label="Conversations today">
          <div className="dash-metric__icon">
            <NavIcon name="check" />
          </div>
          <p className="dash-metric__value">{derived.todayCount}</p>
          <p className="dash-metric__trend">
            conversations today · <strong>{conversations.length}</strong> all time
          </p>
          <div className="dash-metric__spark">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={derived.spark}>
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Tooltip
                  labelFormatter={(label) => `Hour ${label}`}
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid var(--border-default)",
                    background: "var(--surface)",
                    color: "var(--text-primary)",
                    fontSize: 12,
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="dash-card" aria-label="Agent status">
          <div className="dash-card__header">
            <h2 className="dash-card__title">Agent status</h2>
            <Link to="/app/agents" className="dash-card__link">
              Configure
            </Link>
          </div>
          <div className="dash-agents">
            {agents.map((agent) => (
              <div key={agent.id} className="dash-agent">
                <span className={agentAvatarClass(agent.id)} aria-hidden="true">
                  {initialsOf(agent.name)}
                </span>
                <div className="dash-agent__body">
                  <p className="dash-agent__name">
                    {agent.name}
                    <span
                      className={`status-chip ${agent.enabled ? "status-chip--active" : "status-chip--paused"}`}
                    >
                      {agent.enabled ? "Active" : "Paused"}
                    </span>
                  </p>
                  <p className="dash-agent__note">{agent.role}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={agent.enabled}
                  aria-label={`${agent.enabled ? "Pause" : "Activate"} ${agent.name}`}
                  className="switch"
                  disabled={togglingAgent === agent.id}
                  onClick={() => void handleToggleAgent(agent)}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="dash-card" aria-label="Workspace health">
          <div className="dash-card__header">
            <h2 className="dash-card__title">Workspace health</h2>
          </div>
          <div className="dash-gauge">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                data={[{ value: derived.resolutionRate }]}
                innerRadius="72%"
                outerRadius="100%"
                startAngle={210}
                endAngle={-30}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar
                  dataKey="value"
                  cornerRadius={8}
                  fill="var(--chart-1)"
                  background={{ fill: "var(--chart-grid)" }}
                />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="dash-gauge__center">
              <p className="dash-gauge__value">{derived.resolutionRate}%</p>
              <p className="dash-gauge__label">resolved</p>
            </div>
          </div>
          <ul className="dash-checks">
            <li>
              WhatsApp channel
              <span
                className={`dash-checks__status ${channels.whatsapp ? "" : "dash-checks__status--down"}`}
              >
                {channels.whatsapp ? "Connected" : "Not connected"}
              </span>
            </li>
            <li>
              Instagram channel
              <span
                className={`dash-checks__status ${channels.instagram ? "" : "dash-checks__status--down"}`}
              >
                {channels.instagram ? "Connected" : "Not connected"}
              </span>
            </li>
            <li>
              AI provider
              <span className="dash-checks__status">
                {summary?.aiUsage.activeProvider ?? "n/a"}
              </span>
            </li>
            <li>
              Knowledge entries
              <span className="dash-checks__status">{knowledgeCount}</span>
            </li>
          </ul>
        </section>
      </div>

      {/* Row 3 — lead sources + conversation balance (only once there is data) */}
      {hasData ? (
        <div className="dash-row dash-row--leads">
          <section className="dash-card" aria-label="Conversation sources">
            <div className="dash-card__header">
              <div>
                <h2 className="dash-card__title">Conversation sources</h2>
                <p className="dash-card__crumb">By channel, all time</p>
              </div>
              <span className="dash-chip">{conversations.length} total</span>
            </div>
            <div className="dash-bars">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={derived.channelBars} barSize={42}>
                  <XAxis
                    dataKey="channel"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                  />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: "var(--surface-sunken)" }}
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid var(--border-default)",
                      background: "var(--surface)",
                      color: "var(--text-primary)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                    {derived.channelBars.map((entry, index) => (
                      <Cell
                        key={entry.channel}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="dash-card" aria-label="Conversation balance">
            <div className="dash-card__header">
              <div>
                <h2 className="dash-card__title">Conversation balance</h2>
                <p className="dash-card__crumb">Escalations vs. resolved</p>
              </div>
              <Link to="/app/conversations" className="dash-card__link">
                View all
              </Link>
            </div>
            <div className="dash-gauge">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  data={[{ value: derived.escalationRate }]}
                  innerRadius="72%"
                  outerRadius="100%"
                  startAngle={210}
                  endAngle={-30}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                  <RadialBar
                    dataKey="value"
                    cornerRadius={8}
                    fill={
                      derived.escalationRate > 15 ? "var(--warning)" : "var(--chart-2)"
                    }
                    background={{ fill: "var(--chart-grid)" }}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="dash-gauge__center">
                <p className="dash-gauge__value">{derived.escalationRate}%</p>
                <p className="dash-gauge__label">escalation rate</p>
              </div>
            </div>
            <p
              className={`dash-gauge__note ${derived.escalationRate > 15 ? "dash-gauge__note--warn" : ""}`}
            >
              {derived.escalationRate > 15
                ? "Above the 15% target. Review escalated threads."
                : "Within the 15% target."}
            </p>
            <ul className="dash-legend" style={{ justifyContent: "center" }}>
              <li>
                <span className="dash-legend__dot" style={{ background: "var(--chart-2)" }} />
                Resolved {derived.resolved}
              </li>
              <li>
                <span className="dash-legend__dot" style={{ background: "var(--chart-1)" }} />
                Open {derived.open}
              </li>
              <li>
                <span className="dash-legend__dot" style={{ background: "var(--warning)" }} />
                Escalated {derived.escalated}
              </li>
            </ul>
          </section>
        </div>
      ) : (
        <section className="dash-card" aria-label="Getting started">
          <div className="dash-card__header">
            <div>
              <h2 className="dash-card__title">Get set up</h2>
              <p className="dash-card__crumb">
                Three steps to your first AI-handled conversation
              </p>
            </div>
          </div>
          <ul className="checklist checklist--live">
            <li className={knowledgeCount > 0 ? "is-done" : ""}>
              <Link to="/app/knowledge">Add knowledge to your Company Brain</Link>
            </li>
            <li className={agents.some((a) => a.enabled) ? "is-done" : ""}>
              <Link to="/app/agents">Activate at least one agent</Link>
            </li>
            <li>
              <Link to="/app/agents">Run a test conversation</Link>
            </li>
          </ul>
        </section>
      )}

      {/* Row 4 — upgrade banner for free workspaces */}
      {plan === "free" ? (
        <section className="dash-banner" aria-label="Upgrade">
          <div>
            <p className="dash-banner__title">Unlock your full AI team</p>
            <p className="dash-banner__note">
              Higher message limits, every agent, and priority support on paid plans.
            </p>
          </div>
          <Link to="/app/billing" className="btn-pill dash-banner__cta">
            View plans
          </Link>
        </section>
      ) : null}
    </div>
  );
}
