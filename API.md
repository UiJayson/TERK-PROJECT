# AI Business OS — API Reference

Complete reference for the AI Business OS HTTP API (Netlify Functions).

- **Production base URL:** `https://harbor-ai-business-os.netlify.app`
- **Local base URL:** `http://localhost:5173` (Vite dev server proxies functions via `@netlify/vite-plugin`)
- All request and response bodies are JSON unless noted (`/api/knowledge/upload` is `multipart/form-data`).
- Machine-readable spec: [docs/api/openapi.yaml](docs/api/openapi.yaml).

## Table of contents

1. [Authentication](#authentication)
2. [Conventions: errors, caching, CORS](#conventions)
3. [Rate limits](#rate-limits)
4. [Auth endpoints](#auth-endpoints)
5. [Agents](#agents)
6. [Chat](#chat)
7. [Knowledge base](#knowledge-base)
8. [Conversations](#conversations)
9. [Leads](#leads)
10. [Analytics](#analytics)
11. [Settings](#settings)
12. [Notifications](#notifications)
13. [Channels (WhatsApp / Instagram)](#channels)
14. [Billing](#billing)
15. [Marketing](#marketing)
16. [Business Intelligence](#business-intelligence)
17. [Workflows](#workflows)
18. [Observability](#observability)
19. [Inbound webhooks](#inbound-webhooks)
20. [Admin & diagnostics](#admin--diagnostics)
21. [Scheduled functions](#scheduled-functions)

---

## Authentication

Sessions are **HS256 JWTs** signed with `AUTH_SECRET`, valid for **24 hours** with sliding renewal (`GET /api/auth/me` re-issues a fresh token on every call).

Two ways to authenticate a request — both are checked, header first:

| Method | How |
| --- | --- |
| Bearer header | `Authorization: Bearer <token>` — the `token` field returned by login/register |
| Session cookie | `aios_session` — `HttpOnly; SameSite=Lax; Secure` (production); set automatically by login/register |

A session is rejected (401) when: the token is expired or malformed, the user or workspace no longer exists, the user's `sessionVersion` changed (forced logout), or the user's workspace **role** changed since the token was issued.

### Workspace roles

Every session is scoped to exactly one workspace with one role:

| Role | Can do |
| --- | --- |
| `owner` | Everything, including observability/health dashboards |
| `admin` | All writes (agents, knowledge, channels, billing, marketing, BI, workflows) |
| `staff` | Read-only on most resources |

Endpoints below note their minimum role. Role failures return **403** `{"error": "Forbidden — insufficient permissions."}`.

### Public endpoints (no session required)

`/api/auth/*` (except `me`), `/api/chat` (with `public_key`), inbound webhooks, and the diagnostics functions.

---

## Conventions

### Error format

Every error is a JSON object with a single `error` string and an appropriate status code:

```json
{ "error": "Invalid email or password." }
```

| Status | Meaning |
| --- | --- |
| 400 | Validation failure (message explains which field) |
| 401 | Missing/invalid session |
| 403 | Authenticated but insufficient role |
| 404 | Resource not found / unknown route segment |
| 405 | Wrong HTTP method for this path |
| 409 | Conflict (e.g. email already registered) |
| 429 | Rate limited — includes `Retry-After` header (seconds) |
| 500 | Unexpected server error |
| 502 | Upstream provider error (e.g. WhatsApp API) |
| 503 | Feature not configured (e.g. billing keys absent) |

### Response caching

List/summary GET endpoints (`/api/conversations`, `/api/leads`, `/api/analytics/summary`) return an `ETag` and `Cache-Control: private`. Send `If-None-Match` to receive **304 Not Modified**. Server-side, responses are additionally cached in-memory per warm function instance (5 s for lists, 60 s for the analytics summary).

### CORS

Authenticated APIs allow only the site's own origin in production (with credentials). `POST /api/chat` sets `Access-Control-Allow-Origin: *` because the embeddable widget calls it from customer domains. All endpoints answer `OPTIONS` preflights with 204.

---

## Rate limits

Limits are enforced **per client IP, in-memory per function instance** (they reset when a function cold-starts; do not rely on them as billing enforcement).

| Endpoint | Limit | Window | Over-limit response |
| --- | --- | --- | --- |
| `POST /api/auth/register` | 5 | 15 min | 429 + `Retry-After` |
| `POST /api/auth/login` | 5 | 15 min | 429 + `Retry-After` |
| `POST /api/auth/forgot-password` | 5 | 15 min | 429 + `Retry-After` |
| `POST /api/chat` | 30 | 1 min | 429 + `Retry-After` |

Additionally, ten failed logins from one IP within an hour emit an `auth_bruteforce_suspected` error-level log event for alerting.

Plan-level usage limits (messages/month, agent count) are enforced separately by the billing gate — exceeding them returns a 4xx explaining the plan limit.

---

## Auth endpoints

### POST /api/auth/register

Create a user + workspace and start a session. **Public.** Rate limited (5/15 min/IP).

Request:

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "password": "at-least-8-chars",
  "companyName": "Analytical Engines Ltd"
}
```

Responses:

- **200** — session established. Body includes `token`; `Set-Cookie: aios_session=…` is also sent.

```json
{
  "user": { "id": "user_…", "email": "ada@example.com", "name": "Ada Lovelace" },
  "workspace": {
    "id": "ws_…",
    "name": "Analytical Engines Ltd",
    "ownerId": "user_…",
    "createdAt": "2026-07-10T12:00:00.000Z",
    "publicKey": "pk_…",
    "resources": { "…": "…" },
    "agentConfigs": []
  },
  "role": "owner",
  "token": "eyJhbGciOiJIUzI1NiJ9…"
}
```

- **400** — missing field, invalid email, or password shorter than 8 chars.
- **409** — email already registered.
- **429 / 500**.

### POST /api/auth/login

**Public.** Rate limited (5/15 min/IP). Request:

```json
{ "email": "ada@example.com", "password": "…" }
```

- **200** — same body shape as register.
- **401** — `{"error": "Invalid email or password."}` (identical for unknown email and wrong password, by design).

### POST /api/auth/logout

Clears the session cookie. Returns **200** `{"ok": true}`. Always succeeds.

### GET /api/auth/me

Requires session. Returns the current `user`, `workspace`, `role`, and a **fresh `token`** (sliding renewal) with a refreshed cookie. **401** when the session is invalid.

### POST /api/auth/forgot-password

**Public.** Rate limited (5/15 min/IP). Request: `{ "email": "ada@example.com" }`

Always returns **200** with a generic message (no account enumeration):

```json
{ "message": "If an account exists for that email, password reset instructions have been sent." }
```

A reset link (valid **1 hour**, single-use) is emailed via Resend. In non-production the response also includes `resetUrl` for testing. If `RESEND_API_KEY` is unset, the email is logged to console instead.

### POST /api/auth/reset-password

**Public.** Request: `{ "token": "<from email link>", "password": "new-password-8+" }`

- **200** — password updated; all existing sessions are invalidated (sessionVersion bump).
- **400** — invalid/expired/used token or weak password.

---

## Agents

Three fixed specialist agents exist per workspace: `reception`, `sales`, `marketing`.

### GET /api/agents

Requires session (any role). Returns all three agents with workspace-specific config merged in:

```json
{
  "agents": [
    {
      "id": "reception",
      "name": "Reception",
      "role": "Front-desk assistant",
      "description": "…",
      "status": "active",
      "enabled": true,
      "model": "…",
      "knowledgeSources": ["…"],
      "channelsConnected": ["website", "whatsapp"],
      "lastUpdated": "2026-07-10T09:00:00.000Z",
      "notes": "",
      "prompt": "…full agent prompt…"
    }
  ]
}
```

### PATCH /api/agents/:id

Role: **owner/admin**. `:id` ∈ `reception | sales | marketing`.

Request (at least one field): `{ "enabled": true, "notes": "≤2000 chars" }`

- **200** — `{ "agent": {…}, "agents": [ …all three… ] }`
- **400** — empty body. **404** — unknown agent id.

### POST /api/agents/:id/test

Role: **owner/admin**. Runs a real message through the full AI runtime **forcing** this agent (bypasses routing).

Request:

```json
{
  "message": "What are your opening hours?",
  "conversation_id": "conv_… (optional — continue a test thread)",
  "history": [{ "role": "user", "content": "…" }]
}
```

- **200** — `{ "agent", "reply", "handoff", "citations", "action_log", "mode", "routing_reason", "intent", "conversation_id", "state" }`
- **400** — empty message, or `{"error": "This agent is paused. Turn it on before testing."}`

---

## Chat

### POST /api/chat

The single conversational endpoint used by the dashboard tester, the public demo site, and the embeddable website widget. **Rate limited: 30 messages/min/IP.** CORS: `*`.

Identify the workspace one of two ways:

1. **Authenticated session** (dashboard) — workspace comes from the token.
2. **Public key** (embedded widget) — pass `public_key` from *Integrations*; no session needed.

With neither, the request falls through to the **legacy demo mode** (bundled sample knowledge only).

Request:

```json
{
  "message": "Do you ship to Lagos? (required, ≤4000 chars)",
  "history": [{ "role": "user", "content": "…" }],
  "state": { "active_agent": "reception", "last_intent": "greeting" },
  "page_url": "https://customer-site.com/pricing",
  "conversation_id": "conv_… (continue an existing thread)",
  "channel": "website | whatsapp | instagram | email | dashboard",
  "public_key": "pk_…"
}
```

Validation: `history` ≤ 40 turns, each ≤ 4000 chars; `public_key` ≤ 100 chars.

**200** response:

```json
{
  "reply": "Yes — we ship to Lagos within 2 business days…",
  "agent": "sales",
  "intent": "pricing_question",
  "routing_reason": "Message mentions shipping cost…",
  "handoff": null,
  "citations": [{ "source": "knowledge:shipping-policy", "…": "…" }],
  "action_log": [],
  "state": { "active_agent": "sales", "last_intent": "pricing_question" },
  "mode": "live",
  "conversation_id": "conv_…",
  "typing_delay_ms": 1200,
  "escalated": false,
  "products": []
}
```

Pass the returned `state` and `conversation_id` back on the next turn. `mode` is `live` (real model call) or `mock` (no AI key configured).

Errors: **400** validation or `{"error": "No active agents. Turn on an agent in My Agents."}` · **404** invalid `public_key` · **429** · **500**.

---

## Knowledge base

Two storage shapes share this API: **items** (structured entries: products, FAQs, policies, documents) and **core shared files** (the compiled markdown files agents read).

### GET /api/knowledge

Requires session. Query parameters select the mode:

| Query | Returns |
| --- | --- |
| *(none)* | `{ "items": [ … ] }` — all items |
| `?section=<section>` | Items filtered by section |
| `?q=<text>` | Keyword-filtered items |
| `?q=<text>&semantic=1` (or `test=1`) | `{ "results": [ … ] }` — top-5 retrieval results as agents would see them |
| `?files=1` | `{ "files": { "<path>": "<markdown>" } }` — core shared files |

### POST /api/knowledge

Role: **owner/admin**. Two request shapes:

**Create an item** → **201** `{ "item": {…} }`

```json
{
  "title": "Starter plan pricing",
  "content": "The Starter plan costs $9/month…",
  "type": "pricing",
  "section": "company",
  "tags": "pricing, plans",
  "imageUrl": null, "price": 9, "currency": "USD", "stockStatus": null
}
```

**Write a core shared file** → **200** `{ "ok": true, "path": "…" }`

```json
{ "path": "<one of the core shared file paths>", "content": "# markdown…" }
```

Invalid `path` values are rejected (400) — only the fixed set of core files can be written.

### PATCH /api/knowledge/:id

Role: **owner/admin**. Any subset of the item fields above. **200** `{ "item": {…} }` · **404** `ITEM_NOT_FOUND`.

### DELETE /api/knowledge/:id

Role: **owner/admin**. **200** `{ "ok": true }`.

### POST /api/knowledge/upload

Role: **owner/admin**. `multipart/form-data`:

| Field | Required | Notes |
| --- | --- | --- |
| `file` | yes | PDF, DOCX, or TXT; **max 8 MB**; content is scanned/validated |
| `title` | yes | ≤ 500 chars |
| `type` | yes | `product · service · pricing · faq · policy · document` |
| `tags` | no | comma-separated |

Text is extracted, chunked, and indexed for retrieval. **201**:

```json
{ "item": { "…": "…" }, "indexed": { "chunksIndexed": 14 } }
```

**400** — unsupported type, too large, extraction failed, or content failed the safety scan.

---

## Conversations

### GET /api/conversations

Requires session. **Keyset-paginated**:

| Query | Default | Notes |
| --- | --- | --- |
| `limit` | 50 | page size |
| `cursor` | — | `nextCursor` from the previous page |
| `status` | — | e.g. `open`, `resolved` |

**200** (ETag-enabled):

```json
{ "conversations": [ … ], "nextCursor": "…", "hasMore": true }
```

### GET /api/conversations/:id/messages

Requires session. Same pagination (`limit` default 100). **200** `{ "messages": [ … ], "nextCursor", "hasMore" }`.

### POST /api/conversations/:id/resolve

Role: **owner/admin**. Marks the conversation resolved and invalidates workspace caches. **200** `{ "ok": true, "conversationId": "…", "status": "resolved" }`.

---

## Leads

### GET /api/leads

Requires session. Leads are created automatically by the AI runtime when a chat contains contact details / buying intent. Keyset-paginated exactly like conversations (`limit` default 50, `cursor`, `status`).

**200**: `{ "leads": [ … ], "nextCursor": "…", "hasMore": false }`

---

## Analytics

### GET /api/analytics/summary

Requires session. Aggregated KPIs over all conversations + leads for the workspace. Server-cached 60 s; response carries `ETag` + `Cache-Control: private, max-age=30`.

**200**: `{ "summary": { …counts, trends, per-agent stats… } }`

---

## Settings

### GET /api/settings

Requires session. **200**: `{ "user", "workspace", "notificationPreferences", "role" }`.

### PATCH /api/settings

Role: **owner/admin**. Any subset:

```json
{
  "name": "New display name",
  "workspaceName": "New company name",
  "notificationPreferences": {
    "emailEnabled": true,
    "whatsappEnabled": false,
    "adminEmail": "alerts@example.com",
    "adminWhatsApp": null
  }
}
```

**200** — updated `{ user, workspace, notificationPreferences, role, token }` with a re-issued session token/cookie (name changes are baked into the JWT).

### POST /api/settings

Role: **owner/admin**. Actions:

```json
{ "action": "rotate_public_key" }
```

Rotates the embed public key — **the old key stops working immediately**; every widget install must be updated. **200** `{ "ok": true, "workspace": {…} }` · **400** unknown action.

---

## Notifications

In-app notification feed. Requires session (any role).

| Method & path | Result |
| --- | --- |
| `GET /api/notifications` | `{ "notifications": [ … ], "unreadCount": 3 }` |
| `GET /api/notifications/unread-count` | `{ "unreadCount": 3 }` |
| `POST /api/notifications/read-all` | `{ "ok": true, "updated": 3, "unreadCount": 0 }` |
| `PATCH /api/notifications/:id/read` | `{ "ok": true, "unreadCount": 2 }` · 404 if not found |

---

## Channels

Connect messaging channels. Credentials are stored encrypted (`AUTH_SECRET`-derived key).

### GET /api/channels

Requires session. **200** `{ "channels": { "whatsapp": { connected, … }, "instagram": { … } } }`.

### PATCH /api/channels/whatsapp

Role: **owner/admin**. Request:

```json
{
  "phoneNumberId": "1234567890 (required)",
  "wabaId": "…",
  "accessToken": "EAAG… (Meta permanent token)",
  "webhookVerifyToken": "any-string-you-choose"
}
```

**200** `{ "channels": {…} }` · **400** `Phone Number ID, Access Token, and Webhook Verify Token are required.` when incomplete.

### PATCH /api/channels/instagram

Role: **owner/admin**. `{ "businessAccountId" (required), "accessToken", "webhookVerifyToken" }` → `{ "channels": {…} }`.

### POST /api/channels/whatsapp/test

Role: **owner/admin**. Sends a real WhatsApp message: `{ "to": "+2348012345678", "message": "optional" }`.

**200** `{ "ok": true, "result": {…}, "channels": {…} }` · **400** not connected · **4xx/502** provider errors (expired tokens get a specific message).

### GET /api/channels/whatsapp/logs

Requires session. Last 50 inbound webhook log entries: `{ "logs": [ … ] }`.

---

## Billing

Plans: `free` (50 msgs/mo, 1 agent) · `starter` $9 (500 msgs, 1 agent) · `growth` $29 (5 000 msgs, 3 agents, +WhatsApp) · `pro` $79 (unlimited, all channels). Checkout goes through **Paystack when configured, otherwise Stripe**.

### GET /api/billing

Requires session. **200**:

```json
{
  "plan": "growth",
  "planDetails": { "id": "growth", "name": "Growth", "priceMonthly": 29, "messageLimit": 5000, "agentLimit": 3, "channels": ["…"] },
  "subscriptionStatus": "active",
  "subscriptionPeriodEnd": "2026-08-01T00:00:00.000Z",
  "usage": { "…": "…" },
  "invoices": [ … ],
  "plans": [ …paid plan definitions… ]
}
```

### POST /api/billing/subscribe

Role: **owner/admin**. Request: `{ "plan": "starter" | "growth" | "pro" }`.

**200** — redirect the user to `url`:

```json
{ "url": "https://checkout…", "provider": "paystack", "reference": "…" }
```

**400** invalid plan · **503** neither Paystack nor Stripe configured.

### POST /api/billing/cancel

Role: **owner/admin**. Sets status to `canceling` (cancels at period end). **200** `{ "ok": true, "message": "…" }` · **400** no active subscription.

### POST /api/billing/portal

Role: **owner/admin**. Stripe customers only — returns `{ "url": "<Stripe billing portal>" }` · **400** for Paystack subscriptions.

### POST /api/billing/webhook

**Public — signature-verified.** Stripe events (`Stripe-Signature` header, verified against `STRIPE_WEBHOOK_SECRET`). Updates plan/subscription state and records invoices. Returns 200 to acknowledge. Legacy Paystack endpoints live at `/.netlify/functions/billing/{initialize,verify,webhook}`.

---

## Marketing

Role for all writes: **owner/admin**.

| Method & path | Body | Result |
| --- | --- | --- |
| `GET /api/marketing` | — | `{ "stats", "campaigns", "insights", "crm" }` |
| `POST /api/marketing/campaign` | `{ "productId"?, "productName"?, "leadType"? }` (one of the first two required) | `{ "campaign" }` — AI-generated full campaign |
| `POST /api/marketing/scrape-competitor` | `{ "url" }` | `{ "insight" }` — competitor pricing scrape |
| `POST /api/marketing/scrape-news` | `{ "feedUrl" }` | `{ "insight" }` — industry RSS digest |
| `POST /api/marketing/crm-sync` | — | `{ "result" }` — pushes leads to the configured CRM |
| `PATCH /api/marketing/crm-config` | `{ "provider": "hubspot"\|"salesforce"\|"zoho"\|"webhook", "webhookUrl", "apiKey"?, "enabled"? }` | `{ "crm" }` |

Scrapes honor `robots.txt` (see `_shared/robots-check.ts`).

---

## Business Intelligence

Role for all writes: **owner/admin**. GET requires any session.

| Method & path | Body | Result |
| --- | --- | --- |
| `GET /api/bi` | — | `{ "competitors", "insights", "metrics", "competitorUrls" }` |
| `PATCH /api/bi/competitor-urls` | `{ "urls": ["https://…"] }` | `{ "competitorUrls" }` |
| `POST /api/bi/scrape` | — | `{ …scrape result, "priceChanges" }` |
| `POST /api/bi/analyze` | — | `{ "analysis" }` — full BI analysis |
| `POST /api/bi/swot` | — | `{ "swot" }` |
| `POST /api/bi/growth` | — | `{ "growth" }` |
| `POST /api/bi/opportunities` | — | `{ "opportunities" }` |
| `POST /api/bi/risks` | — | `{ "result" }` |
| `POST /api/bi/weekly-report` | — | `{ "ok": true }` — emails the weekly report now |

Scheduled versions run automatically (competitor scrape Mondays 06:00 UTC, weekly report Mondays 08:00 UTC).

---

## Workflows

Multi-step automations (trigger → steps). First `GET` auto-seeds prebuilt workflows.

| Method & path | Body | Result |
| --- | --- | --- |
| `GET /api/workflows` | — | `{ "workflows", "executions", "stats" }` |
| `GET /api/workflows/status?workflowId=…` | — | execution status |
| `POST /api/workflows` | `{ "name", "triggers": [type…], "steps": [step…] }` (all required) | `{ "workflow" }` |
| `POST /api/workflows/seed` | — | `{ "workflows" }` — re-seed prebuilt set |
| `POST /api/workflows/execute` | `{ "workflowId", "context"? }` | `{ "execution" }` |
| `PATCH /api/workflows/:id` | `{ "name"?, "triggers"?, "steps"?, "status": "active"\|"paused" }` | `{ "workflow" }` · 404 unknown id |

Writes require **owner/admin**.

---

## Observability

Both require role **owner**.

### GET /api/observability/health

`?hours=24` (default 24). **200** `{ "summary": {…}, "generatedAt": "…" }` — request counts, error rates, latency from the observability log.

### GET /api/admin/health

Same handler, wider dashboard payload: `{ "dashboard": {…}, "generatedAt": "…" }`.

---

## Inbound webhooks

### GET /api/whatsapp/webhook — Meta verification handshake

Meta calls this once when you register the webhook. Echoes `hub.challenge` when `hub.verify_token` matches a stored workspace verify token.

### POST /api/whatsapp/webhook — WhatsApp events

- **Signature:** `X-Hub-Signature-256` HMAC verified against `WHATSAPP_APP_SECRET`/`META_APP_SECRET` (required in production).
- **Idempotent** by WhatsApp message ID — duplicate deliveries are ignored.
- Routes each inbound message to the workspace matching the `phone_number_id`, runs the AI runtime, sends the reply (with human-feel typing delay), auto-captures leads, and logs the event (visible via `GET /api/channels/whatsapp/logs`).
- Supports text, image/document captions, audio, and location messages.
- Always returns **200** quickly (Meta retries non-200s).

### POST /api/instagram/webhook — Instagram DMs

Same pattern: verify handshake on GET, HMAC-verified events on POST, replies sent via the Instagram Graph API.

### POST /api/billing/webhook — Stripe

See [Billing](#billing).

---

## Admin & diagnostics

### /api/admin/knowledge · /api/admin/profile

Legacy operator endpoints. Auth: `Authorization: Bearer <ADMIN_TOKEN>` (not a user session). Operate on `DEFAULT_WORKSPACE_ID`. Prefer the workspace-scoped APIs; these remain for internal ops only.

### GET /.netlify/functions/health

**Public.** Liveness + config presence check (no DB call):

```json
{ "status": "ok", "services": { "database": true, "ai": true, "email": false }, "checkedAt": "…" }
```

### POST /.netlify/functions/db-test

Connectivity check against Postgres. **POST only**; in production requires `Authorization: Bearer <ADMIN_TOKEN>` (401 otherwise). Returns 200 with the test result, or 503 when the database is unreachable.

### GET /.netlify/functions/ai-test

Verifies the AI provider path end-to-end (spends a small number of tokens).

---

## Scheduled functions

Not HTTP-invocable; run by Netlify's scheduler (UTC):

| Function | Schedule | Purpose |
| --- | --- | --- |
| `appointment-reminders` | `*/15 * * * *` | Sends upcoming appointment reminders |
| `observability-alerts` | `*/10 * * * *` | Scans error rates, emails `ADMIN_ALERT_EMAIL` on threshold breach |
| `scheduled/health-check` | `*/10 * * * *` | Records platform health snapshots |
| `scheduled/event-bus-processor` | `*/2 * * * *` | Drains the async event bus (workflow triggers etc.) |
| `scheduled/bi-competitor` | `0 6 * * 1` | Weekly competitor scrape |
| `scheduled/bi-weekly-report` | `0 8 * * 1` | Weekly BI report email |
