# WhatsApp Business Cloud API Setup

Connect your AI Business OS workspace to Meta WhatsApp so customers can message your AI receptionist and sales agents on WhatsApp.

## Prerequisites

- A [Meta Developer](https://developers.facebook.com/) account
- A Meta Business Portfolio with WhatsApp Business Platform enabled
- A deployed AI Business OS site (e.g. `https://harbor-ai-business-os.netlify.app`)

## Step 1 — Create a Meta App

1. Go to [Meta for Developers](https://developers.facebook.com/apps/) → **Create App**.
2. Choose **Business** as the app type.
3. Add the **WhatsApp** product to your app.

## Step 2 — Get credentials

From **WhatsApp → API Setup** in the Meta dashboard, copy:

| Credential | Where to find it | Used for |
|------------|------------------|----------|
| **Phone Number ID** | API Setup → From phone number | Routing inbound messages to your workspace |
| **WhatsApp Business Account ID (WABA ID)** | API Setup (optional) | Reference / future features |
| **Permanent Access Token** | System User or temporary token → generate permanent token | Sending replies via Graph API |
| **App Secret** | App Settings → Basic | Webhook signature verification |

## Step 3 — Configure webhook in Meta

1. In Meta → WhatsApp → **Configuration**, set:

   **Callback URL**
   ```
   https://YOUR-SITE.netlify.app/api/whatsapp/webhook
   ```

2. **Verify token** — choose any random string (e.g. `my-secure-verify-token-2026`). You will enter the same string in AI Business OS Integrations.

3. Subscribe to webhook fields:
   - `messages`

4. Click **Verify and save**. Meta sends a GET request; your site must respond with the challenge string.

## Step 4 — Connect in AI Business OS

1. Sign in → **Integrations** (`/app/integrations`).
2. Under **WhatsApp Business**, enter:
   - Phone Number ID
   - WhatsApp Business Account ID (optional)
   - Access Token
   - Webhook Verify Token (same string as Step 3)
3. Click **Connect WhatsApp**.
4. Copy the webhook URL shown on the page if Meta asks for it again.

Credentials are **encrypted at rest** using your `AUTH_SECRET`. Plain-text tokens are never stored after save.

## Step 5 — Test

1. Add your personal WhatsApp number as a **test recipient** in Meta (API Setup → Send test message), or use a production number after business verification.
2. In Integrations, use **Send test message** with your phone number (country code, no `+`, e.g. `447700900123`).
3. Send a WhatsApp message to your business number — you should receive an AI reply within a few seconds.

## Environment variables (Netlify)

Set these in **Site settings → Environment variables**:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Supabase Postgres (run migration `004_whatsapp_webhook_logs.sql`) |
| `AUTH_SECRET` | Yes | Encrypts stored access tokens |
| `WHATSAPP_APP_SECRET` or `META_APP_SECRET` | Production | Validates `X-Hub-Signature-256` on inbound webhooks |
| `OPENAI_API_KEY` + `OPENAI_BASE_URL` | Yes | Agent replies + Knowledge Base semantic search |

## How inbound messages flow

```
Meta webhook → POST /api/whatsapp/webhook
  → Verify X-Hub-Signature-256 (if app secret set)
  → Parse from, message_id, body, timestamp
  → Idempotency check (message_id in DB)
  → Lookup workspace by phone_number_id
  → Typing indicator + mark read
  → loadMemoryContext() + searchKnowledge()
  → Agent router → generate response
  → persistTurn() + sendTextMessage()
  → Log to whatsapp_webhook_logs
```

## Template messages (outbound notifications)

For appointment reminders outside the 24-hour customer service window, use approved WhatsApp templates in Meta Business Manager. The platform exposes `sendTemplateMessage()` for server-side sends (e.g. future cron jobs).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Webhook verify fails (403) | Verify token in Meta must match Integrations exactly |
| Signature verification fails | Set `WHATSAPP_APP_SECRET` to your Meta App Secret |
| Token expired (401 in dashboard) | Generate a new permanent token in Meta; reconnect in Integrations |
| No AI reply | Check Netlify function logs; ensure `DATABASE_URL` and OpenAI env vars are set |
| Duplicate replies | Should not happen — `whatsapp_processed_messages` deduplicates by `message_id` |

## Database migration

Run in Supabase SQL Editor:

```
supabase/migrations/004_whatsapp_webhook_logs.sql
```

This creates `whatsapp_webhook_logs` and `whatsapp_processed_messages` tables.
