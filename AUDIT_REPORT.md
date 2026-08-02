# AI Business OS — Security & Architecture Audit

**Date:** 2026-07-09
**Scope:** Full repository — Netlify Functions backend, React frontend, Supabase migrations, config, deploy setup
**Status legend:** ✅ FIXED (in this audit) · ⚠️ OPEN (documented, needs decision or follow-up)

---

## Executive summary

The codebase is in **much better shape than a typical MVP**. Things that are usually broken are already done right here:

- **SQL injection: none.** All queries go through postgres.js tagged templates (parameterized) — 442 queries checked in `db.ts`, zero string-interpolated SQL.
- **XSS: none found.** No `dangerouslySetInnerHTML` or `innerHTML` anywhere in `web/src`.
- **Passwords:** bcrypt cost 12, JWT (HS256) with 7-day expiry, sessionVersion revocation, role-change invalidation, HttpOnly/SameSite=Lax/Secure cookies.
- **Webhook signatures:** Paystack and Stripe webhooks verify HMAC with `timingSafeEqual` and fail closed.
- **Uploads:** extension blocklist, magic-byte checks (PDF/DOCX), size limits, content scanning.
- **Logging:** structured logger with a redaction layer (`redact.ts`) and passing tests.
- **Tenant isolation:** workspace_id scoping + `set_config('app.workspace_id')`, with passing tests.
- **Indexes:** every migration ships indexes (52 total across 16 migrations); WHERE/ORDER BY columns are covered.

The audit found **1 critical and 5 high** issues — all fixed in this pass — plus a set of medium/low items documented below.

Verification after fixes: `tsc -b` clean, logger-redaction tests 2/2, tenant-isolation tests 6/6.

---

## CRITICAL

### C1. Admin endpoints protected by a well-known default token — ✅ FIXED

- **Files:** `web/netlify/functions/_shared/config.ts:226`, `admin-knowledge.ts`, `admin-profile.ts`, `db-test.ts`
- **Problem:** `ADMIN_TOKEN` fell back to the hardcoded `"dev-admin-change-me"` with **no production enforcement** (unlike `AUTH_SECRET`, which correctly throws). If the env var was ever unset in production, anyone could call `PUT /api/admin/knowledge` with `Bearer dev-admin-change-me` and **rewrite the default workspace's knowledge base** (i.e., poison what the AI agents tell customers), read/write the business profile, and probe the DB.
- **Also:** token comparison used `===` (not timing-safe).
- **Fix applied:**
  - `config.ts`: new `resolveAdminToken()` — in production, an unset/placeholder `ADMIN_TOKEN` resolves to `""`, which **never authorizes** (admin endpoints are effectively disabled until a real token is configured).
  - New shared guard `_shared/admin-auth.ts` with `timingSafeEqual` comparison, now used by `admin-knowledge.ts`, `admin-profile.ts`, and `db-test.ts`.

---

## HIGH

### H1. Public `/api/chat` had zero rate limiting — ✅ FIXED

- **File:** `web/netlify/functions/chat.ts`
- **Problem:** The endpoint is intentionally public (embed widget + legacy demo path) and every request triggers a **paid AI call**. Login/reset endpoints were rate-limited; the endpoint that actually costs money was not. Anyone could loop it and drain your Anthropic/OpenAI budget.
- **Fix applied:** per-IP limit of 30 requests/minute using the existing `checkRateLimit`/`clientIp` helpers, returning 429 + `Retry-After`.

### H2. `/.netlify/functions/ai-test` — unauthenticated paid AI call — ✅ FIXED

- **File:** `web/netlify/functions/ai-test.ts:13`
- **Problem:** A GET with no auth whatsoever fired a real Anthropic completion. Publicly discoverable URL, infinite free credit burn for an attacker.
- **Fix applied:** in production the endpoint now requires the admin token (same guard as `db-test`); still open in local dev.

### H3. Meta webhooks accepted unsigned payloads in production — ✅ FIXED

- **Files:** `whatsapp-webhook.ts:341`, `api/instagram/webhook.ts:196`
- **Problem:** When `WHATSAPP_APP_SECRET`/`META_APP_SECRET` was unset, production merely **logged a warning and processed the payload anyway**. A forged webhook could impersonate any customer conversation, trigger AI spend, and cause outbound WhatsApp/Instagram sends.
- **Fix applied:** both webhooks now **fail closed** — unsigned POSTs are rejected with 403 in production.

### H4. Registration endpoint had no rate limiting — ✅ FIXED

- **File:** `web/netlify/functions/auth-register.ts`
- **Problem:** Unlimited account + workspace creation per IP (each registration creates DB rows and a workspace). Login/forgot/reset were limited; register was not. Also, the catch block returned raw internal error messages to the client.
- **Fix applied:** 5 attempts / 15 min per IP (matching the other auth endpoints), and 500s now return a generic message while logging the real error server-side.

### H5. Embed widget was blocked by the site's own anti-framing headers — ✅ FIXED

- **Files:** `netlify.toml:9,14`, `web/src/pages/dashboard/IntegrationsPage.tsx:106-113`
- **Problem:** The Integrations page tells customers to install the widget via `<iframe src=".../embed/KEY">`, but `netlify.toml` set `X-Frame-Options: DENY` **and** `frame-ancestors 'none'` on `/*`. Every customer embed would render a blank blocked frame — the product's flagship integration was broken by its own deploy config.
- **Fix applied:** restructured headers (Netlify header rules are cumulative, so a naive `/embed/*` override would not work): the global `/*` rule no longer carries frame directives; `/embed/*` gets `frame-ancestors *`; every login-bearing route (`/`, `/app/*`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/admin`, `/dashboard`) gets explicit `X-Frame-Options: DENY` + `frame-ancestors 'none'`, so clickjacking protection is preserved where it matters.

---

## MEDIUM (open — need a decision or a follow-up task)

### M1. In-memory rate limiting is per-function-instance — ⚠️ OPEN
`_shared/rate-limit.ts` uses a module-level `Map`. On serverless, each warm instance has its own buckets, so real limits are `N × instances`, and cold starts reset them. It's still a meaningful brake (and the right MVP tradeoff), but for hard guarantees move the counters to Postgres or Upstash Redis. Also note the `Map` only evicts entries on re-hit — effectively bounded in practice, but worth a periodic sweep if traffic grows. **Est: 0.5–1 day.**

### M2. `Access-Control-Allow-Origin: *` + `Allow-Credentials: true` — ⚠️ OPEN
`_shared/auth-http.ts:19-24` sends both on every API response. Browsers *reject* the wildcard-with-credentials combination, so this isn't exploitable — but it means the credentials header is dead config, and wildcard CORS on authenticated endpoints is broader than needed (auth rides on the Bearer token/cookie, so risk is low). Recommended: echo an allowlisted origin for `/api/*` (dashboard) and keep `*` only on `/api/chat`. **Est: 2–3 hours (needs testing against the embed widget).**

### M3. Paystack plan amount math looks wrong — ⚠️ OPEN (business decision)
`_shared/paystack-billing.ts:26`: `planAmountKobo` = `priceMonthly * 10000`. Plans are priced 9/29/79 (USD-denominated in `billing-plans.ts`), so the Starter plan charges **₦900 (~$0.60)**. If that multiplier is a placeholder exchange rate, make it an explicit `NGN_PER_USD` env/config value. Also `billing/webhook.ts:68` stores `amount / 100` into a column named `amountCents` (it's actually naira) — naming will bite reporting later. **Est: 1–2 hours once the intended pricing is decided.**

### M4. Analytics page still shows hardcoded template data — ⚠️ OPEN
`web/src/pages/dashboard/AnalyticsPage.tsx:23` imports `CHANNEL_MIX`, `MONTHLY_ACTIVITY`, `RESPONSE_TREND` from `src/data/analytics.ts` — static fixtures rendered alongside live KPIs. Flagged in the previous internal audit (2026-07-04) and still present; owners can mistake these for real metrics. Derive from conversation timestamps or clearly label/remove. **Est: 0.5–1 day.**

### M5. CSP allows `'unsafe-inline'` scripts — ⚠️ OPEN
`netlify.toml` global CSP has `script-src 'self' 'unsafe-inline'`. Vite production builds don't need inline scripts; dropping it (or moving to nonces) would make the strong header set actually enforce against injected scripts. Test the build first. **Est: 1–2 hours.**

---

## LOW

### L1. `db.ts` is a 3,104-line god file — ⚠️ OPEN
All persistence for auth, billing, knowledge, runtime, BI, marketing, workflows lives in one module. It's consistent and parameterized, so no urgency — but split by domain (`db/auth.ts`, `db/billing.ts`, …) before it hits 5k lines. **Est: 1 day, mechanical.**

### L2. Unused `yaml` dependency in `web/package.json` — ✅ FIXED
Nothing under `web/` imports it (the root package uses its own copy for evals). Removed via `npm uninstall yaml`.

### L3. Scheduled BI jobs iterate workspaces sequentially — ⚠️ OPEN
`scheduled/bi-competitor.ts` and `bi-weekly-report.ts` loop `listWorkspaceIds()` one at a time with network calls inside. Fine for tens of workspaces; at hundreds you'll hit the function timeout. Batch with bounded concurrency (e.g., 5 at a time) when tenant count grows. **Est: 2 hours.**

### L4. Duplicate-looking function files are intentional — no action
`billing-paystack-webhook.ts`, `billing-stripe-webhook.ts`, `instagram-webhook.ts`, `*-scheduled.ts` are one-line re-export shims for the nested implementations. Not dead code; leave them (or add a comment noting why they exist).

---

## What was checked and found clean

| Area | Result |
| --- | --- |
| Hardcoded secrets | None in project code; `.env.example` uses placeholders; `config.ts` actively rejects placeholder values |
| SQL injection | All 442 queries parameterized via postgres.js tagged templates |
| XSS | No raw HTML rendering in any React component |
| CSRF | SameSite=Lax HttpOnly cookie + JSON POSTs; forms are same-origin |
| JWT | HS256, 7-day expiry, secret enforced in production, session versioning, role revalidation |
| File uploads | Type/size/magic-byte/content validation in `upload-validation.ts` |
| PII in logs | Redaction layer with passing tests (`tests/logger-redaction.test.ts`) |
| Tenant isolation | Workspace scoping enforced + tested (`tests/tenant-isolation.test.ts`) |
| DB indexes | Present in every migration; FK/WHERE columns covered |
| Payment webhooks | HMAC-verified (timing-safe), fail closed |

---

## Prioritized remaining work

| # | Item | Severity | Estimate |
| --- | --- | --- | --- |
| 1 | Decide Paystack pricing/multiplier (M3) | MEDIUM | 1–2 h |
| 2 | Durable rate limiting (M1) | MEDIUM | 0.5–1 d |
| 3 | Real or labeled analytics data (M4) | MEDIUM | 0.5–1 d |
| 4 | CORS origin allowlist for dashboard APIs (M2) | MEDIUM | 2–3 h |
| 5 | Drop `'unsafe-inline'` from CSP script-src (M5) | MEDIUM | 1–2 h |
| 6 | Split `db.ts` by domain (L1) | LOW | 1 d |
| 7 | Concurrency for scheduled BI jobs (L3) | LOW | 2 h |

## Deployment checklist (post-fix)

- Set `ADMIN_TOKEN` in Netlify env if you still use `/api/admin/*` — those endpoints are now **disabled in production until a real token is set** (this was the point of C1).
- Set `WHATSAPP_APP_SECRET` / `META_APP_SECRET` — Meta webhooks now **reject unsigned payloads in production** (H3). Without the secret set, WhatsApp/Instagram message processing stops until configured.
- No other behavior changes for legitimate traffic: chat is limited to 30 msgs/min/IP, registration to 5/15min/IP.
