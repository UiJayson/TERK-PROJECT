import { Link } from "react-router-dom";
import type { BillingAlert } from "../../lib/billing/usage";

/**
 * Renders billing alerts (approaching limit, limit reached, payment failed,
 * cancellation notice) computed by lib/billing/usage.ts. Drop into the
 * billing page or any dashboard surface.
 */
export function BillingAlerts({
  alerts,
  onManagePayment,
}: {
  alerts: BillingAlert[];
  onManagePayment?: () => void;
}) {
  if (alerts.length === 0) return null;

  return (
    <div className="billing-alerts">
      {alerts.map((alert) => (
        <div
          key={alert.kind}
          className={`billing-alert billing-alert--${alert.severity}`}
          role={alert.severity === "error" ? "alert" : "status"}
        >
          <p>{alert.message}</p>
          {alert.action === "upgrade" ? (
            <Link className="agent-btn agent-btn--primary" to="/app/billing">
              Upgrade plan
            </Link>
          ) : null}
          {alert.action === "update_payment" && onManagePayment ? (
            <button
              type="button"
              className="agent-btn agent-btn--primary"
              onClick={onManagePayment}
            >
              Update payment method
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
