import { FormEvent, useCallback, useEffect, useState } from "react";
import { fetchKnowledgeItems, type KnowledgeItem } from "../../api/knowledge";
import {
  fetchMarketingDashboard,
  generateMarketingCampaign,
  syncMarketingCrm,
  type MarketingCampaign,
  type MarketingInsight,
  type MarketingStats,
} from "../../api/marketing";
import { EmptyState } from "../ui/EmptyState";
import { ErrorBanner } from "../ui/ErrorBanner";
import { LoadingState } from "../ui/LoadingState";

interface MarketingPanelProps {
  readOnly?: boolean;
}

export function MarketingPanel({ readOnly = false }: MarketingPanelProps) {
  const [stats, setStats] = useState<MarketingStats | null>(null);
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [insights, setInsights] = useState<MarketingInsight[]>([]);
  const [products, setProducts] = useState<KnowledgeItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [dashboard, knowledge] = await Promise.all([
        fetchMarketingDashboard(),
        fetchKnowledgeItems({ section: "products" }),
      ]);
      setStats(dashboard.stats);
      setCampaigns(dashboard.campaigns);
      setInsights(dashboard.insights);
      const productItems = knowledge.filter((item) => item.type === "product");
      setProducts(productItems);
      setSelectedProductId((current) => current || productItems[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load marketing data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGenerateCampaign(event: FormEvent) {
    event.preventDefault();
    const product = products.find((item) => item.id === selectedProductId);
    if (!product) return;

    setBusy(true);
    setSuccess("");
    setError("");
    try {
      const campaign = await generateMarketingCampaign({
        productId: product.id,
        productName: product.title,
      });
      setCampaigns((current) => [campaign, ...current]);
      setSuccess(`Campaign "${campaign.name}" created with lead magnet, landing copy, and email sequence.`);
      const dashboard = await fetchMarketingDashboard();
      setStats(dashboard.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate campaign");
    } finally {
      setBusy(false);
    }
  }

  async function handleCrmSync() {
    setBusy(true);
    setSuccess("");
    setError("");
    try {
      const result = await syncMarketingCrm();
      setSuccess(`Synced ${result.exportedCount} qualified lead(s) via ${result.method}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CRM sync failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading marketing dashboard…" />;
  }

  return (
    <section className="marketing-panel" aria-label="Marketing dashboard">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {success ? <p className="integrations-copy">{success}</p> : null}

      {stats ? (
        <dl className="conv-detail__stats marketing-stats">
          <div>
            <dt>Lead magnets</dt>
            <dd>{stats.leadMagnetsCreated}</dd>
          </div>
          <div>
            <dt>Active campaigns</dt>
            <dd>{stats.campaignsActive}</dd>
          </div>
          <div>
            <dt>Leads generated</dt>
            <dd>{stats.leadsGenerated}</dd>
          </div>
          <div>
            <dt>Competitor insights</dt>
            <dd>{stats.competitorInsights}</dd>
          </div>
        </dl>
      ) : null}

      {!readOnly ? (
        <form className="marketing-campaign-form" onSubmit={(event) => void handleGenerateCampaign(event)}>
          <h3>Generate Campaign</h3>
          <p className="integrations-copy">
            Select a product — AI creates a lead magnet, landing page copy, and 5-email nurture sequence
            from your Knowledge Base.
          </p>
          <div className="kb-header-actions">
            <select
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
              disabled={busy || products.length === 0}
            >
              {products.length === 0 ? (
                <option value="">No products in catalog</option>
              ) : (
                products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.title}
                  </option>
                ))
              )}
            </select>
            <button
              type="submit"
              className="agent-btn agent-btn--primary"
              disabled={busy || !selectedProductId}
            >
              {busy ? "Generating…" : "Generate Campaign"}
            </button>
            <button
              type="button"
              className="agent-btn agent-btn--ghost"
              disabled={busy}
              onClick={() => void handleCrmSync()}
            >
              Sync leads to CRM
            </button>
          </div>
        </form>
      ) : null}

      <div className="marketing-columns">
        <section>
          <h3>Recent campaigns</h3>
          {campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns yet"
              description="Generate your first campaign to see lead magnets and email sequences here."
            />
          ) : (
            <ul className="marketing-list">
              {campaigns.slice(0, 5).map((campaign) => (
                <li key={campaign.id}>
                  <strong>{campaign.name}</strong>
                  <span className="marketing-list__meta">{campaign.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Competitor & news insights</h3>
          {insights.length === 0 ? (
            <EmptyState
              title="No insights yet"
              description="Scrape competitor pricing or industry RSS feeds to populate insights."
            />
          ) : (
            <ul className="marketing-list">
              {insights.map((insight) => (
                <li key={insight.id}>
                  <strong>{insight.title ?? insight.type}</strong>
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
