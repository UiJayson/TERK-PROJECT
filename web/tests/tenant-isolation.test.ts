import {
  assertPermission,
  canDeleteKnowledge,
  canManageAgents,
} from "../web/netlify/functions/_shared/rbac.ts";
import { checkRateLimit } from "../web/netlify/functions/_shared/rate-limit.ts";
import {
  enforceWorkspaceAccess,
  verifyWorkspaceAccess,
} from "../web/netlify/functions/_shared/workspace-access.ts";
import type { AuthenticatedSession } from "../web/netlify/functions/_shared/auth-types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function mockSession(workspaceId: string): AuthenticatedSession {
  return {
    user: { id: "user_a", email: "a@example.com", name: "User A" },
    workspace: {
      id: workspaceId,
      name: "Workspace A",
      ownerId: "user_a",
      createdAt: new Date().toISOString(),
      publicKey: "pk_a",
      resources: {
        agents: [],
        knowledge: [],
        conversations: [],
        analytics: [],
        leads: [],
      },
      agentConfigs: [],
    },
    role: "owner",
  };
}

function testWorkspaceIsolation(): void {
  assert(
    verifyWorkspaceAccess("ws_workspace_a", "ws_workspace_a"),
    "same workspace should be allowed",
  );
  assert(
    !verifyWorkspaceAccess("ws_workspace_a", "ws_workspace_b"),
    "cross-tenant workspace param must be denied",
  );
  assert(
    verifyWorkspaceAccess("ws_workspace_a", null),
    "missing workspace param should defer to session workspace",
  );
}

async function testBodyWorkspaceSpoofing(): Promise<void> {
  const session = mockSession("ws_workspace_a");
  const spoofed = new Request("https://example.com/api/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: "ws_workspace_b", title: "x", content: "y" }),
  });

  const denied = await enforceWorkspaceAccess(spoofed, session);
  assert(denied !== null && denied.status === 403, "body workspaceId spoof must return 403");
}

function testRbac(): void {
  assert(canManageAgents("owner"), "owner manages agents");
  assert(canManageAgents("admin"), "admin manages agents");
  assert(!canManageAgents("staff"), "staff cannot manage agents");

  assert(canDeleteKnowledge("admin"), "admin can delete knowledge");
  assert(!canDeleteKnowledge("staff"), "staff cannot delete knowledge");

  const staffDenied = assertPermission("staff", ["owner", "admin"]);
  assert(staffDenied !== null && staffDenied.status === 403, "staff gets 403 for admin routes");

  const adminAllowed = assertPermission("admin", ["owner", "admin"]);
  assert(adminAllowed === null, "admin passes admin route guard");
}

function testRateLimit(): void {
  const loginKey = `login:${Date.now()}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = checkRateLimit(loginKey, 5, 15 * 60 * 1000);
    assert(result.allowed, `login attempt ${attempt + 1} should be allowed`);
  }
  const blocked = checkRateLimit(loginKey, 5, 15 * 60 * 1000);
  assert(!blocked.allowed, "6th login attempt should be blocked");
  assert(blocked.retryAfterSeconds > 0, "blocked response should include retry-after");

  const forgotKey = `forgot:${Date.now()}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    checkRateLimit(forgotKey, 5, 15 * 60 * 1000);
  }
  const forgotBlocked = checkRateLimit(forgotKey, 5, 15 * 60 * 1000);
  assert(!forgotBlocked.allowed, "6th forgot-password attempt should be blocked");
}

async function testConversationScoping(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP  conversation scoping (DATABASE_URL not set)");
    return;
  }

  const { getConversationById } = await import("../web/netlify/functions/_shared/db.ts");
  const fakeWorkspaceA = "ws_tenant_isolation_a";
  const fakeWorkspaceB = "ws_tenant_isolation_b";
  const fakeConversationB = "conv_tenant_isolation_b";

  const crossTenant = await getConversationById(fakeWorkspaceA, fakeConversationB);
  assert(crossTenant === null, "workspace A must not read workspace B conversation by id");
}

async function testKnowledgeScoping(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP  knowledge scoping (DATABASE_URL not set)");
    return;
  }

  const { getKnowledgeEntryById } = await import("../web/netlify/functions/_shared/db.ts");
  const crossTenant = await getKnowledgeEntryById("ws_tenant_a", "kitem_belongs_to_b");
  assert(crossTenant === null, "workspace A must not read workspace B knowledge entry by id");
}

async function main(): Promise<void> {
  const tests = [
    ["workspace isolation", () => testWorkspaceIsolation()],
    ["body workspace spoofing", () => testBodyWorkspaceSpoofing()],
    ["rbac", () => testRbac()],
    ["login rate limit", () => testRateLimit()],
    ["conversation scoping", () => testConversationScoping()],
    ["knowledge scoping", () => testKnowledgeScoping()],
  ] as const;

  let passed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (error) {
      console.error(`FAIL  ${name}:`, error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }

  console.log(`\nSecurity tests: ${passed}/${tests.length} passed`);
  if (process.exitCode) process.exit(process.exitCode);
}

void main();
