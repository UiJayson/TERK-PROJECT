import { useEffect, useState } from "react";
import { usePermissions } from "../../auth/usePermissions";
import { Navigate } from "react-router-dom";
import { fetchAdminHealth, type AdminHealthDashboard } from "../../api/observability";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatCard } from "../../components/ui/StatCard";

function formatMs(value: number): string {
  return `${value.toLocaleString()} ms`;
}

export function AdminHealthPage() {
  const { role } = usePermissions();
  const [dashboard, setDashboard] = useState<AdminHealthDashboard | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchAdminHealth();
        setDashboard(data.dashboard);
        setGeneratedAt(data.generatedAt);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load admin health");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (role !== "owner") {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Admin Health"
        description="Platform-wide health metrics for workspace owners."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingState label="Loading admin health…" /> : null}

      {dashboard ? (
        <>
          <p className="settings-form__hint">
            Last updated {generatedAt ? new Date(generatedAt).toLocaleString() : "just now"}.
          </p>

          <section className="analytics-kpi-grid">
            <StatCard label="Total workspaces" value={String(dashboard.totalWorkspaces)} />
            <StatCard
              label="Active conversations today"
              value={String(dashboard.activeConversationsToday)}
            />
            <StatCard label="Avg AI latency (24h)" value={formatMs(dashboard.avgAiLatencyMs)} />
            <StatCard label="Error rate (24h)" value={`${dashboard.errorRate}%`} />
            <StatCard
              label="Webhook success rate"
              value={`${dashboard.webhookSuccessRate}%`}
            />
          </section>

          <section className="card">
            <h2>Top errors (24h)</h2>
            {dashboard.topErrors.length === 0 ? (
              <p className="billing-empty">No errors recorded.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Count</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.topErrors.map((item) => (
                    <tr key={item.endpoint}>
                      <td>{item.endpoint}</td>
                      <td>{item.count}</td>
                      <td>{new Date(item.lastSeen).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
