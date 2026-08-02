# Multi-Tenant Data Isolation Audit — Harbor AI

**Date:** 2026-07-11
**Scope:** Every database query, API route, serverless function, AI/RAG path, and real-time surface in `web/netlify/functions/**` and `web/src/**`, checked for `workspace_id` scoping and cross-tenant leakage.
**Method:** Read all 130+ query call sites in `db.ts`, `memory.ts`, `embeddings.ts`, `products.ts`, `knowledge.ts`; every route handler's auth path; the public chat/embed path; admin endpoints.
**Status legend:** ✅ FIXED (this pass) · ⚠️ OPEN (documented) · ✔️ verified clean

---

## Executive summary

Tenant isolation in Harbor AI is **strong and consistent**. Every tenant-scoped query in the data layer filters on `workspace_id`, and every mutating query additionally calls `set_config('app.workspace_id', …)` for defence-in-depth (a Postgres RLS hook). API routes derive the workspace from the **authenticated session** (`auth.workspace.id`), never from client-supplied parameters, and a shared guard (`enforceWorkspaceAccess` / `requireWorkspaceIsolation`) rejects any request whose body/URL `workspace_id` disagrees with the session (403).

The audit found **one real cross-tenant leak** — a platform-wide revenue aggregate returned on a per-workspace endpoint — now fixed. No unscoped tenant queries and no IDOR vectors were found.

| Severity | Found | Fixed | Open |
| --- | --- | --- | --- |
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 1 | 1 | 0 |
| Low | 2 | 0 | 2 (documented) |

**Queries audited:** ~135 tenant-relevant statements across 5 modules. **Unscoped tenant queries remaining: 0.**

---

## Architecture (how isolation is enforced)

1. **Session is the source of truth.** `optionalAuth`/`requireAuth` (`_shared/auth-http.ts`) verify the JWT, re-load the user + workspace, confirm `user.workspaceIds.includes(workspace.id)`, and re-check `sessionVersion` and role on every request. Handlers read `auth.workspace.id` — clients cannot pass a workspace id.
2. **Two-layer request guard.** `requireAuthWithWorkspaceAccess` → `enforceWorkspaceAccess` compares any `workspaceId`/`workspace_id` in the URL or JSON body against the session and returns **403** on mismatch (`workspace-access.ts`, `require-workspace-isolation.ts`). Verified by `tests/tenant-isolation.test.ts` ("body workspace spoofing").
3. **Every data-layer query is scoped.** All reads/writes in `db.ts` take `workspaceId` as a parameter and include `WHERE workspace_id = ${workspaceId}`. JOINs enforce the tenant on the parent row (e.g. `getConversationMessagesPage` joins `messages → conversations` and filters `c.workspace_id`; `getBIMetrics`/`getTopCustomerTopics` do the same for message aggregates).
4. **RLS hook.** Mutations and sensitive reads call `set_config('app.workspace_id', …, true)` so a future Postgres RLS policy tightens the net even if an app-layer filter is ever missed.

---

## MEDIUM

### T1. Platform-wide MRR leaked to every workspace — ✅ FIXED
- **File:** `web/netlify/functions/_shared/runtime-store.ts` (`getAnalyticsSummary`), surfaced via `GET /api/analytics/summary`.
- **Problem:** the per-workspace analytics summary returned `platformMrrUsd: (await db.getPlatformMrrCents()) / 100`. `getPlatformMrrCents()` sums subscription revenue across **all tenants** (`SELECT plan, COUNT(*) FROM workspaces WHERE subscription_status IN (...)`). Any authenticated workspace could read the platform's total recurring revenue — a cross-tenant business-metric leak. It was already wired into the client type (`web/src/api/runtime.ts`) though not yet rendered, so it was live in the API response.
- **Fix:** removed `platformMrrUsd` from `getAnalyticsSummary` and from the client `AnalyticsSummary` type. Platform operators still get MRR through the admin-token-gated `getAdminHealthDashboard` (`/api/admin/health`). Typecheck clean; analytics tests unaffected.

---

## LOW

### T2. Admin "Company Brain" tools are bound to the default workspace only — ⚠️ OPEN (by design)
`admin-knowledge.ts` / `admin-profile.ts` operate on `getConfig().auth.defaultWorkspaceId` and are gated by the platform `ADMIN_TOKEN` (timing-safe, disabled in prod until set — see prior `AUDIT_REPORT.md` C1). They cannot browse arbitrary tenants, so there is **no cross-tenant escape**. Noted only because a single shared admin token (rather than per-operator identities) has no audit trail. **Recommendation:** move platform-operator auth to named accounts before onboarding more operators. No code change now.

### T3. Anonymous embed visitor could resume a same-workspace conversation by id — ⚠️ OPEN (low risk)
On the public chat path a client may pass `conversation_id`. `appendConversationTurn` loads it via `getConversationById(workspaceId, conversationId)` — **workspace-scoped**, so cross-tenant reads return null (a new conversation is created). Within the *same* workspace, a guessed id would append to another visitor's thread, but conversation ids are `randomUUID`-derived (122-bit), so enumeration is infeasible, and the endpoint never returns prior message history to the caller (only the fresh reply). **Recommendation:** if stricter isolation is wanted, bind `conversation_id` to a signed per-visitor token. Low priority.

---

## What was checked and found clean ✔️

| Area | Result |
| --- | --- |
| `db.ts` tenant reads/writes (conversations, leads, knowledge, memory, billing, marketing, BI, workflows, events, usage) | All filter `workspace_id`; verified line-by-line |
| JOIN queries (`getConversationMessagesPage`, `getBIMetrics`, `getTopCustomerTopics`) | Tenant enforced on parent (`conversations`) row |
| `findMany`-equivalents without a filter | Only platform-admin aggregates (`countWorkspaces`, `getPlatformMrrCents`, `listPendingEvents`, `listDueWorkflowExecutions`, `listSlotsNeedingReminder`) — all called from scheduled jobs / admin-gated paths, none from tenant routes |
| API routes derive workspace from session | `agents`, `analytics-summary`, `bi`, `channels`, `conversations`, `knowledge`, `knowledge-upload`, `leads`, `marketing`, `notifications`, `settings`, `workflows`, `billing`, `observability-health` — all use `auth.workspace.id` |
| IDOR on `/api/conversations/:id`, `/api/agents/:id` | Object access re-scoped to `auth.workspace.id`; cross-tenant id returns null/404 |
| Client-supplied `workspace_id` | Rejected with 403 by `enforceWorkspaceAccess` (tested) |
| RAG / Company Brain retrieval | `searchKnowledge`, `searchProducts`, `getProductById`, `searchKnowledgeSemantic` (pgvector) all filter `workspace_id`; embeddings written/queried per-workspace |
| Agent memory / multi-turn | `memory.ts` scopes every read/write; `resolveCustomerId` namespaces ids with `workspaceId` prefix |
| Agent configs | `loadAgentConfigs`, `updateAgent` scoped to `workspace_id` |
| Real-time | No WebSocket/SSE/broadcast in the app — dashboard uses per-request polling of scoped REST endpoints, so there is no cross-tenant fan-out channel |
| File uploads | `knowledge-upload.ts` stores extracted text as workspace-scoped `knowledge_items` rows (no shared object store / guessable file URLs); validated for type/size/magic-bytes/malicious content |
| Webhook → workspace resolution | WhatsApp/Instagram webhooks resolve the workspace from the channel config keyed by phone-number/business-account id, then scope all writes to it |

---

## Recommended testing strategy (regression prevention)

1. **Keep the tenant suite in CI.** `npm run test:tenant` covers `verifyWorkspaceAccess`, body-spoof 403s, RBAC, and (with `DATABASE_URL`) live cross-tenant read attempts returning null. Run it on every PR.
2. **Seed a two-tenant fixture DB** and add integration assertions: create workspace A + B, then assert every `list*`/`get*` for A never returns a B-owned row. This catches a missing filter the unit tests can't.
3. **Grep guardrail.** Add a CI check that fails if a new `db\`` template in `db.ts`/`memory.ts` reads a tenant table without `workspace_id` in the same statement (allowlist the known platform-admin aggregates).
4. **Contract test the guard.** Assert that any route wired through `requireAuthWithWorkspaceAccess` returns 403 when `?workspace_id=` or a body `workspaceId` differs from the token.
5. **Ship Postgres RLS.** The app already sets `app.workspace_id`; add matching `CREATE POLICY` per tenant table so the database enforces isolation independently of application code — the strongest regression guard.

## Success criteria — status
- ✅ Zero unscoped tenant database queries remain.
- ✅ Every tenant API route validates workspace membership before data access.
- ✅ No client can manipulate `workspace_id` to reach another tenant (403, tested).
- ✅ RAG/AI context is strictly workspace-bound.
