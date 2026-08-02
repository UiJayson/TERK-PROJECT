# Module Reference

What every directory and backend module does, in one place. Companion to [core-architecture.md](core-architecture.md) (the *why*); this is the *what/where*.

## Top-level directories

| Directory | Purpose | Owner rules |
| --- | --- | --- |
| `agents/` | One folder per agent (`reception`, `sales`, `marketing`) containing `agent.md` — the behavior prompt. **Source of truth for agent behavior.** | Behavior only. No business facts, no pricing, no company data. |
| `shared/` | Default shared knowledge markdown + business profile seed. Compiled into the function bundle at build time. | Facts only. Regenerate with `npm run generate:shared`. |
| `prompts/` | System prompt + routing prompt templates. | Changes here require re-running `npm run eval`. |
| `platform/` | Routing contract documentation (not runtime code). | Docs only. |
| `knowledge/` | Knowledge model documentation. | Docs only. |
| `tools/` | Tool contract docs (CRM, calendar, email, analytics, messaging). | Docs only. |
| `evals/` | Fixtures + runner for agent behavior evals (`npm run eval`, `tsx evals/run.ts`). | Add a fixture whenever a routing bug is fixed. |
| `tests/` | Cross-cutting suites: `security`, `tenant-isolation`, `logger-redaction`, `performance` (`npm run test:all`). | Must pass before any merge. |
| `scripts/` | Build + ops scripts (see table below). | |
| `supabase/migrations/` | Numbered idempotent SQL migrations. | Never edit an applied file; add the next number. |
| `docs/` | All project documentation. | |
| `web/` | The product — frontend + backend. | |

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/generate-shared.mjs` | Regenerates `shared/*.md` from the profile JSON |
| `scripts/load-test.mjs` | GET-only load test, prints p50/p95/p99 (`npm run loadtest`) |
| `scripts/migrate-local-to-supabase.ts` | One-time import of legacy local JSON data into Postgres |
| `scripts/sync-netlify-env.mjs` | Pushes `.env` values to the linked Netlify site |
| `scripts/health-check.mjs` | Post-deploy smoke check (homepage, functions, DB, auth) — used by CI |
| `scripts/backup-database.mjs` | Timestamped `pg_dump` backup with retention pruning |
| `scripts/export-workspace-data.mjs` | Full JSON export of one workspace (GDPR / customer offboarding) |
| `scripts/check-bundle-size.mjs` | Fails CI when `web/dist` exceeds the size budget |
| `web/scripts/sync-content.mjs` | Copies `agents/`, `shared/`, `prompts/` into the function bundle before build/dev |

## Frontend (`web/src/`)

| Path | Purpose |
| --- | --- |
| `pages/HomePage.tsx` | Public marketing/demo site |
| `pages/EmbedPage.tsx` | The embeddable chat widget (`/embed/:publicKey`) — must stay frameable |
| `pages/auth/` | Login, Register, Forgot/Reset password |
| `pages/dashboard/` | One file per app page (Agents, Knowledge, Conversations, Leads, Analytics, Channels, Integrations, Settings, Billing, SystemHealth, AdminHealth) |
| `components/` | Shared UI, plus per-feature folders (agents, auth, conversations, knowledge, layout) |
| `api/` | Typed fetch wrappers for every backend endpoint |
| `auth/` | Session context/provider, token storage |
| `dev/mockApi.ts` | Dev-only mock API (preview mode); guarded by `import.meta.env.DEV` |
| `styles/tokens.css` | **Single design-token source** — blue `#2563EB` sole accent; `--dash-*` aliases map here and must not be defined elsewhere |
| `config/`, `data/`, `lib/` | Route config, static data, small utilities |

## Backend endpoints (`web/netlify/functions/*.ts`)

One file per endpoint; each exports `config.path` and `withObservability(handler)`. Full request/response contract: [API.md](../API.md). Groups:

- **Auth:** `auth-register/login/logout/me/forgot-password/reset-password`
- **Product:** `agents`, `agents-test`, `chat`, `knowledge`, `knowledge-upload`, `conversations`, `leads`, `analytics-summary`, `settings`, `notifications`, `channels`
- **Growth:** `billing*` (Stripe + Paystack), `marketing`, `bi`, `workflows`
- **Webhooks:** `whatsapp-webhook`, `instagram-webhook` (+ `api/instagram/webhook.ts`), `api/billing/webhook` (Stripe)
- **Ops:** `health`, `db-test`, `ai-test`, `observability-health`
- **Scheduled:** `appointment-reminders`, `observability-alerts`, `scheduled/{health-check, event-bus-processor, bi-competitor, bi-weekly-report}`

> Note: billing has legacy duplicates (`billing-subscribe.ts`, `api/billing/subscribe.ts`, and `billing.ts` all declare `/api/billing/subscribe`; Paystack also lives under `billing/{initialize,verify,webhook}.ts`). `billing.ts` is the canonical handler; consolidation is tracked in [project-audit.md](project-audit.md).

## Backend core (`web/netlify/functions/_shared/`)

### Platform: auth, isolation, HTTP

| Module | Purpose |
| --- | --- |
| `auth-http.ts` | `requireAuth`, `requireAuthWithWorkspaceAccess`, `withRole`, JSON/CORS response helpers |
| `auth-crypto.ts` | JWT create/verify (24 h HS256), bcrypt hashing, session cookie, reset tokens |
| `auth-store.ts` | User/workspace persistence |
| `auth-types.ts` | Session/user/workspace types |
| `workspace-access.ts` / `require-workspace-isolation.ts` | Tenant-isolation enforcement — every data access filters by session workspace |
| `rbac.ts` | Role model (owner/admin/staff) |
| `admin-auth.ts` | Legacy `ADMIN_TOKEN` bearer check for `/api/admin/*` |
| `rate-limit.ts` | In-memory per-IP fixed-window limiter + client IP extraction |
| `sanitize.ts` / `upload-validation.ts` | Input sanitization; upload magic-byte/size/content scanning |
| `secret-crypto.ts` | Encryption for stored channel credentials |
| `config.ts` | Env-var access + validation + `getServiceHealth()` |

### AI runtime

| Module | Purpose |
| --- | --- |
| `ai-runtime.ts` | `processWorkspaceMessage` — the one entry point for every chat turn (router → agent → knowledge → persistence) |
| `router.ts` / `intent-detector.ts` | Selects the agent + intent for a message |
| `orchestrator.ts` | Runs agent turns, resolves handoffs between agents |
| `ai-engine.ts` | Model calls with 1 h response cache (keyed on full request hash) |
| `ai-providers/` | Anthropic / OpenAI / Netlify-gateway adapters, prompt formatting, pricing tables |
| `circuit-breaker.ts` | Per-provider circuit breaker + 8-way concurrency limiter |
| `sales-agent.ts` / `marketing-agent.ts` / `bi-agent.ts` | Role-specific logic (lead qualification, campaign generation, competitor analysis) |
| `agents-catalog.ts` | Static definitions of the three agents |
| `response-delay.ts` | Human-feel typing delay for channel replies |
| `escalation.ts` / `lead-capture.ts` / `lead-qualification.ts` | Human-handoff detection; automatic lead extraction from chats |

### Knowledge

| Module | Purpose |
| --- | --- |
| `knowledge.ts` | Retrieval (keyword + semantic) used by agents |
| `knowledge-store.ts` / `knowledge-items-store.ts` | Core shared files / structured items persistence |
| `embeddings.ts` | Embedding generation (OpenAI) |
| `document-extract.ts` | PDF/DOCX/TXT text extraction (pdf-parse, mammoth) |
| `content-bundle.ts` / `content-loader.ts` | Build-time-bundled default content access |
| `profile-generator.ts` | Generates shared knowledge from a business profile |

### Data layer

| Module | Purpose |
| --- | --- |
| `db-client.ts` | postgres.js client (pooler-safe, `prepare:false`) + logging proxy. **Template literals execute eagerly — no query fragments** |
| `db.ts` | All SQL queries (explicit branches per filter combination) |
| `db-errors.ts` | Error normalization |
| `runtime-store.ts` | Conversations/leads/analytics aggregation used by the dashboard APIs |
| `memory.ts` | Conversation memory persistence |
| `cache.ts` | `TtlCache`, `getOrCompute` dedup, `invalidateWorkspaceCaches` — **writes must invalidate** |
| `http-cache.ts` | ETag/304 + `Cache-Control: private` response wrapper |

### Channels & integrations

| Module | Purpose |
| --- | --- |
| `whatsapp.ts` / `whatsapp-sender.ts` | Meta Graph API: signature verification, send text/typing/read receipts |
| `instagram-sender.ts` | Instagram DM sending |
| `channels-store.ts` | Channel credentials (encrypted), sessions, webhook logs |
| `email.ts` | Resend transport (console fallback), email templates |
| `stripe-billing.ts` / `paystack-billing.ts` / `billing-plans.ts` / `billing-gate.ts` / `billing-subscribe-handler.ts` | Billing providers, plan definitions, usage enforcement |
| `usage-limits.ts` | Per-plan message/agent limit checks + usage snapshots |
| `crm-sync.ts` | Lead push to HubSpot/Salesforce/Zoho/webhook |
| `calendar.ts` | Appointment booking primitives |
| `robots-check.ts` | robots.txt compliance for scrapers |

### Async & observability

| Module | Purpose |
| --- | --- |
| `event-bus.ts` | Persistent event queue drained by the scheduled processor (workflow triggers, notifications) |
| `workflow-engine.ts` | Workflow definitions, prebuilt seeds, execution |
| `observability.ts` | `withObservability` wrapper — request logging, timing, error capture, per-workspace context |
| `logger.ts` / `redact.ts` | Structured event logging with secret/PII redaction (tested) |
| `alerts.ts` | Threshold alerts → `ADMIN_ALERT_EMAIL` |
| `sentry.ts` | Sentry integration (optional) |
| `notifications.ts` / `notification-preferences.ts` | In-app notification feed + user preferences |
