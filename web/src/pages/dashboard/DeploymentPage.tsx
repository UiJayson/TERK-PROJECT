import { useCallback, useEffect, useState } from "react";
import {
  fetchGateStatus,
  fetchKbVersions,
  goLive,
  rollbackKb,
  tryRetrieval,
  type DeploymentGate,
  type KbVersion,
  type RetrievalAnswer,
} from "../../api/deployment";
import { Card } from "../../components/ui/Card";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";

export function DeploymentPage() {
  const [gate, setGate] = useState<DeploymentGate | null>(null);
  const [versions, setVersions] = useState<KbVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testAnswer, setTestAnswer] = useState<RetrievalAnswer | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [g, v] = await Promise.all([
        fetchGateStatus(),
        fetchKbVersions().catch(() => ({ versions: [] as KbVersion[] })),
      ]);
      setGate(g.gate);
      setVersions(v.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load gate status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function attemptGoLive() {
    setAction(true);
    setError("");
    try {
      const { gate } = await goLive();
      setGate(gate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Go-live failed");
    } finally {
      setAction(false);
    }
  }

  async function rollback(version: number) {
    setAction(true);
    setError("");
    try {
      const { versions } = await rollbackKb(version);
      setVersions(versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback failed");
    } finally {
      setAction(false);
    }
  }

  async function runTest() {
    if (!testMessage.trim()) return;
    setTesting(true);
    try {
      const { answer } = await tryRetrieval(testMessage);
      setTestAnswer(answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  if (loading || !gate) {
    return (
      <div className="page-stack">
        <PageHeader title="Deployment gate" description="Go-live is enforced at the API level." />
        <LoadingState label="Checking gate…" />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Deployment gate"
        description="The AI agent cannot go live until every condition below is green. Enforced by the API — the UI cannot bypass it."
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <Card title={`Status: ${gate.status}`}>
        <ul className="integrations-copy" style={{ padding: 0, listStyle: "none" }}>
          <Check label="Wizard 100% complete" ok={gate.wizardComplete} detail={gate.wizardMissing.length > 0 ? `Missing: ${gate.wizardMissing.join(", ")}` : undefined} />
          <Check
            label="All critical categories verified"
            ok={gate.criticalCategoriesMissing.length === 0}
            detail={gate.criticalCategoriesMissing.length > 0 ? `Missing: ${gate.criticalCategoriesMissing.join(", ")}` : undefined}
          />
          <Check label="Zero unresolved contradictions" ok={gate.contradictionCount === 0} detail={gate.contradictionCount > 0 ? `${gate.contradictionCount} to resolve` : undefined} />
          <Check label="At least one escalation contact" ok={gate.escalationContactCount > 0} detail={`${gate.escalationContactCount} defined`} />
          <Check
            label={`Validation pass rate ≥ ${gate.passRateThreshold}%`}
            ok={gate.validationPassRate >= gate.passRateThreshold}
            detail={`Currently ${gate.validationPassRate.toFixed(1)}%`}
          />
        </ul>

        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="agent-btn agent-btn--primary"
            onClick={() => void attemptGoLive()}
            disabled={action || !gate.canGoLive || gate.status === "live"}
            title={gate.canGoLive ? "" : gate.reasons.join(" · ")}
          >
            {gate.status === "live" ? "Live" : action ? "Working…" : "Go live"}
          </button>
        </div>

        {!gate.canGoLive && gate.reasons.length > 0 ? (
          <ul style={{ marginTop: 10, color: "var(--danger, #b91c1c)" }}>
            {gate.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        ) : null}
      </Card>

      <Card title="Try the two-track retrieval">
        <p className="integrations-copy">Test a customer question — see whether it routes to structured DB, RAG, or fallback.</p>
        <input
          type="text"
          placeholder="e.g. What is your refund policy?"
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          style={{ width: "100%" }}
        />
        <button className="agent-btn agent-btn--primary" onClick={() => void runTest()} disabled={testing}>
          {testing ? "Asking…" : "Ask"}
        </button>
        {testAnswer ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: "0.85em", opacity: 0.7 }}>
              Track: <strong>{testAnswer.track}</strong> · Source: {testAnswer.source} · Confidence: {testAnswer.confidence.toFixed(2)} · KB v{testAnswer.kbVersion}
            </div>
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{testAnswer.answer}</div>
          </div>
        ) : null}
      </Card>

      <Card title="Knowledge base versions">
        {versions.length === 0 ? (
          <p className="integrations-copy">No published versions yet. Upload a document to create v1.</p>
        ) : (
          <ul className="integrations-copy" style={{ padding: 0, listStyle: "none" }}>
            {versions.map((v) => (
              <li key={v.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                <strong>v{v.versionNumber}</strong>
                {v.isActive ? <span className="channel-badge channel-badge--connected" style={{ marginLeft: 8 }}>active</span> : null}
                {v.notes ? ` — ${v.notes}` : ""}
                <span style={{ marginLeft: 8, opacity: 0.7 }}>{new Date(v.publishedAt).toLocaleString()}</span>
                {!v.isActive ? (
                  <button
                    style={{ marginLeft: 8 }}
                    className="agent-btn agent-btn--ghost"
                    onClick={() => void rollback(v.versionNumber)}
                    disabled={action}
                  >
                    Roll back to this version
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Check({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <li style={{ padding: "6px 0" }}>
      <span
        className={`channel-badge channel-badge--${ok ? "connected" : "disconnected"}`}
        style={{ marginRight: 8 }}
      >
        {ok ? "✓" : "✗"}
      </span>
      {label}
      {detail ? <span style={{ marginLeft: 8, opacity: 0.75 }}>· {detail}</span> : null}
    </li>
  );
}
