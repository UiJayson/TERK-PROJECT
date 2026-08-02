import type { Config } from "@netlify/functions";
import { withObservability } from "../_shared/observability.ts";
import { runFullBIAnalysis, sendWeeklyBIReport } from "../_shared/bi-agent.ts";
import * as db from "../_shared/db.ts";
import { log } from "../_shared/logger.ts";

async function handler() {
  const workspaceIds = await db.listWorkspaceIds();
  let reportsSent = 0;
  const errors: string[] = [];

  for (const workspaceId of workspaceIds) {
    try {
      await runFullBIAnalysis(workspaceId);
      await sendWeeklyBIReport(workspaceId);
      reportsSent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      errors.push(`${workspaceId}: ${message}`);
      log.warn("bi_weekly_report_failed", { workspaceId, error: message });
    }
  }

  log.info("bi_weekly_report_completed", {
    function: "scheduled/bi-weekly-report",
    workspaces: workspaceIds.length,
    reportsSent,
    errors: errors.length,
  });

  return new Response(
    JSON.stringify({ ok: true, workspaces: workspaceIds.length, reportsSent, errors }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export const config: Config = {
  schedule: "0 8 * * 1",
};

export default withObservability(handler);
