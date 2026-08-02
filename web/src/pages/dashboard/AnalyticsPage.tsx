import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchAnalyticsSummary,
  type AnalyticsSummary,
} from "../../api/runtime";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { CHANNEL_MIX, MONTHLY_ACTIVITY, RESPONSE_TREND } from "../../data/analytics";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--blue-200)"];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <article className="analytics-kpi">
      <p className="analytics-kpi__label">{label}</p>
      <div className="analytics-kpi__row">
        <p className="analytics-kpi__value">{value}</p>
      </div>
      {hint ? <p className="analytics-kpi__hint">{hint}</p> : null}
    </article>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`analytics-card ${wide ? "analytics-card--wide" : ""}`}>
      <header className="analytics-card__header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </header>
      <div className="analytics-card__body">{children}</div>
    </section>
  );
}

const emptySummary: AnalyticsSummary = {
  totalConversations: 0,
  aiResponseRate: 0,
  averageResponseTimeSeconds: 0,
  leadConversion: 0,
  salesInfluenced: 0,
  mostActiveAgent: "reception",
  mostActiveAgentShare: 0,
  agentActivity: [
    { agent: "Reception", conversations: 0, share: 0 },
    { agent: "Sales", conversations: 0, share: 0 },
    { agent: "Marketing", conversations: 0, share: 0 },
  ],
  topQuestions: [],
  leadsCount: 0,
  aiUsage: {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    activeProvider: "anthropic",
    byProvider: [],
  },
};

export function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setSummary(await fetchAnalyticsSummary());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load analytics");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const mostActiveLabel =
    summary.mostActiveAgent.charAt(0).toUpperCase() +
    summary.mostActiveAgent.slice(1).replace("_", " ");

  const agentActivity = summary.agentActivity;
  const topQuestions =
    summary.topQuestions.length > 0
      ? summary.topQuestions
      : [{ question: "No questions yet. Test an agent", count: 0 }];

  return (
    <div className="page-stack analytics-page">
      <PageHeader
        title="Analytics"
        description="Live metrics from your AI runtime, shared knowledge, and agent activity."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? (
        <LoadingState label="Loading analytics…" />
      ) : (
        <>
          <section className="analytics-kpi-grid">
            <KpiCard
              label="Monthly recurring revenue"
              value={formatCurrency(summary.billing?.monthlyRecurringRevenue ?? 0)}
              hint={
                summary.billing
                  ? `${summary.billing.planName} · ${summary.billing.subscriptionStatus}`
                  : undefined
              }
            />
            <KpiCard
              label="Messages this month"
              value={
                summary.billing?.messageLimit
                  ? `${summary.billing.messagesUsed}/${summary.billing.messageLimit}`
                  : String(summary.billing?.messagesUsed ?? 0)
              }
              hint="AI replies count toward your plan limit"
            />
            <KpiCard
              label="Total conversations"
              value={summary.totalConversations.toLocaleString()}
              hint="From AI runtime"
            />
            <KpiCard
              label="AI response rate"
              value={`${summary.aiResponseRate}%`}
              hint="Messages answered by agents"
            />
            <KpiCard
              label="Average response time"
              value={`${summary.averageResponseTimeSeconds}s`}
              hint="Estimated for current runtime"
            />
            <KpiCard
              label="Lead conversion"
              value={`${summary.leadConversion}%`}
              hint={`${summary.leadsCount} leads created`}
            />
            <KpiCard
              label="Sales influenced"
              value={formatCurrency(summary.salesInfluenced)}
              hint="Pipeline touched by Sales agent"
            />
            <KpiCard
              label="AI provider"
              value={summary.aiUsage.activeProvider}
              hint={`${summary.aiUsage.totalInputTokens.toLocaleString()} in / ${summary.aiUsage.totalOutputTokens.toLocaleString()} out tokens`}
            />
            <KpiCard
              label="Estimated AI cost"
              value={formatCurrency(summary.aiUsage.totalCostUsd)}
              hint={
                summary.aiUsage.byProvider.length > 0
                  ? summary.aiUsage.byProvider
                      .map((row) => `${row.provider}: ${formatCurrency(row.costUsd)}`)
                      .join(" · ")
                  : "Logged per request"
              }
            />
          </section>

          <section className="analytics-grid">
            <ChartCard
              title="Monthly activity"
              subtitle="Trend template. Volume grows as conversations accumulate"
              wide
            >
              <div className="analytics-chart analytics-chart--tall">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={MONTHLY_ACTIVITY}>
                    <defs>
                      <linearGradient id="convFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="conversations"
                      name="Conversations"
                      stroke="var(--chart-1)"
                      fill="url(#convFill)"
                      strokeWidth={2.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard title="Most active agent" subtitle="Share of handled conversations">
              <div className="analytics-active-agent">
                <div className="analytics-active-agent__hero">
                  <p className="analytics-active-agent__label">Top performer</p>
                  <p className="analytics-active-agent__name">{mostActiveLabel}</p>
                  <p className="analytics-active-agent__meta">
                    {summary.mostActiveAgentShare}% of conversations
                  </p>
                </div>
                <div className="analytics-chart analytics-chart--pie">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={agentActivity}
                        dataKey="conversations"
                        nameKey="agent"
                        innerRadius={52}
                        outerRadius={78}
                        paddingAngle={3}
                      >
                        {agentActivity.map((entry, index) => (
                          <Cell
                            key={entry.agent}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="analytics-legend">
                  {agentActivity.map((agent, index) => (
                    <li key={agent.agent}>
                      <span
                        className="analytics-legend__swatch"
                        style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                      />
                      <span>{agent.agent}</span>
                      <strong>{agent.share}%</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </ChartCard>

            <ChartCard title="Top questions" subtitle="From live customer messages">
              <div className="analytics-chart analytics-chart--bars">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topQuestions} layout="vertical" margin={{ left: 8, right: 12 }}>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} />
                    <YAxis
                      type="category"
                      dataKey="question"
                      width={150}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                    />
                    <Tooltip />
                    <Bar dataKey="count" name="Mentions" fill="var(--chart-1)" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard title="AI response quality" subtitle="Trend template">
              <div className="analytics-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={RESPONSE_TREND}>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="rate"
                      name="Response rate %"
                      stroke="var(--chart-1)"
                      fill="var(--blue-100)"
                      strokeWidth={2.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard title="Channel mix" subtitle="Channel template until more channels connect">
              <div className="analytics-channel-list">
                {CHANNEL_MIX.map((channel, index) => (
                  <div key={channel.channel} className="analytics-channel-row">
                    <div className="analytics-channel-row__label">
                      <span>{channel.channel}</span>
                      <strong>{channel.value}%</strong>
                    </div>
                    <div className="analytics-channel-row__track">
                      <span
                        style={{
                          width: `${channel.value}%`,
                          background: CHART_COLORS[index % CHART_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </ChartCard>
          </section>
        </>
      )}
    </div>
  );
}
