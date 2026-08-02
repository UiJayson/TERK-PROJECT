# Incident Runbook

For whoever is on call. Diagnose top-down: **site → functions → database → AI provider → external services.** The fastest triage command is always:

```bash
node scripts/health-check.mjs https://harbor-ai-business-os.netlify.app
```

## Monitoring surfaces

| Surface | Where | What it tells you |
| --- | --- | --- |
| Health script | `npm run health-check` | CDN, functions, DB, auth in one shot |
| System Health page | `/app` → System Health (owner login) | Error rates + latency last 24 h |
| Scheduled alerts | Email to `ADMIN_ALERT_EMAIL` every 10 min when thresholds breach | Error-rate spikes |
| Netlify function logs | Netlify → Site → Logs → Functions | Stack traces, `log.error` events |
| Sentry (if `SENTRY_DSN` set) | Sentry project | Grouped exceptions |
| Supabase | Dashboard → Reports / Logs | DB CPU, connections, slow queries |
| Provider status pages | see [contacts](#external-service-contacts) | Upstream outages |

Severity: **SEV1** = customers can't chat / data at risk (act immediately, all hands). **SEV2** = degraded (one channel down, slow). **SEV3** = cosmetic/single-tenant quirk.

---

## AI provider down

**Symptoms:** chats hang or return errors/fallbacks; error rate spike on `chat`/webhook functions; logs show provider timeouts or 5xx; circuit-breaker "open" messages.

**Confirm:** provider status page (status.anthropic.com / status.openai.com); `GET /.netlify/functions/ai-test` (spends a few tokens).

**Immediate actions:**

1. The **circuit breaker** (`_shared/circuit-breaker.ts`) already sheds load — expect fast friendly failures, not hangs. Verify that's happening in the widget.
2. **Switch providers** if the outage is provider-specific and the other key is configured: set `AI_PROVIDER=openai` (or `anthropic`) in Netlify env → redeploy. Two-minute mitigation, full recovery.
3. If both are down (rare): post a status notice; inbound WhatsApp messages are still logged (webhook logs) for manual follow-up; website widget shows the error state.

**Follow-up:** check `ai_usage_logs` for the gap; skim webhook logs for unanswered high-intent messages and reply manually; note incident in the journal.

**Escalate when:** outage > 1 h with no provider ETA and no second provider configured.

---

## Database connection lost

**Symptoms:** every `/api/*` returns 500; health script fails step 3; function logs full of connection errors.

**Confirm:** `GET /.netlify/functions/db-test`; Supabase dashboard reachable? Project paused? (free-tier projects **auto-pause after inactivity** — the classic cause). status.supabase.com.

**Immediate actions:**

1. **Project paused** → Supabase dashboard → Restore/Resume. Recovery in ~2 min.
2. **Connection exhaustion** (works, then breaks under load) → confirm `DATABASE_URL` uses the **transaction pooler, port 6543**, not 5432. Fix env → redeploy.
3. **Credential rotated/expired** → update `DATABASE_URL` with the current password from Supabase → redeploy.
4. **Supabase region incident** → nothing to fix on our side; if extended, consider DR Scenario A ([backup-and-recovery.md](backup-and-recovery.md#scenario-a--database-lost-or-unusable)). Post a status notice meanwhile.

**Follow-up:** if it was pooling, check for connection leaks in recent code (`db-client.ts` owns the pool); if paused, upgrade the plan — production must not sit on a pausable tier.

**Escalate when:** down > 30 min (SEV1 — customers' widgets are dead sitewide).

---

## Webhook failures (WhatsApp / Instagram / billing)

**Symptoms:** WhatsApp/Instagram messages unanswered; payments complete but plans don't upgrade; Meta or Stripe dashboards showing failed deliveries.

**Confirm & fix — messaging (per-tenant, usually SEV3):**

1. `GET /api/channels/whatsapp/logs` as the affected workspace (or check `whatsapp_webhook_logs` table): are events arriving?
2. **No events at all, any tenant** → our endpoint is failing: check function logs for `whatsapp-webhook`; Meta disables webhooks after sustained failures — re-enable + re-verify in the Meta app dashboard once fixed.
3. **Events but errors** → read the logged error:
   - *Signature verification failed* → `WHATSAPP_APP_SECRET` missing/rotated. Update env → redeploy.
   - *Token expired* → tenant must paste a fresh permanent token (Integrations). Tell them; it's self-service.
   - *Verify-token mismatch on GET* → tenant's Meta config disagrees with what they saved in Integrations.
4. Duplicated replies are prevented by message-ID idempotency — if a tenant reports doubles, check `claimWhatsAppMessageId` behavior in logs before touching Meta settings.

**Confirm & fix — billing (SEV2, money involved):**

1. Stripe dashboard → Developers → Webhooks → the endpoint → recent deliveries. Same for Paystack.
2. *401/400 signature errors* → `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint's signing secret (common after recreating the endpoint). Update → redeploy → **"Resend" the failed events from Stripe** (they replay cleanly).
3. *Endpoint URL wrong after a domain change* → point it at `https://<domain>/api/billing/webhook`, then resend.
4. Manually reconcile any tenant who paid during the gap (Stripe event → expected plan → set via support process), and tell them.

**Escalate when:** billing webhooks failing > 24 h, or Meta has disabled our webhook subscription.

---

## High error rates

**Symptoms:** alert email from the 10-minute observability sweep; System Health page red; spike visible in function logs.

**Triage:**

1. **Scope it:** one function or all? One workspace or all? (`observability` data has per-function + per-workspace context.)
2. **All functions** → almost always DB (run that runbook) or a bad deploy: did a deploy land just before the spike? → Netlify → publish previous deploy (instant rollback), investigate offline.
3. **One function** → read its log stack traces. New code path? Roll back. Malformed input from one client? Add the missing bound/validation (`sanitize.ts` patterns).
4. **One workspace** → usually channel misconfig (expired token) or one hostile client; rate limits already bound per-IP abuse. Not a platform incident — handle as support.
5. **429s specifically** → someone hammering `chat`. Per-instance limits mean sustained abuse from many IPs needs Netlify-level blocking (Netlify → Security → traffic rules).

**Cold-start false alarms:** first requests after idle take ~12 s (documented in PERFORMANCE.md) and can trip latency alerts at low traffic — check request volume before declaring an incident.

**Escalate when:** error rate > 10 % for > 15 min after rollback attempts.

---

## Escalation

| Level | Who | When |
| --- | --- | --- |
| L1 | On-call operator (currently: project owner) | All alerts |
| L2 | Project owner / lead developer | SEV1, or SEV2 > 1 h, or anything involving data loss |
| L3 | External support (below) + status notice to customers | Platform-provider outages, suspected breach |

Suspected **security breach** skips straight to L2 + [backup-and-recovery.md Scenario C](backup-and-recovery.md#scenario-c--secrets-compromised) (rotate secrets first, investigate second).

Every incident gets a journal entry: timeline, impact, root cause, follow-ups. Blameless; follow-ups get owners.

## External service contacts

| Service | Status page | Support |
| --- | --- | --- |
| Netlify (hosting, functions) | https://www.netlifystatus.com | https://answers.netlify.com · support tickets from the dashboard |
| Supabase (database) | https://status.supabase.com | dashboard support widget · support@supabase.com |
| Anthropic (AI) | https://status.anthropic.com | https://support.anthropic.com |
| OpenAI (AI / embeddings) | https://status.openai.com | https://help.openai.com |
| Stripe (billing) | https://status.stripe.com | dashboard → Help (24/7 chat on activated accounts) |
| Paystack (billing) | https://status.paystack.com | support@paystack.com |
| Resend (email) | https://resend-status.com | support@resend.com |
| Meta / WhatsApp & Instagram | https://metastatus.com | Meta for Developers → Direct Support |

Keep this table current — every new integration adds a row **in the same PR**.
