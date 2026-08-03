# Deployment Guide

Everything needed to take AI Business OS from a fresh clone to production, on Netlify (primary) or an alternative platform.

## Contents

1. [Local development setup](#1-local-development-setup)
2. [Environment variables](#2-environment-variables)
3. [Database: schema, migrations, seed data](#3-database)
4. [Netlify deployment (primary)](#4-netlify-deployment)
5. [Alternative platforms: Vercel, Railway, Render](#5-alternative-platforms)
6. [SSL, DNS, and custom domains](#6-ssl-dns-and-custom-domains)
7. [Post-deploy verification](#7-post-deploy-verification)
8. [Rollback](#8-rollback)

---

## 1. Local development setup

### Prerequisites

- **Node.js 20+** and npm 10+
- A **Supabase** project (free tier works) — only needed for live-data development; the UI runs without it (see *Preview mode*)

### Clone to running

```bash
git clone <repo-url> ai-business-os
cd ai-business-os

# Root deps (test runner, eval tooling)
npm install

# App deps
cd web && npm install && cd ..

# Environment
cp .env.example .env       # then fill in at minimum DATABASE_URL (see §2)

# Run the app (from repo root — proxies to web/)
npm run dev
```

Open:

- `http://localhost:5173/` — public demo site
- `http://localhost:5173/register` — create an account
- `http://localhost:5173/app` — dashboard (sign-in required)

First boot takes ~30 s while Vite bundles the Netlify functions emulation.

### Preview mode (no database)

Without `DATABASE_URL`, every `/api/*` call fails. To browse authenticated pages with mocked data, run this in the browser console and reload:

```js
localStorage.setItem("harbor:preview", "1");
localStorage.setItem("aios_token", "mock-token");
```

Implemented in `web/src/dev/mockApi.ts`; guarded by `import.meta.env.DEV`, so it cannot leak into production builds.

### Useful commands

| Command (repo root) | Purpose |
| --- | --- |
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Sync agent/knowledge content + typecheck + production build |
| `npm run test:all` | Security, tenant-isolation, logging-redaction, performance test suites |
| `npm run eval` | Agent routing/behavior evals |
| `npm run loadtest` | GET-only load test with p50/p95/p99 (`scripts/load-test.mjs`) |
| `npm run generate:shared` | Regenerate `shared/*.md` from the profile JSON |

---

## 2. Environment variables

Canonical, always-current list with inline docs: [.env.example](.env.example). Summary:

### Required

| Variable | Where to get it | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Supabase → Settings → Database | **Use the transaction pooler URL (port 6543)** — the client sets `prepare: false` for PgBouncer. Aliases accepted: `SUPABASE_DATABASE_URL`, `SUPABASE_DB_URL` |
| `AUTH_SECRET` | `openssl rand -base64 32` | JWT signing + channel-credential encryption. **Required in production**; dev falls back to a built-in value. Rotating it logs out all users and re-encrypts nothing — see rotation note below |

### AI provider (one required for live replies)

| Variable | Notes |
| --- | --- |
| `AI_PROVIDER` | `anthropic` (default) · `openai` · `netlify` |
| `ANTHROPIC_API_KEY` | Required when provider is `anthropic` |
| `OPENAI_API_KEY` | Required when provider is `openai`; also used for **embeddings** even when Anthropic is primary |
| `OPENAI_BASE_URL` | Required when provider is `netlify` (Netlify AI Gateway URL) |
| `AI_MODEL` | Optional model override |
| `AI_EMBEDDING_MODEL` | Default `text-embedding-3-small` |

Without any AI key the chat runs in **mock mode** (`"mode": "mock"` in responses) — useful for demos, useless for customers.

### Optional integrations

| Variable | Feature |
| --- | --- |
| `WHATSAPP_APP_SECRET` / `META_APP_SECRET` | WhatsApp/Instagram webhook signature verification — **required in production if channels are used** |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER/GROWTH/PRO` | Stripe billing |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_WEBHOOK_SECRET` | Paystack billing (takes precedence over Stripe when set) |
| `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` | Transactional email; unset → emails logged to console |
| `SENTRY_DSN` | Error tracking |
| `ADMIN_TOKEN` | Bearer token for legacy `/api/admin/*` |
| `ADMIN_ALERT_EMAIL` | Recipient for scheduled observability alerts |
| `DEFAULT_WORKSPACE_ID` | Workspace targeted by admin endpoints (default `default`) |
| `SITE_URL` | Public origin; on Netlify the system `URL` var covers this |

**Secret rotation:** rotating `AUTH_SECRET` invalidates all sessions (users just re-login) **and** breaks decryption of stored channel access tokens — customers must re-enter WhatsApp/Instagram tokens. Schedule rotations with an announcement.

Sync local `.env` to Netlify with `node scripts/sync-netlify-env.mjs` (requires Netlify CLI, see §4).

---

## 3. Database

### Engine

Supabase Postgres, accessed from Netlify Functions via the `postgres` npm client. No ORM. Row-Level Security is enabled on all tables as defense-in-depth (the service connection bypasses it; isolation is enforced in application code — see `_shared/require-workspace-isolation.ts` and `tests/tenant-isolation.test.ts`).

### Schema & migrations

Migrations are plain SQL files in [supabase/migrations/](supabase/migrations/), numbered and idempotent (`CREATE TABLE IF NOT EXISTS …`):

| Range | What it adds |
| --- | --- |
| 001 | Core: workspaces, users, agents, conversations, messages, leads, knowledge_items, business_profiles, channel_configs/sessions, password_resets, RLS policies |
| 002–007 | Conversation memory, knowledge embeddings, WhatsApp webhook logs, receptionist v2, AI usage logs, notifications |
| 008–010 | Auth RBAC (roles), billing tables, observability |
| 011–016 | Keyword retrieval, pending messages, product catalog, marketing orchestrator, BI/workflow events |
| 017 | Performance indexes + `messages.workspace_id` |
| 018 | Stripe webhook idempotency |
| 019 | `rate_limits` (distributed auth rate limiting) |

**Applying migrations** — use the built-in runner (`web/scripts/migrate-db.mjs`). It
applies every pending file in order, records each in a `schema_migrations` table
so it runs only once, and wraps each in a transaction (except `CREATE INDEX
CONCURRENTLY` files, which Postgres forbids in one):

```bash
DATABASE_URL="postgresql://…pooler.supabase.com:6543/postgres" npm run migrate:db --prefix web
```

- `--dry-run` prints what would run without changing anything.
- `--baseline` marks all current migrations as applied **without** running them —
  use once on a database already migrated by hand so tracking starts cleanly.

CI applies migrations automatically before each deploy when the
`STAGING_DATABASE_URL` / `PROD_DATABASE_URL` repo secrets are set (see
[.github/workflows/ci.yml](.github/workflows/ci.yml)). Falling back to the
Supabase SQL Editor or `supabase db push` still works if you prefer.

Migrations must stay idempotent so re-running the folder from scratch is safe. New migrations: next number, one concern per file, never edit an already-applied file.

### Seed data

No SQL seed is required — the app self-seeds per workspace:

- Registration creates the workspace, owner user, and default agent configs.
- `shared/` default knowledge is bundled into functions at build time (`web/scripts/sync-content.mjs`).
- Workflows auto-seed on first `GET /api/workflows`.

To seed a demo workspace, register through the UI and upload knowledge, or use `scripts/migrate-local-to-supabase.ts` to import legacy local data.

### Connection notes

- Always the **transaction pooler (port 6543)**, not the direct 5432 connection — serverless functions exhaust direct connections fast.
- The db client (`web/netlify/functions/_shared/db-client.ts`) wraps postgres.js with a logging proxy that **executes template literals eagerly** — never build query fragments (`` db`AND x = ${y}` ``); write explicit branches per filter combination.

---

## 4. Netlify deployment

The site deploys from [netlify.toml](netlify.toml) at the repo root:

| Setting | Value |
| --- | --- |
| Build command | `npm install --prefix web && npm run build --prefix web` |
| Publish directory | `web/dist` |
| Functions directory | `web/netlify/functions` |

### First-time setup

1. **Create the site** — Netlify dashboard → *Add new site*. With a Git repo connected, every push to the production branch deploys; without Git (current state), deploy manually:

   ```bash
   npm i -g netlify-cli
   netlify login
   netlify link          # or: netlify sites:create
   netlify deploy --build --prod
   ```

2. **Environment variables** — Site settings → Environment variables. Set everything from §2 (at minimum `DATABASE_URL`, `AUTH_SECRET`, one AI key). Or bulk-sync: `node scripts/sync-netlify-env.mjs`.

3. **Run migrations** against the production Supabase project (§3) **before** the first deploy that needs them.

4. **Scheduled functions** are picked up automatically from each function's `schedule:` config — verify under *Site → Functions* after the first deploy.

5. **Webhooks** — after the site has its final domain:
   - Stripe: endpoint `https://<domain>/api/billing/webhook`, copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
   - Meta (WhatsApp/Instagram): callback `https://<domain>/api/whatsapp/webhook`, verify token = value saved in Integrations; set `WHATSAPP_APP_SECRET`.

### Headers & security

`netlify.toml` sets HSTS, CSP, nosniff, and referrer policy globally. Anti-framing (`frame-ancestors 'none'`) is applied per-route on all app/auth pages while `/embed/*` explicitly allows `frame-ancestors *` so the chat widget can be iframed on customer sites. **Netlify header rules merge cumulatively — never add anti-framing headers to `/*`** or the widget breaks.

### Staging

Create a second Netlify site (e.g. `harbor-ai-staging`) pointed at the same repo with its **own Supabase project** and test-mode payment keys. The CI pipeline (see [.github/workflows/ci.yml](.github/workflows/ci.yml)) deploys `main` → staging and release tags → production using `NETLIFY_AUTH_TOKEN` + per-site IDs.

---

## 5. Alternative platforms

The frontend is a static Vite build (portable anywhere). The backend is the hard part: ~40 **Netlify Functions** using Netlify's `Config.path` routing and `schedule` cron syntax. Porting requires an adapter layer:

### Vercel

- Static build: root `web`, build `npm run build`, output `dist`.
- Functions: Netlify's `export default handler` + `config.path` does not map 1:1. Either write a catch-all `api/[...path].ts` that imports the shared `_shared/` modules and re-implements routing, or keep functions on Netlify and deploy only the frontend to Vercel (set the API origin accordingly and revisit CORS).
- Scheduled functions → `vercel.json` `crons`.

### Railway / Render

- Run a single Node server (Express/Hono) that mounts each function handler on its `config.path` — the handlers are standard `(Request) => Response`, so an adapter like `@hono/node-server` works with modest glue.
- Scheduled functions → Railway cron jobs / Render cron jobs hitting internal endpoints.
- Both give you a long-lived process: the in-memory caches and rate limits actually get *more* effective than on serverless.

**Recommendation:** stay on Netlify unless there's a forcing reason; the routing, scheduling, and header rules are all Netlify-native. Budget 2–3 days for a clean port.

---

## 6. SSL, DNS, and custom domains

### Netlify custom domain

1. *Site → Domain management → Add custom domain* (e.g. `app.harbor-ai.com`).
2. DNS at your registrar:
   - Apex (`harbor-ai.com`): `A` → `75.2.60.5` (Netlify load balancer), or use Netlify DNS for ALIAS support.
   - Subdomain: `CNAME app.harbor-ai.com → <site-name>.netlify.app`.
3. **SSL is automatic** — Netlify provisions and renews Let's Encrypt certificates once DNS propagates (minutes to 24 h). Verify the padlock and that *Force HTTPS* is enabled (HSTS is already sent via headers).

### After changing the primary domain

- Update `SITE_URL` env var (used for emails and checkout callbacks).
- Update Stripe/Paystack webhook URLs and Meta webhook callback URL.
- Update the embed snippet customers use (it embeds the site origin).

---

## 7. Post-deploy verification

Run the health-check script against the deployed site:

```bash
node scripts/health-check.mjs https://harbor-ai-business-os.netlify.app
```

It checks the homepage, the functions liveness endpoint, DB connectivity, and API auth behavior, and exits non-zero on failure. Manual smoke test on top:

1. Register a throwaway account → dashboard loads.
2. Send a message in *My Agents → Test* → live reply (`mode: "live"`).
3. Check *System Health* page as owner.

---

## 8. Rollback

Netlify keeps every deploy immutable: *Deploys → pick the last good deploy → Publish deploy*. Rollback is instant and does not touch the database — if a bad deploy shipped a migration, restore procedure is in [docs/ops/backup-and-recovery.md](docs/ops/backup-and-recovery.md).
