import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  fetchBIDashboard,
  runBIAnalysis,
  saveBICompetitorUrls,
  scrapeBICompetitors,
  sendBIWeeklyReport,
  type BusinessInsight,
  type BIMetrics,
  type CompetitorData,
} from "../../api/bi";
import { EmptyState } from "../ui/EmptyState";
import { ErrorBanner } from "../ui/ErrorBanner";
import { LoadingState } from "../ui/LoadingState";

interface BIPanelProps {
  readOnly?: boolean;
}

export function BIPanel({ readOnly = false }: BIPanelProps) {
  const [metrics, setMetrics] = useState<BIMetrics | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorData[]>([]);
  const [insights, setInsights] = useState<BusinessInsight[]>([]);
  const [competitorUrls, setCompetitorUrls] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const dashboard = await fetchBIDashboard();
      setMetrics(dashboard.metrics);
      setCompetitors(dashboard.competitors);
      setInsights(dashboard.insights);
      setCompetitorUrls(dashboard.competitorUrls.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load BI data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveUrls(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSuccess("");
    setError("");
    try {
      const urls = competitorUrls
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const saved = await saveBICompetitorUrls(urls);
      setCompetitorUrls(saved.join("\n"));
      setSuccess(`Saved ${saved.length} competitor URL(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save URLs");
    } finally {
      setBusy(false);
    }
  }

  async function handleScrape() {
    setBusy(true);
    setSuccess("");
    setError("");
    try {
      const result = await scrapeBICompetitors();
      setSuccess(`Scraped ${result.scraped} competitor page(s).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scrape failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleAnalyze() {
    setBusy(true);
    setSuccess("");
    setError("");
    try {
      await runBIAnalysis();
      setSuccess("SWOT, growth report, opportunities, and risks updated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleWeeklyReport() {
    setBusy(true);
    setSuccess("");
    setError("");
    try {
      await sendBIWeeklyReport();
      setSuccess("Weekly BI report sent to workspace owner.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send report");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading business intelligence…" />;
  }

  const swotInsights = insights.filter((i) => i.type === "swot");
  const growthInsights = insights.filter((i) => i.type === "growth_report");
  const riskInsights = insights.filter((i) => i.type === "risk");
  const opportunityInsights = insights.filter((i) => i.type === "opportunity");

  return (
    <section className="marketing-panel" aria-label="Business intelligence dashboard">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {success ? <p className="integrations-copy">{success}</p> : null}

      {metrics ? (
        <dl className="conv-detail__stats marketing-stats">
          <div>
            <dt>Conversations</dt>
            <dd>{metrics.conversationCount}</dd>
          </div>
          <div>
            <dt>Qualified leads</dt>
            <dd>{metrics.qualifiedLeads}</dd>
          </div>
          <div>
            <dt>Appointments</dt>
            <dd>{metrics.appointmentCount}</dd>
          </div>
          <div>
            <dt>Escalations</dt>
            <dd>{metrics.escalatedConversations}</dd>
          </div>
        </dl>
      ) : null}

      {!readOnly ? (
        <form className="marketing-campaign-form" onSubmit={(event) => void handleSaveUrls(event)}>
          <h3>Competitor URLs</h3>
          <p className="integrations-copy">One URL per line. Scraping respects robots.txt.</p>
          <textarea
            value={competitorUrls}
            onChange={(event) => setCompetitorUrls(event.target.value)}
            rows={3}
            placeholder="https://competitor.com/pricing"
            disabled={busy}
          />
          <div className="kb-header-actions">
            <button type="submit" className="agent-btn agent-btn--ghost" disabled={busy}>
              Save URLs
            </button>
            <button
              type="button"
              className="agent-btn agent-btn--ghost"
              disabled={busy}
              onClick={() => void handleScrape()}
            >
              Scrape now
            </button>
            <button
              type="button"
              className="agent-btn agent-btn--primary"
              disabled={busy}
              onClick={() => void handleAnalyze()}
            >
              Run full analysis
            </button>
            <button
              type="button"
              className="agent-btn agent-btn--ghost"
              disabled={busy}
              onClick={() => void handleWeeklyReport()}
            >
              Send weekly report
            </button>
          </div>
        </form>
      ) : null}

      <div className="marketing-columns">
        <section>
          <h3>Competitor pricing</h3>
          {competitors.length === 0 ? (
            <EmptyState
              title="No competitor data"
              description="Add competitor URLs and run a scrape to monitor pricing."
            />
          ) : (
            <ul className="marketing-list">
              {competitors.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <strong>{item.sourceUrl}</strong>
                  <p>{item.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>SWOT & growth</h3>
          {swotInsights.length === 0 && growthInsights.length === 0 ? (
            <EmptyState
              title="No analysis yet"
              description="Run full analysis to generate SWOT and growth recommendations."
            />
          ) : (
            <ul className="marketing-list">
              {[...swotInsights, ...growthInsights].slice(0, 5).map((insight) => (
                <li key={insight.id}>
                  <strong>{insight.title}</strong>
                  <p>{insight.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="marketing-columns">
        <section>
          <h3>Risk alerts</h3>
          {riskInsights.length === 0 ? (
            <EmptyState title="No risks flagged" description="Run analysis to detect business risks." />
          ) : (
            <ul className="marketing-list">
              {riskInsights.slice(0, 5).map((insight) => (
                <li key={insight.id}>
                  <strong>{insight.title}</strong>
                  <p>{insight.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Opportunities</h3>
          {opportunityInsights.length === 0 ? (
            <EmptyState title="No opportunities yet" description="Run analysis to detect unmet customer demand." />
          ) : (
            <ul className="marketing-list">
              {opportunityInsights.slice(0, 5).map((insight) => (
                <li key={insight.id}>
                  <strong>{insight.title}</strong>
                  <p>{insight.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
