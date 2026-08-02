# AI Business OS — CTO Project Audit

**Date:** 2026-07-04  
**Role:** CTO technical audit  
**Scope:** Full repository — architecture, AI system, web app, backend, frontend  
**Constraint:** Do not redesign Reception / Sales / Marketing agents or Shared Knowledge ownership model  

---

## Executive summary

You have a **credible MVP foundation**: specialist agents, rule-based routing, workspace-scoped knowledge, auth, and a dashboard that drives the AI runtime.

You do **not** yet have a production SaaS. Storage is file/blob based, channels beyond dashboard/public chat are stubs, billing is empty, onboarding is missing, and two admin surfaces compete (legacy `/admin` vs `/app/knowledge`).

**Strategic posture:** Keep the AI architecture. Finish the owner control plane. Replace storage and harden security before scale.

**Overall readiness:** ~55–60% of a sellable MVP; ~25–30% of a production multi-tenant SaaS.

---

## System map (current)

```text
Repo root (contracts + content)
├── agents/          Agent behavior prompts (source of truth for roles)
├── shared/          Default company brain markdown + profile JSON
├── prompts/         System + routing prompts
├── platform/        Routing contract (docs)
├── knowledge/       Schema docs + empty folders
├── tools/           Tool contracts (docs only)
├── evals/           Fixtures + runner
├── docs/            Architecture + PRD + this audit
└── web/             Runnable product (Vite + Netlify Functions)
    ├── src/         Dashboard, auth, public site
    └── netlify/functions/   APIs + AI runtime
```

**Runtime path (authenticated):**

`Dashboard / Test Agent /api/chat` → `processWorkspaceMessage` → `routeMessage` + `runAgentTurn` → workspace knowledge → `runtime-store` (conversations + leads)

**Runtime path (public widget):**

`ChatWidget` → `/api/chat` (no auth) → same router/orchestrator → **bundled** knowledge (not tenant-specific)

---

## Module audits

### 1. Folder structure & documentation

| | |
| --- | --- |
| **Exists** | Clear separation of contracts (`agents/`, `shared/`, `prompts/`, `platform/`, `tools/`, `evals/`, `docs/`) vs product (`web/`). PRD and core architecture docs are strong. |
| **Incomplete** | Root `README.md` is outdated (still describes Phase 1 admin as “later”, incomplete folder map). No ops runbook (env vars, deploy, secrets). |
| **Unnecessary** | Duplicate `netlify.toml` concepts (root + `web/`). Empty `knowledge/*/.gitkeep` folders unused by runtime. |
| **Build next** | Single source README; deploy/env checklist; archive or remove unused knowledge folders. |
| **Dependencies** | Docs depend on code staying aligned with contracts. |
| **Risks** | New contributors follow README and miss the real app in `web/`. |

---

### 2. AI architecture (agents + boundaries)

| | |
| --- | --- |
| **Exists** | Reception, Sales, Marketing `agent.md` files; `agents/boundaries.md`; examples; catalog in `agents-catalog.ts` mirrors roles, models, knowledge maps. |
| **Incomplete** | Agent “Edit” only stores owner notes — cannot edit mission/tone in UI (by design, but not explained). No versioning of agent prompts. Human-review agent is a path, not a first-class employee card. |
| **Unnecessary** | None critical — examples are useful. |
| **Build next** | Keep prompts file-based; surface read-only contract in UI (done partially). Add prompt version stamp in agent API. |
| **Dependencies** | `sync-content` must run on build so functions bundle prompts. |
| **Risks** | Prompt drift if someone edits only `web/netlify/functions/_shared/content` copies. |

---

### 3. AI routing

| | |
| --- | --- |
| **Exists** | Rule-based `router.ts`; `prompts/routing.md` (docs); `platform/routing-contract.md`; sticky sales; human_review for sensitive topics; enabled-agent fallback in `ai-runtime.ts`. |
| **Incomplete** | Not LLM-classifier based (fine for MVP). No confidence threshold UI. No channel-specific adapters (WhatsApp/email/Instagram filters exist in UI only). Public chat ignores workspace agent enable flags. |
| **Unnecessary** | None. |
| **Build next** | Workspace-scoped public chat (API key / site ID). Enforce enabled agents on public path. |
| **Dependencies** | Agent enable state in `auth-store`; knowledge visibility. |
| **Risks** | Mis-routes on ambiguous messages; sales paused → silent fallback to reception (can surprise owners). |

---

### 4. Shared knowledge system

| | |
| --- | --- |
| **Exists** | Markdown brain in `shared/`; workspace items CRUD; compile-to-`shared/*.md`; document upload (PDF/DOCX/TXT); agents load via `content-loader` + workspace overrides; Knowledge Base UI. |
| **Incomplete** | No retrieval/embeddings (full files injected). No knowledge versioning/rollback. SOPs not editable in KB UI (still bundled). No multi-locale. |
| **Unnecessary** | Legacy `/admin` knowledge editor + `admin-*` APIs (duplicates dashboard KB). `workspace.profile.json` + `generate-shared` partially superseded by item store. |
| **Build next** | Deprecate `/admin`; make SOPs a KB section; optional retrieval later. |
| **Dependencies** | Blob/local file stores; auth workspace ID. |
| **Risks** | Context window bloat as knowledge grows; two write paths if admin remains. |

---

### 5. Backend (Netlify Functions)

| | |
| --- | --- |
| **Exists** | Auth (register/login/logout/me/forgot/reset); agents CRUD/test; knowledge CRUD/upload; chat; conversations; leads; analytics summary; shared runtime (`ai-runtime`, `orchestrator`, `router`, stores). |
| **Incomplete** | No Postgres; JSON/blob stores; no rate limits; no audit log API; no webhooks; no background jobs; forgot-password has no email provider (dev link only); `AUTH_SECRET` defaults in code. |
| **Unnecessary** | Parallel admin APIs once dashboard KB is canonical. |
| **Build next** | Env-required secrets; email for reset; migrate stores to Netlify DB; rate limiting on auth/chat. |
| **Dependencies** | Netlify Blobs, AI Gateway (OpenAI SDK), mammoth/pdf-parse. |
| **Risks** | Data loss/race conditions on concurrent writes; not horizontally safe; secret leakage if defaults ship. |

---

### 6. Auth & multi-tenancy

| | |
| --- | --- |
| **Exists** | Register creates user + workspace; JWT + cookie; protected routes; workspace-scoped knowledge/runtime; agent configs per workspace. |
| **Incomplete** | Single workspace per user; no team invites/roles; no session revocation list; password reset email; no MFA. |
| **Unnecessary** | None. |
| **Build next** | Team roles (PRD); force `AUTH_SECRET` in production; email reset. |
| **Dependencies** | `auth-store`, frontend `AuthContext`. |
| **Risks** | Account takeover if weak secrets; no abuse controls on register. |

---

### 7. Frontend — dashboard (owner app)

| | |
| --- | --- |
| **Exists** | Shell (sidebar/topnav); Home; My Agents; Knowledge; Conversations; Leads; Analytics (partially live); auth pages; UX polish (loading/error/empty). |
| **Incomplete** | **Settings** and **Billing** and **Integrations** are placeholders. No onboarding wizard. No human-review queue action. Conversation/lead detail is read-only (no owner reply). |
| **Unnecessary** | Placeholder data modules still present (`data/conversations.ts` fixtures, `data/leads.ts` fixtures, analytics trend templates) — partially unused. |
| **Build next** | Settings (profile/workspace); Integrations (chat embed); retire placeholders; onboarding. |
| **Dependencies** | APIs under `/api/*`. |
| **Risks** | Owners hit dead-end pages (Billing/Integrations) and lose trust. |

---

### 8. Frontend — public site & legacy admin

| | |
| --- | --- |
| **Exists** | Marketing-ish `HomePage` + `ChatWidget`; legacy `AdminPage` (token `dev-admin-change-me`). |
| **Incomplete** | Public chat not tenant-bound. Landing is sample Harbor Workspace, not product marketing for AI Business OS. |
| **Unnecessary** | **Legacy admin** competes with `/app/knowledge`. |
| **Build next** | Redirect `/admin` → `/app/knowledge`; product landing; embeddable widget with workspace key. |
| **Dependencies** | Auth for dashboard; public chat API. |
| **Risks** | Confusion and divergent knowledge edits. |

---

### 9. Conversations & leads runtime

| | |
| --- | --- |
| **Exists** | Persist on agent test / authenticated chat; list APIs; CRM-style UIs; lead scoring heuristic; sentiment heuristic. |
| **Incomplete** | No owner reply / takeover; no mark-read; no assignment; lead fields not fully editable; no CRM export integrations. |
| **Unnecessary** | Static placeholder conversation/lead datasets (legacy). |
| **Build next** | Owner reply path; mark conversation read; edit lead status in UI. |
| **Dependencies** | `runtime-store`, `ai-runtime`. |
| **Risks** | Heuristic leads may be noisy; no PII retention policy. |

---

### 10. Analytics

| | |
| --- | --- |
| **Exists** | Live KPIs from runtime summary; charts for agent mix / top questions; some template charts (monthly/channel). |
| **Incomplete** | Monthly activity and channel mix not fully live; no date range picker; no export. |
| **Unnecessary** | Hard-coded trend templates if presented as live (currently labeled partially). |
| **Build next** | Derive monthly series from conversation timestamps; honest empty charts. |
| **Dependencies** | `runtime-store.getAnalyticsSummary`. |
| **Risks** | Misleading metrics if templates look “real”. |

---

### 11. Tools & channels

| | |
| --- | --- |
| **Exists** | `tools/README.md` contracts; tool-access matrix for evals; channel labels in UI. |
| **Incomplete** | No CRM/calendar/email/WhatsApp/Instagram adapters. Integrations page empty. |
| **Unnecessary** | None — contracts are forward-looking. |
| **Build next** | Website chat embed as first integration; then email. |
| **Dependencies** | Provider accounts, secrets, webhooks. |
| **Risks** | Scope creep if all channels start at once. |

---

### 12. Evals & quality

| | |
| --- | --- |
| **Exists** | 14 YAML fixtures; `evals/run.ts`; passes against router/demo/tool matrix. |
| **Incomplete** | Not in CI; does not hit live LLM; incomplete coverage of handoff/runtime-store. |
| **Unnecessary** | None. |
| **Build next** | `npm run eval` in CI; add runtime integration tests. |
| **Dependencies** | Root `tsx`/`yaml`. |
| **Risks** | Regressions ship unnoticed. |

---

### 13. Deploy & operations

| | |
| --- | --- |
| **Exists** | Netlify deploy config; site previously deployed; AI Gateway works in prod when configured. |
| **Incomplete** | No required env validation; no monitoring/alerts; no backup story for blob/json stores. |
| **Unnecessary** | None. |
| **Build next** | Fail boot if `AUTH_SECRET` missing in production; health endpoint. |
| **Dependencies** | Netlify account, AI Gateway enablement. |
| **Risks** | Silent insecure defaults; data not portable. |

---

## Cross-cutting risks (priority order)

1. **Insecure defaults** (`AUTH_SECRET`, `ADMIN_TOKEN`) if production misconfigured.  
2. **File/blob storage** — not durable multi-instance SaaS storage.  
3. **Dual admin surfaces** — knowledge divergence.  
4. **Public chat not multi-tenant** — cannot sell embed per customer yet.  
5. **No email** — password reset incomplete for real users.  
6. **No payments** — cannot monetize (intentional so far).  
7. **Context injection of full knowledge files** — cost/latency as content grows.  

---

## Phased roadmap to production SaaS

### Phase 0 — Stabilize current MVP (1–2 weeks) ← **do now**

- Canonical owner app = `/app/*` only.  
- Settings: profile + workspace name.  
- Integrations: website chat install instructions + authenticated test path.  
- Remove/redirect legacy `/admin`.  
- Update README; document env vars.  
- Production: require `AUTH_SECRET`; disable default admin token.  

**Exit criteria:** Owner can register → edit knowledge → enable agents → test → see conversations/leads/analytics without dead-end pages.

### Phase 1 — Sellable single-player MVP (2–4 weeks)

- Onboarding wizard (company → knowledge seed → activate Reception → install chat).  
- Workspace-scoped public widget (`?workspace=` or site key).  
- Owner reply / human takeover in Conversations.  
- Lead status edit.  
- Email for password reset.  
- CI: build + evals.  

**Exit criteria:** First paying pilot can embed chat on their site and manage it from dashboard.

### Phase 2 — Multi-tenant hardens (4–6 weeks)

- Migrate auth/knowledge/runtime to **Netlify DB (Postgres)** + migrations.  
- Proper blob storage for documents only.  
- Rate limits, audit log, basic admin metrics.  
- Team invites (Owner/Admin/Staff).  
- Billing (Stripe) — Starter/Growth plans.  

**Exit criteria:** Multiple workspaces, safe concurrent use, subscriptions.

### Phase 3 — Channels & tools (6–10 weeks)

- Email channel adapter.  
- WhatsApp (template/window rules).  
- Calendar booking tool for Reception.  
- CRM sync (HubSpot/Salesforce lite).  

**Exit criteria:** Multi-channel inbox with tool actions under agent boundaries.

### Phase 4 — Intelligence & scale

- Knowledge retrieval (chunking/embeddings) instead of full-file inject.  
- LLM-assisted routing with rule fallback.  
- Eval harness against live models in staging.  
- Observability (traces per turn: route, knowledge IDs, tokens, cost).  

---

## Recommended “build next” sequence (immediate)

1. Settings page (real)  
2. Integrations page (website chat embed)  
3. Redirect `/admin` → `/app/knowledge`  
4. README + env documentation  
5. Production secret enforcement  

Everything else stays on the roadmap above.

---

## Decision log (CTO)

| Decision | Choice | Why |
| --- | --- | --- |
| AI architecture | Keep | Working, differentiated, already wired |
| Knowledge model | Keep compile-to-markdown | Agents already consume it |
| Storage | Plan migrate to Postgres | Current stores are MVP-only |
| Legacy admin | Remove from product path | Duplicates dashboard KB |
| Channels | Website first | Fastest path to value |
| Billing | Phase 2 | Auth/product loop first |
