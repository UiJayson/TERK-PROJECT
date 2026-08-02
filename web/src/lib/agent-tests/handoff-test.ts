/**
 * Agent handoff logic tests (no database required).
 *
 * Run: npx tsx web/src/lib/agent-tests/handoff-test.ts
 */
import {
  normalizeHandoff,
  resolveNextAgent,
  routeMessage,
  toRoutingDecision,
} from "../../../netlify/functions/_shared/orchestrator.ts";
import type { HandoffRequest } from "../../../netlify/functions/_shared/types.ts";

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

console.log("normalizeHandoff");
{
  assert(normalizeHandoff(null) === null, "null stays null");
  assert(
    normalizeHandoff({ handoff_requested: false, target_agent: "sales" }) === null,
    "handoff_requested false is normalized away",
  );
  const valid = normalizeHandoff({
    handoff_requested: true,
    target_agent: "sales",
    reason: "pricing",
    conversation_summary: "User asked about plans",
  });
  assert(valid?.target_agent === "sales", "valid handoff preserved");
}

console.log("\nresolveNextAgent");
{
  const handoff: HandoffRequest = {
    handoff_requested: true,
    target_agent: "marketing",
    reason: "campaign",
    conversation_summary: "needs nurture content",
  };
  assert(resolveNextAgent("reception", handoff) === "marketing", "routes to requested agent");
  assert(
    resolveNextAgent("sales", { ...handoff, target_agent: "human_review" }) === "human_review",
    "human_review target honored",
  );
  assert(resolveNextAgent("sales", null) === "sales", "no handoff keeps current agent");
}

console.log("\nInbound routing defaults");
{
  const greeting = routeMessage("ws_test", "Hello there!", []);
  assert(greeting.agent === "reception", "greeting routes to reception");

  const pricing = routeMessage("ws_test", "How much does the hot desk cost?", []);
  assert(pricing.agent === "sales", "pricing routes to sales");

  const campaign = routeMessage("ws_test", "Can you create a lead magnet campaign for our webinar?", []);
  assert(campaign.agent === "marketing", "explicit campaign intent routes to marketing");

  const bareHi = routeMessage("ws_test", "Hi", []);
  assert(bareHi.agent === "reception", "bare greeting does not route to marketing");
}

console.log("\nSticky sales conversation");
{
  const followUp = routeMessage(
    "ws_test",
    "We have 8 people on the team",
    [{ role: "user", content: "pricing?" }, { role: "assistant", content: "Happy to help" }],
    { state: { active_agent: "sales" } },
  );
  assert(followUp.agent === "sales", "stays on sales during qualification follow-up");
}

console.log("\nLow-confidence fallback");
{
  const vague = routeMessage("ws_test", "hmm", []);
  const decision = toRoutingDecision(vague);
  assert(decision.selected_agent === "reception", "low-confidence defaults to reception");
  assert(decision.confidence >= 0.7, "confidence floor applied");
}

console.log("\nHuman escalation patterns");
{
  const legal = routeMessage("ws_test", "I'm contacting my lawyer about this refund dispute", []);
  assert(legal.agent === "human_review", "legal/refund dispute escalates");
}

if (failures > 0) {
  console.error(`\nhandoff-test: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nhandoff-test: all tests passed");
