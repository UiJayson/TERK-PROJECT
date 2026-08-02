import { createId } from "./auth-crypto.ts";
import { getConfig } from "./config.ts";
import * as db from "./db.ts";
import { sendEmail } from "./email.ts";
import { log } from "./logger.ts";

function adminAlertEmail(): string | null {
  return (
    getConfig().auth.adminAlertEmail ??
    getConfig().resend.fromEmail ??
    null
  );
}

async function sendAdminAlert(alertType: string, message: string): Promise<void> {
  const to = adminAlertEmail();
  if (!to) {
    log.warn("alert_skipped_no_recipient", { alert_type: alertType });
    return;
  }

  const recentlySent = await db.wasAlertSentRecently(alertType, 30);
  if (recentlySent) return;

  await sendEmail({
    to,
    subject: `[AI OS Alert] ${alertType}`,
    text: message,
    html: `<p><strong>${alertType}</strong></p><p>${message}</p>`,
  });

  await db.saveObservabilityAlert({
    id: createId("alert"),
    alertType,
    message,
  });
}

export async function evaluateObservabilityAlerts(): Promise<{
  checked: string[];
  triggered: string[];
}> {
  const checked: string[] = [];
  const triggered: string[] = [];

  const health10m = await db.getObservabilityHealthSummary(10 / 60);
  checked.push("error_rate_10m");
  if (health10m.requestCount >= 20 && health10m.errorRate > 5) {
    triggered.push("error_rate_10m");
    await sendAdminAlert(
      "error_rate_spike",
      `Error rate is ${health10m.errorRate}% over the last 10 minutes (${health10m.errorCount}/${health10m.requestCount} requests).`,
    );
  }

  const health24h = await db.getObservabilityHealthSummary(24);
  checked.push("ai_latency_24h");
  if (health24h.ai.count >= 10 && health24h.ai.avgMs > 5000) {
    triggered.push("ai_latency_24h");
    await sendAdminAlert(
      "ai_latency_high",
      `Average AI response time is ${health24h.ai.avgMs}ms over the last 24 hours (p95 ${health24h.ai.p95Ms}ms).`,
    );
  }

  checked.push("webhook_failures_1h");
  const webhookFailures = await db.countRecentWebhookFailures(1);
  if (webhookFailures > 10) {
    triggered.push("webhook_failures_1h");
    await sendAdminAlert(
      "webhook_failures",
      `${webhookFailures} webhook processing failures in the last hour.`,
    );
  }

  return { checked, triggered };
}
