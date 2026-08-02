/**
 * Memory & context-retention tests (no database required).
 *
 * Covers: customer identity resolution (threading), session isolation between
 * workspaces/channels, prompt formatting of memory (returning customers,
 * summaries, "what did I just say?" material), and history conversion.
 *
 * Run: npx tsx web/src/lib/agent-tests/memory-test.ts
 */
import {
  formatMemoryForPrompt,
  memoryToChatHistory,
  resolveCustomerId,
  resolveSessionId,
  type MemoryContext,
  type RecentMessage,
} from "../../../netlify/functions/_shared/memory.ts";

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

function makeContext(overrides: Partial<MemoryContext> = {}): MemoryContext {
  return {
    customerId: "ws_a:phone:447700900000",
    sessionId: "whatsapp:ws_a:phone:447700900000",
    profile: {
      id: "ws_a:phone:447700900000",
      workspaceId: "ws_a",
      phone: "447700900000",
      email: null,
      name: null,
      preferences: {},
      tags: [],
      leadScore: 0,
      leadData: {},
      lastSummary: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    summary: "",
    recentMessages: [],
    totalMessageCount: 0,
    useSummaryOnly: false,
    ...overrides,
  };
}

console.log("Threading: customer identity resolution");
{
  const a = resolveCustomerId({
    workspaceId: "ws_a",
    channel: "whatsapp",
    collectedFields: { phone: "+44 7700 900000" },
  });
  const b = resolveCustomerId({
    workspaceId: "ws_b",
    channel: "whatsapp",
    collectedFields: { phone: "+44 7700 900000" },
  });
  assert(a === "ws_a:phone:447700900000", "phone id is normalized (digits only)");
  assert(a !== b, "same phone in different workspaces yields different customers");

  const emailUpper = resolveCustomerId({
    workspaceId: "ws_a",
    channel: "website",
    collectedFields: { email: "Jane@Example.com" },
  });
  const emailLower = resolveCustomerId({
    workspaceId: "ws_a",
    channel: "website",
    collectedFields: { email: "jane@example.com" },
  });
  assert(emailUpper === emailLower, "email identity is case-insensitive");

  const anonymous = resolveCustomerId({ workspaceId: "ws_a", channel: "website" });
  assert(anonymous === null, "no identifying fields → null (memory deferred to conversation id)");

  const byConversation = resolveCustomerId({
    workspaceId: "ws_a",
    channel: "website",
    conversationId: "conv_123",
  });
  assert(byConversation === "ws_a:conv:conv_123", "conversation id used as fallback identity");

  assert(
    resolveCustomerId({
      workspaceId: "ws_a",
      channel: "instagram",
      collectedFields: { instagram_id: "ig_42", email: "jane@example.com" },
    }) === "ws_a:ig:ig_42",
    "instagram id wins over email (stable channel identity first)",
  );
}

console.log("\nThreading: session ids");
{
  const s1 = resolveSessionId({ channel: "whatsapp", customerId: "ws_a:phone:1" });
  const s2 = resolveSessionId({ channel: "website", customerId: "ws_a:phone:1" });
  assert(s1 !== s2, "different channels produce different default sessions");
  assert(
    resolveSessionId({ channel: "website", customerId: "c", conversationId: "conv_9" }) ===
      "conv_9",
    "explicit conversation id takes precedence",
  );
}

console.log("\nPrompt formatting: new vs returning customers");
{
  const fresh = formatMemoryForPrompt(makeContext(), "website");
  assert(fresh.includes("Returning customer: no"), "fresh context marked as new customer");

  const returning = formatMemoryForPrompt(
    makeContext({
      profile: { ...makeContext().profile, name: "Sarah" },
      totalMessageCount: 6,
      recentMessages: [
        { role: "user", content: "I asked about hot desks", timestamp: "", agentType: null },
        { role: "assistant", content: "Hot Desk is £199/month", timestamp: "", agentType: "sales" },
      ],
    }),
    "whatsapp",
  );
  assert(returning.includes("Returning customer: yes"), "history marks customer as returning");
  assert(returning.includes('Greet returning customer by name: "Sarah"'), "greets by name");
  assert(
    returning.includes("I asked about hot desks"),
    "recent transcript present — supports 'what did I just say?'",
  );
  assert(returning.includes("[sales]"), "assistant turns attributed to the agent that sent them");
  assert(returning.includes("Channel: whatsapp"), "channel included for formatting rules");
}

console.log("\nPrompt formatting: long-history summary");
{
  const long = formatMemoryForPrompt(
    makeContext({
      summary: "Customer runs a 12-person agency; wants a private office in Q3.",
      totalMessageCount: 80,
      useSummaryOnly: true,
      recentMessages: [
        { role: "user", content: "so what did we decide?", timestamp: "", agentType: null },
      ],
    }),
    "website",
  );
  assert(long.includes("Earlier conversation summary:"), "summary block present");
  assert(long.includes("12-person agency"), "summary content injected");
  assert(
    long.includes("so what did we decide?"),
    "recent turns retained even past the history limit (regression: they used to be dropped)",
  );
}

console.log("\nHistory conversion");
{
  const messages: RecentMessage[] = [
    { role: "user", content: "hi", timestamp: "", agentType: null },
    { role: "system", content: "reception handed off to sales", timestamp: "", agentType: null },
    { role: "assistant", content: "hello!", timestamp: "", agentType: "reception" },
  ];
  const history = memoryToChatHistory(messages);
  assert(history.length === 2, "system/handoff markers excluded from model history");
  assert(
    history[0].role === "user" && history[1].role === "assistant",
    "roles preserved in order",
  );
}

if (failures > 0) {
  console.error(`\nmemory-test: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nmemory-test: all tests passed");
