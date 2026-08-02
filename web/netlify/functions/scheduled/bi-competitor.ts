import type { Config } from "@netlify/functions";
import { withObservability } from "../_shared/observability.ts";
import { monitorCompetitors, detectPriceChanges } from "../_shared/bi-agent.ts";
import * as db from "../_shared/db.ts";
import { log } from "../_shared/logger.ts";

async function handler() {
  const workspaceIds = await db.listWorkspaceIds();
  let scraped = 0;
  let priceAlerts = 0;
  const errors: string[] = [];

  for (const workspaceId of workspaceIds) {
    try {
      const result = await monitorCompetitors(workspaceId);
      scraped += result.scraped;
      if (result.errors.length > 0) {
        errors.push(...result.errors.map((e) => `${workspaceId}: ${e}`));
      }

      const changes = await detectPriceChanges(workspaceId);
      priceAlerts += changes.alertsSent;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      errors.push(`${workspaceId}: ${message}`);
      log.warn("bi_competitor_scheduled_failed", { workspaceId, error: message });
    }
  }

  log.info("bi_competitor_scheduled_completed", {
    function: "scheduled/bi-competitor",
    workspaces: workspaceIds.length,
    scraped,
    priceAlerts,
    errors: errors.length,
  });

  return new Response(
    JSON.stringify({ ok: true, workspaces: workspaceIds.length, scraped, priceAlerts, errors }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export const config: Config = {
  schedule: "0 6 * * 1",
};

export default withObservability(handler);
