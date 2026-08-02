import type { Config } from "@netlify/functions";
import { withObservability } from "../_shared/observability.ts";
import { processEvents } from "../_shared/event-bus.ts";
import { resumeDueWorkflowExecutions } from "../_shared/workflow-engine.ts";
import { log } from "../_shared/logger.ts";

async function handler() {
  try {
    const [eventResult, workflowsResumed] = await Promise.all([
      processEvents(100),
      resumeDueWorkflowExecutions(),
    ]);

    log.info("event_bus_processor_completed", {
      function: "scheduled/event-bus-processor",
      ...eventResult,
      workflowsResumed,
    });

    return new Response(
      JSON.stringify({ ok: true, ...eventResult, workflowsResumed }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    log.error("event_bus_processor_failed", {
      function: "scheduled/event-bus-processor",
      error: error instanceof Error ? error.message : "unknown",
    });
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
}

export const config: Config = {
  schedule: "*/2 * * * *",
};

export default withObservability(handler);
