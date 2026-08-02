import type { Config } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { evaluateObservabilityAlerts } from "./_shared/alerts.ts";
import { log } from "./_shared/logger.ts";

async function handler() {
  try {
    const result = await evaluateObservabilityAlerts();
    log.info("observability_alerts_evaluated", result);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    log.error("observability_alerts_failed", {
      error_message: error instanceof Error ? error.message : "unknown",
    });
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
};

export const config: Config = {
  schedule: "*/10 * * * *",
};

export default withObservability(handler);
