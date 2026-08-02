import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePermissions } from "../../auth/usePermissions";
import {
  cancelSubscription,
  fetchBillingOverview,
  openBillingPortal,
  startSubscription,
  verifyPaystackPayment,
  type BillingOverview,
  type PlanDetails,
} from "../../api/billing";
import { BillingAlerts } from "../../components/billing/BillingAlerts";
import { billingAlerts } from "../../lib/billing/usage";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";

function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "trialing":
      return "Trial";
    case "canceling":
      return "Canceling at period end";
    case "past_due":
      return "Past due";
    case "canceled":
      return "Canceled";
    default:
      return "Inactive";
  }
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    return (
      <div className="billing-usage">
        <div className="billing-usage__label">
          <span>Messages this month</span>
          <strong>{used.toLocaleString()} / Unlimited</strong>
        </div>
        <div className="billing-usage__track billing-usage__track--unlimited" />
      </div>
    );
  }

  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="billing-usage">
      <div className="billing-usage__label">
        <span>Messages this month</span>
        <strong>
          {used.toLocaleString()}/{limit.toLocaleString()} used
        </strong>
      </div>
      <div className="billing-usage__track" aria-hidden="true">
        <div
          className={`billing-usage__fill${pct >= 90 ? " billing-usage__fill--warn" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  currentPlanId,
  busy,
  canManage,
  onSelect,
}: {
  plan: PlanDetails;
  currentPlanId: string;
  busy: boolean;
  canManage: boolean;
  onSelect: (planId: string) => void;
}) {
  const isCurrent = plan.id === currentPlanId;
  const limitLabel =
    plan.messageLimit === null
      ? "Unlimited messages"
      : `${plan.messageLimit.toLocaleString()} msgs/mo`;
  const agentLabel =
    plan.agentLimit === null ? "All agents" : `${plan.agentLimit} agent${plan.agentLimit > 1 ? "s" : ""}`;

  return (
    <article className={`billing-plan card${isCurrent ? " billing-plan--current" : ""}`}>
      <header>
        <h3>{plan.name}</h3>
        <p className="billing-plan__price">
          {formatMoney(plan.priceMonthly)}
          <span>/mo</span>
        </p>
      </header>
      <p className="billing-plan__desc">{plan.description}</p>
      <ul className="billing-plan__features">
        <li>{agentLabel}</li>
        <li>{limitLabel}</li>
        <li>{plan.channels.join(", ")}</li>
      </ul>
      {canManage ? (
        <button
          type="button"
          className={`agent-btn ${isCurrent ? "agent-btn--ghost" : "agent-btn--primary"}`}
          disabled={busy || isCurrent}
          onClick={() => onSelect(plan.id)}
        >
          {isCurrent ? "Current plan" : plan.priceMonthly > 0 ? "Choose plan" : "Select"}
        </button>
      ) : null}
    </article>
  );
}

export function BillingPage() {
  const { canManageSettings } = usePermissions();
  const [searchParams] = useSearchParams();
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const checkoutStatus = searchParams.get("checkout");
  const paystackReference = searchParams.get("reference") ?? searchParams.get("trxref");

  const load = useCallback(async () => {
    setError("");
    try {
      setOverview(await fetchBillingOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load billing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (checkoutStatus === "success") {
      if (paystackReference) {
        void verifyPaystackPayment(paystackReference)
          .then(() => {
            setSuccess("Payment verified. Your plan is now active.");
            return load();
          })
          .catch((err) => {
            setError(err instanceof Error ? err.message : "Could not verify payment");
          });
      } else {
        setSuccess("Payment received. Your plan will update shortly.");
      }
    }
  }, [checkoutStatus, paystackReference, load]);

  const paidPlans = useMemo(
    () => overview?.plans.filter((plan) => plan.id !== "free") ?? [],
    [overview?.plans],
  );

  async function handleSelectPlan(planId: string) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const url = await startSubscription(planId);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setBusy(false);
    }
  }

  async function handleCancel() {
    const confirmed = window.confirm(
      "Cancel at the end of this billing period? You keep access until then.",
    );
    if (!confirmed) return;

    setBusy(true);
    setError("");
    try {
      const message = await cancelSubscription();
      setSuccess(message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel subscription");
    } finally {
      setBusy(false);
    }
  }

  async function handlePortal() {
    setBusy(true);
    setError("");
    try {
      const url = await openBillingPortal();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal");
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader title="Billing" description="Plans, usage, and invoices." />
        <LoadingState label="Loading billing…" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="page-stack">
        <PageHeader title="Billing" description="Plans, usage, and invoices." />
        <ErrorBanner message={error || "Billing unavailable"} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="page-stack billing-page">
      <PageHeader
        title="Billing"
        description="Manage your subscription, track usage, and download invoices."
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {success ? <p className="auth-form__success">{success}</p> : null}

      <BillingAlerts alerts={billingAlerts(overview)} onManagePayment={() => void handlePortal()} />


      <section className="billing-current card">
        <div className="billing-current__header">
          <div>
            <p className="billing-current__eyebrow">Current plan</p>
            <h2>{overview.planDetails.name}</h2>
            <p className="billing-current__status">{statusLabel(overview.subscriptionStatus)}</p>
          </div>
          <div className="billing-current__price">
            {formatMoney(overview.planDetails.priceMonthly)}
            <span>/month</span>
          </div>
        </div>

        <UsageBar used={overview.usage.messagesSent} limit={overview.usage.messageLimit} />

        {overview.subscriptionPeriodEnd ? (
          <p className="billing-current__period">
            {overview.subscriptionStatus === "canceling"
              ? `Access until ${formatDate(overview.subscriptionPeriodEnd)}`
              : `Renews ${formatDate(overview.subscriptionPeriodEnd)}`}
          </p>
        ) : null}

        {canManageSettings ? (
          <div className="billing-current__actions">
            {overview.subscriptionStatus === "active" ||
            overview.subscriptionStatus === "canceling" ? (
              <>
                <button
                  type="button"
                  className="agent-btn agent-btn--ghost"
                  disabled={busy}
                  onClick={() => void handlePortal()}
                >
                  Manage payment method
                </button>
                {overview.subscriptionStatus === "active" ? (
                  <button
                    type="button"
                    className="agent-btn agent-btn--ghost"
                    disabled={busy}
                    onClick={() => void handleCancel()}
                  >
                    Cancel subscription
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : (
          <p className="settings-form__hint">Only owners and admins can change billing.</p>
        )}
      </section>

      <section>
        <h2 className="billing-section-title">Plans</h2>
        <div className="billing-plans-grid">
          {paidPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              currentPlanId={overview.plan}
              busy={busy}
              canManage={canManageSettings}
              onSelect={(planId) => void handleSelectPlan(planId)}
            />
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="billing-section-title">Payment history</h2>
        {overview.invoices.length === 0 ? (
          <p className="billing-empty">No invoices yet.</p>
        ) : (
          <div className="billing-invoices">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {overview.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{formatDate(invoice.createdAt)}</td>
                    <td>{formatMoney(invoice.amountCents / 100, invoice.currency.toUpperCase())}</td>
                    <td>{invoice.status}</td>
                    <td>
                      {invoice.invoicePdfUrl ? (
                        <a href={invoice.invoicePdfUrl} target="_blank" rel="noreferrer">
                          Download
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
