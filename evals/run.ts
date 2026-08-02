import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { routeMessage } from "../web/netlify/functions/_shared/router.ts";
import { runAgentTurn } from "../web/netlify/functions/_shared/orchestrator.ts";
import { checkToolAccess } from "../web/netlify/functions/_shared/tool-access.ts";
import type { AgentRole, Intent } from "../web/netlify/functions/_shared/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

interface EvalFixture {
  id: string;
  category: string;
  description: string;
  input: {
    workspace_id?: string;
    channel?: string;
    active_agent?: AgentRole;
    message: { text: string };
    channel_context?: { page_url?: string };
    tool_request?: { tool: string };
  };
  expected: {
    selected_agent?: AgentRole;
    primary_intent?: Intent | Intent[];
    handoff_requested?: boolean;
    target_agent?: AgentRole;
    tool_status?: string;
    forbidden_tools?: string[];
    required_tools?: string[];
    response_requirements?: string[];
    forbidden_behaviors?: string[];
  };
}

interface EvalResult {
  id: string;
  category: string;
  passed: boolean;
  failures: string[];
}

function loadFixtures(): EvalFixture[] {
  const fixtures: EvalFixture[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".yaml")) {
        fixtures.push(parse(fs.readFileSync(fullPath, "utf8")) as EvalFixture);
      }
    }
  }

  walk(fixturesDir);
  return fixtures;
}

function matchesIntent(actual: Intent, expected: Intent | Intent[]): boolean {
  const options = Array.isArray(expected) ? expected : [expected];
  return options.includes(actual);
}

function checkResponseRequirements(
  text: string,
  requirements: string[] = [],
): string[] {
  const failures: string[] = [];
  const lower = text.toLowerCase();

  for (const requirement of requirements) {
    switch (requirement) {
      case "asks_for_booking_details":
        if (!/\b(date|day|time|email|phone)\b/.test(lower)) {
          failures.push("Expected booking detail question");
        }
        break;
      case "does_not_quote_pricing":
        if (/\£\d+/.test(text)) {
          failures.push("Should not quote pricing");
        }
        break;
      case "asks_clarifying_question":
        if (!/\?/.test(text)) {
          failures.push("Expected clarifying question");
        }
        break;
      case "does_not_assume_sales_intent":
        if (/\b(package|quote|buy now)\b/.test(lower)) {
          failures.push("Should not assume sales intent");
        }
        break;
      case "discusses_product_fit":
        if (!/\b(team|plan|desk|office|fit)\b/.test(lower)) {
          failures.push("Expected product fit discussion");
        }
        break;
      case "does_not_invent_pricing":
        if (/\b(starter plan|£49)\b/i.test(text)) {
          failures.push("Should not invent unsupported pricing");
        }
        break;
      case "does_not_pitch":
      case "does_not_negotiate":
        if (/\b(you should buy|best deal|limited time|discount)\b/.test(lower)) {
          failures.push(`Forbidden behavior: ${requirement}`);
        }
        break;
      case "does_not_invent_quote":
      case "quotes_custom_price":
        if (/\£\d+/.test(text) && /\b(enterprise|custom)\b/.test(lower)) {
          failures.push("Should not invent custom quote");
        }
        break;
      case "requests_handoff_or_collects_context":
        if (!/\b(sales|connect|hand off|help you)\b/.test(lower)) {
          failures.push("Expected handoff or context collection");
        }
        break;
      case "requests_handoff_to_sales":
        if (!/\bsales\b/.test(lower)) {
          failures.push("Expected Sales handoff language");
        }
        break;
      case "does_not_book_appointment":
        if (/\b(confirmed|booked your|scheduled for)\b/.test(lower)) {
          failures.push("Should not book appointment directly");
        }
        break;
      case "acknowledges_quote_request":
        if (!/\b(quote|proposal|pricing|plan)\b/.test(lower)) {
          failures.push("Expected quote acknowledgment");
        }
        break;
      case "does_not_invent_terms":
        if (/\b(guarantee|free month|50% off)\b/.test(lower)) {
          failures.push("Should not invent terms");
        }
        break;
      case "matches_approved_price":
        if (!/\£199/.test(text)) {
          failures.push("Expected approved Hot Desk price");
        }
        break;
      case "includes_constraints":
        if (!/\b(vat|excl)\b/i.test(text)) {
          failures.push("Expected pricing constraints");
        }
        break;
      default:
        break;
    }
  }

  return failures;
}

async function runFixture(fixture: EvalFixture): Promise<EvalResult> {
  const failures: string[] = [];
  const text = fixture.input.message.text;
  const pageUrl = fixture.input.channel_context?.page_url;

  if (fixture.category === "routing_accuracy") {
    const decision = routeMessage(text, {
      pageUrl,
      state: fixture.input.active_agent
        ? { active_agent: fixture.input.active_agent, last_intent: "unknown" }
        : undefined,
    });

    if (fixture.expected.selected_agent && decision.selected_agent !== fixture.expected.selected_agent) {
      failures.push(
        `Expected agent ${fixture.expected.selected_agent}, got ${decision.selected_agent}`,
      );
    }

    if (
      fixture.expected.primary_intent &&
      !matchesIntent(decision.primary_intent, fixture.expected.primary_intent)
    ) {
      failures.push(
        `Expected intent ${JSON.stringify(fixture.expected.primary_intent)}, got ${decision.primary_intent}`,
      );
    }

    if (fixture.expected.forbidden_tools?.length) {
      for (const tool of fixture.expected.forbidden_tools) {
        const agent = decision.selected_agent;
        if (agent !== "human_review" && checkToolAccess(agent, tool) === "allowed") {
          failures.push(`Forbidden tool ${tool} was allowed for ${agent}`);
        }
      }
    }

    const routing = routeMessage(text, { pageUrl });
    const agent = routing.selected_agent === "human_review" ? "reception" : routing.selected_agent;
    const { result } = await runAgentTurn({
      agent,
      routing,
      history: [],
      userMessage: text,
    });

    failures.push(...checkResponseRequirements(result.response, fixture.expected.response_requirements));
  }

  if (fixture.category === "agent_boundary") {
    const activeAgent = fixture.input.active_agent ?? "reception";

    if (fixture.input.tool_request) {
      const status = checkToolAccess(activeAgent, fixture.input.tool_request.tool);
      if (fixture.expected.tool_status && status !== fixture.expected.tool_status) {
        failures.push(`Expected tool status ${fixture.expected.tool_status}, got ${status}`);
      }
    } else {
      const routing = routeMessage(text, {
        state: { active_agent: activeAgent, last_intent: "unknown" },
      });
      const { result } = await runAgentTurn({
        agent: activeAgent,
        routing: { ...routing, selected_agent: activeAgent },
        history: [],
        userMessage: text,
      });

      if (fixture.expected.handoff_requested) {
        if (!result.handoff_request?.handoff_requested) {
          failures.push("Expected handoff request");
        } else if (
          fixture.expected.target_agent &&
          result.handoff_request.target_agent !== fixture.expected.target_agent
        ) {
          failures.push(
            `Expected handoff to ${fixture.expected.target_agent}, got ${result.handoff_request.target_agent}`,
          );
        }
      }

      failures.push(...checkResponseRequirements(result.response, fixture.expected.response_requirements));
    }
  }

  if (fixture.category === "knowledge_consistency") {
    const activeAgent = fixture.input.active_agent ?? "reception";
    const routing = routeMessage(text, {
      state: { active_agent: activeAgent, last_intent: "unknown" },
    });
    const { result } = await runAgentTurn({
      agent: activeAgent,
      routing: { ...routing, selected_agent: activeAgent },
      history: [],
      userMessage: text,
    });

    if (fixture.expected.handoff_requested) {
      if (!result.handoff_request?.handoff_requested) {
        failures.push("Expected handoff for unapproved knowledge case");
      } else if (
        fixture.expected.target_agent &&
        result.handoff_request.target_agent !== fixture.expected.target_agent
      ) {
        failures.push(`Expected handoff to ${fixture.expected.target_agent}`);
      }
    }

    failures.push(...checkResponseRequirements(result.response, fixture.expected.response_requirements));
  }

  return {
    id: fixture.id,
    category: fixture.category,
    passed: failures.length === 0,
    failures,
  };
}

async function main() {
  const fixtures = loadFixtures();
  const results: EvalResult[] = [];

  for (const fixture of fixtures) {
    results.push(await runFixture(fixture));
  }

  const passed = results.filter((result) => result.passed).length;
  const failed = results.filter((result) => !result.passed);

  console.log(`\nEval results: ${passed}/${results.length} passed\n`);

  for (const result of results) {
    const icon = result.passed ? "PASS" : "FAIL";
    console.log(`${icon}  ${result.id} (${result.category})`);
    for (const failure of result.failures) {
      console.log(`      - ${failure}`);
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();
