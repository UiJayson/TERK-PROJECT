import { useEffect, useState } from "react";
import { fetchObservabilityHealth, type ObservabilityHealthSummary } from "../../api/observability";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatCard } from "../../components/ui/StatCard";

function formatMs(value: number): string {
  return `${value.toLocaleString()} ms`;
}

function MetricRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="health-metric">
      <p className="health-metric__label">{label}</p>
      <p className="health-metric__value">{value}</p>
      {hint ? <p className="health-metric__hint">{hint}</p> : null}
    </div>
  );
}

export function SystemHealthPage() {
  const [summary, setSummary] = useState<ObservabilityHealthSummary | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchObservabilityHealth();
        setSummary(data.summary);
        setGeneratedAt(data.generatedAt);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load system health");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="page-stack">
      <PageHeader
        title="System Health"
        description="24-hour production averages for API latency, errors, AI, database, and webhooks."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingState label="Loading system health…" /> : null}

      {summary ? (
        <>
          <p className="settings-form__hint">
            Last updated {generatedAt ? new Date(generatedAt).toLocaleString() : "just now"}.
            Structured JSON logs and Sentry capture run on every API request.
          </p>

          <section className="analytics-kpi-grid">
            <StatCard label="API requests (24h)" value={String(summary.requestCount)} />
            <StatCard label="Error rate" value={`${summary.errorRate}%`} />
            <StatCard label="Avg response time" value={formatMs(summary.avgLatencyMs)} />
            <StatCard label="P95 response time" value={formatMs(summary.p95LatencyMs)} />
          </section>

          <section className="health-grid">
            <article className="card health-card">
              <h2>AI performance</h2>
              <MetricRow label="Samples" value={String(summary.ai.count)} />
              <MetricRow label="Average latency" value={formatMs(summary.ai.avgMs)} />
              <MetricRow label="P95 latency" value={formatMs(summary.ai.p95Ms)} hint="Alert if consistently above 5s" />
            </article>

            <article className="card health-card">
              <h2>Database performance</h2>
              <MetricRow label="Samples" value={String(summary.db.count)} />
              <MetricRow label="Average query time" value={formatMs(summary.db.avgMs)} />
              <MetricRow label="P95 query time" value={formatMs(summary.db.p95Ms)} />
            </article>

            <article className="card health-card">
              <h2>Webhook processing</h2>
              <MetricRow label="Samples" value={String(summary.webhook.count)} />
              <MetricRow label="Average processing" value={formatMs(summary.webhook.avgMs)} />
              <MetricRow
                label="Failures (24h)"
                value={String(summary.webhook.failures)}
                hint="Alert if more than 10 failures in 1 hour"
              />
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}
