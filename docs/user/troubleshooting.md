# Troubleshooting

Symptoms → causes → fixes. Ordered by how often they actually happen.

## Chat & agents

### "No active agents. Turn on an agent in My Agents."
All three agents are paused. Open **My Agents** and enable at least Reception.

### The agent gives wrong or "I don't know" answers
The knowledge base doesn't contain the fact, or it's worded so retrieval misses it.
1. In **Knowledge Base**, run *Test retrieval* with the exact customer question.
2. If the right entry doesn't appear in the top 5: add a dedicated entry whose **title matches the question's language** ("Do you offer refunds?" → title "Refund policy").
3. If a *wrong* entry appears: edit or delete it — agents trust what retrieval returns.

### Replies say `mode: "mock"` / feel canned (self-hosted)
No AI provider key is configured. Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` + `AI_PROVIDER=openai`) in the deployment environment and redeploy. Verify with `/.netlify/functions/health` — `services.ai` must be `true`.

### "Too many messages. Please wait a moment and try again."
Per-visitor rate limit (30 messages/min/IP) on the chat endpoint. It resets within a minute. If one office/network shares an IP and hits this in normal use, that's expected behavior, not a bug.

### The wrong agent answers
Routing picks the agent per message. Quick fixes: add a note to the over-eager agent ("Hand off pricing questions to Sales"), or pause the agent you don't want involved. If it persists on a specific phrasing, report it — routing evals cover these cases.

## Website widget

### Widget doesn't appear on my site
- Snippet pasted before `</body>`? Public key intact (starts `pk_`)?
- Did someone **rotate the public key** in Settings? Rotation kills old installs instantly — re-copy the snippet.
- Browser console shows a blocked frame? Your site's CSP must allow framing `https://<app-domain>` (the widget itself allows all parents).

### Widget loads but says "Invalid workspace key."
The `public_key` in the snippet doesn't match any workspace — almost always a stale key after rotation. Re-copy from Integrations.

## WhatsApp

### Messages to my WhatsApp number get no reply
Check in order:
1. **Integrations → WhatsApp → webhook logs** — are inbound events arriving?
   - **No events:** webhook not registered or verify token mismatch in Meta's dashboard. Re-run the [setup guide](../whatsapp-setup.md); the verify token in Meta must equal the one saved in Integrations.
   - **Events with errors:** read the error; expired token is the usual culprit.
2. **Token expired** — Meta temporary tokens die in 24 h. Generate a *permanent* token (System User) and paste it in Integrations.
3. **Send test message** from Integrations — if that fails, the problem is credentials/Meta side; if it succeeds but customers get nothing, it's the webhook registration.

### "WhatsApp access token expired or invalid."
Paste a fresh permanent access token in **Integrations → WhatsApp**. Replies resume immediately; messages received while broken are logged but not answered.

## Account & access

### "Invalid email or password" but I'm sure it's right
The message is identical for unknown email and wrong password (by design). Use **Forgot password**. Reset links expire after **1 hour** and are single-use.

### "Too many login attempts."
5 attempts per 15 minutes per IP. Wait for the window (the error includes retry timing) or reset your password.

### I keep getting logged out
Sessions last 24 h with sliding renewal while the app is open. Getting logged out *immediately* usually means your role was changed or a password reset invalidated sessions — log in again. If it loops, clear cookies for the site.

### "Forbidden — insufficient permissions."
Your role is **staff** (read-only) or the action needs **owner**. Ask a workspace admin/owner.

## Billing

### "Billing is not configured." (self-hosted)
Neither Paystack nor Stripe keys are set — see DEPLOYMENT.md §2.

### Paid but plan didn't upgrade
The provider webhook confirms payment. Give it ~1 minute; if still stuck, the webhook may be misconfigured (URL or signing secret) — operators: check `/api/billing/webhook` delivery logs in the Stripe/Paystack dashboard and [ops runbook](../ops/runbook.md#webhook-failures).

### Hit the message limit mid-month
Upgrade in Billing (takes effect immediately) or wait for the monthly reset. Agents stop answering (with a polite notice) rather than silently billing you.

## Self-hosted / operator

### All `/api/*` return 500 locally
`DATABASE_URL` unset or wrong. Point it at the Supabase **transaction pooler (port 6543)**. UI-only work: use dev preview mode (DEPLOYMENT.md §1).

### `/.netlify/functions/db-test` fails in production
Database unreachable — see the [ops runbook](../ops/runbook.md#database-connection-lost).

### First request after idle takes 10+ seconds
Netlify function cold start (~12 s baseline due to bundle size — known item in docs/PERFORMANCE.md). Subsequent requests are fast. The 10-minute scheduled health check keeps things warmer in production.

### Emails not arriving (password reset, alerts)
`RESEND_API_KEY` unset (emails go to function logs instead — grab the reset link there) or the sending domain isn't verified in Resend.

Still stuck? Collect: what you did, what you expected, what happened, timestamps, and (operators) the function log lines — then follow the escalation path in [ops/runbook.md](../ops/runbook.md#escalation).
