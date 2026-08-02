# Billing & Revenue Infrastructure Audit Report

**Audit date:** 2026-07-13  
**Scope:** Stripe/Paystack subscriptions, usage tracking, plan enforcement, billing UI, revenue ops.

---

## Executive summary

Harbor AI has a **working billing stack** with Stripe and Paystack providers, webhook sync, usage metering, and runtime enforcement. This audit identified gaps and implemented fixes for idempotency, plan gating utilities, dashboard alerts, and knowledge-base limits.

| Area | Status | Action taken |
|------|--------|--------------|
| Stripe webhooks | Working | Idempotency + `past_due` recovery on `invoice.paid` |
| Usage tracking | Working | Enhanced client `usage.ts` with agent + KB limits |
| Plan enforcement | Partial | Server gates messages/channels; new `plan-gate.ts` for features |
| Billing UI | Working | Alerts now on dashboard home + billing page |
| Revenue ops | Partial | MRR helper exists but not exposed in admin health |

---

## 1. Subscription management

### Current implementation

| Component | Path |
|-----------|------|
| Stripe client | `web/netlify/functions/_shared/stripe-billing.ts` |
| Webhook handler | `web/netlify/functions/api/billing/webhook.ts` |
| Shim endpoints | `stripe-webhooks.ts`, `billing-stripe-webhook.ts` |
| Subscribe flow | `billing-subscribe-handler.ts` → checkout session |
| Portal | Stripe Billing Portal via `POST /api/billing/portal` |
| Paystack (alt) | `paystack-billing.ts` — takes priority when configured |

### Webhook events handled

| Event | Behavior |
|-------|----------|
| `checkout.session.completed` | Set plan, customer/subscription IDs, `active` |
| `customer.subscription.created/updated` | Sync plan, status, period end, `canceling` |
| `customer.subscription.deleted` | `canceled`, downgrade to `free` |
| `invoice.paid` / `invoice.payment_succeeded` | Upsert invoice, recover `past_due` → `active` |
| `invoice.payment_failed` | `past_due`, invoice status `failed` |

### Fixes applied

- **Webhook idempotency** — `stripe_webhook_events` table (migration `018`) + `isStripeWebhookEventProcessed()` / `recordStripeWebhookEvent()` in `db.ts`
- **Canonical entry point** — `netlify/functions/stripe-webhooks.ts` re-exports webhook handler
- **Payment recovery** — successful invoice immediately clears `past_due` (was waiting for subscription.updated)

### Gaps remaining

| Gap | Severity | Recommendation |
|-----|----------|----------------|
| No in-place plan upgrade/downgrade | Medium | Add Stripe `subscription.update` with proration |
| Paystack auto-wins when configured | Low | Region-based provider selection |
| No trial creation flow | Low | `trialing` status exists but unused |
| Duplicate subscribe endpoints | Low | Consolidate to `billing.ts` only |

---

## 2. Usage tracking & limits

### Plan definitions (`billing-plans.ts`)

| Plan | Price | Messages/mo | Agents | Channels |
|------|-------|-------------|--------|----------|
| Free | $0 | 50 | 1 | website, dashboard |
| Starter | $9 | 500 | 1 | website, dashboard |
| Growth | $29 | 5,000 | 3 | website, whatsapp, dashboard |
| Pro | $79 | Unlimited | Unlimited | All channels |

### What's tracked vs enforced

| Metric | Tracked | Enforced |
|--------|---------|----------|
| Messages/month | ✅ `usage_logs.messages_sent` | ✅ `ai-runtime.ts` blocks |
| Channel access | — | ✅ per-plan `channels` |
| Active agents | ✅ `agents_used` JSONB | ✅ at enable time (`agents.ts`) |
| Leads created | ✅ | ❌ analytics only |
| Appointments | ✅ | ❌ analytics only |
| AI tokens | ✅ + `ai_usage_logs` | ❌ analytics only |
| Knowledge items | — | ✅ client helper added (`knowledgeItemLimit`) |

### Fixes applied

- Enhanced `web/src/lib/billing/usage.ts`:
  - `agentUsageStatus()` — agent count vs plan limit
  - `knowledgeUsageStatus()` / `knowledgeItemLimit()` — KB document caps per tier
- `loadUsageStatus()` — single entry for dashboard surfaces

---

## 3. Plan enforcement

### Server-side gates

| Location | Gates |
|----------|-------|
| `ai-runtime.ts` | Messages, channels, subscription status before every AI turn |
| `agents.ts` | Agent enable count (HTTP 402) |
| `usage-limits.ts` | `checkUsageLimit()` — canonical server check |

### Client-side gate (new)

`web/src/middleware/plan-gate.ts`:

- `checkPlanFeature(plan, feature)` — feature-level gating
- `agentLimitForPlan()`, `messageLimitForPlan()`, `channelsForPlan()`
- `PLAN_GATE_STATUS = 402` for API responses

### Gaps remaining

- Knowledge item limits defined client-side but not yet enforced server-side on `knowledge` API
- Team seat limits not in schema (future: `workspace_members` count gate)

---

## 4. Revenue operations

| Capability | Status |
|------------|--------|
| Invoice PDF storage | ✅ `billing_invoices.invoice_pdf_url` |
| Tax calculation | ❌ Not implemented (Stripe Tax not wired) |
| Dunning emails | ❌ Relies on Stripe defaults; no custom sequence |
| Refunds / credit notes | ❌ Manual via Stripe dashboard |
| MRR reporting | ⚠️ `getPlatformMrrCents()` exists, not exposed in admin UI |

---

## 5. Billing UI/UX

| Surface | Status |
|---------|--------|
| `/app/billing` — plan, usage bar, invoices | ✅ `BillingPage.tsx` |
| Billing alerts component | ✅ `BillingAlerts.tsx` |
| Dashboard home alerts | ✅ **Fixed** — now loads `loadUsageStatus()` |
| Upgrade banner (free plan) | ✅ `DashboardHome.tsx` |
| Sidebar upgrade link | ✅ |

---

## Database schema

Existing tables (no structural changes required):

- `workspaces` — plan, subscription_status, stripe_*, paystack_*
- `usage_logs` — monthly counters (PK: workspace_id + month)
- `billing_invoices` — invoice history with PDF URLs
- `ai_usage_logs` — per-call token/cost detail

**New migration:** `018_stripe_webhook_events.sql` — webhook idempotency

---

## Test checklist

| Scenario | Expected | Verified |
|----------|----------|----------|
| Message limit reached | Polite upgrade reply, `intent: billing_limit` | Code review ✅ |
| `past_due` subscription | Agents paused | Code review ✅ |
| WhatsApp on Starter plan | Channel blocked, suggests Growth | Code review ✅ |
| Invoice paid after failure | Status → `active` immediately | Code review ✅ |
| Duplicate webhook delivery | Skipped via event ID | Code review ✅ |
| Dashboard shows 80%+ usage alert | Warning banner | UI wired ✅ |

---

## Files changed

| File | Change |
|------|--------|
| `api/billing/webhook.ts` | Idempotency, event ID tracking |
| `stripe-webhooks.ts` | **NEW** — canonical webhook export |
| `db.ts` | `isStripeWebhookEventProcessed`, `recordStripeWebhookEvent` |
| `018_stripe_webhook_events.sql` | **NEW** — idempotency table |
| `web/src/lib/billing/usage.ts` | Agent + KB usage helpers |
| `web/src/middleware/plan-gate.ts` | **NEW** — feature gating |
| `DashboardHome.tsx` | Billing alerts on dashboard |

---

## Recommended next steps

1. Enforce `knowledgeItemLimit` server-side in knowledge CRUD API
2. Add Stripe subscription update endpoint for plan changes with proration
3. Expose `getPlatformMrrCents()` on `/api/admin/health`
4. Wire dunning email notifications for `invoice.payment_failed`
5. Consolidate duplicate subscribe function declarations
