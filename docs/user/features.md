# Feature Guide — Every Page

One section per dashboard page. Role notes: **owner** and **admin** can change things; **staff** can view.

---

## Dashboard (`/app`)

Your morning-coffee view: live conversation count, new leads, messages handled, and per-agent activity pulled straight from the AI runtime (no stale numbers). Cards link into the relevant page. If everything reads zero, no conversations have happened yet — test an agent or install the widget.

---

## My Agents (`/app/agents`)

The three specialists, each with a card:

- **Toggle** — enable/pause an agent. Paused agents never receive conversations; if *all* are paused, chat returns "No active agents."
- **Notes** — free-text instructions (≤ 2000 chars) injected into that agent's behavior, e.g. "We're closed Dec 24–26" or "Never discuss competitor X." Notes are the fastest way to tune behavior without touching knowledge.
- **Test** — a private chat that runs the *real* pipeline (your knowledge, your notes, live AI) forced to this agent. Test conversations appear in Conversations like any other.
- **Prompt preview** — read-only view of the agent's underlying behavior prompt.

**Reception** greets, answers general/FAQ questions, books, and routes. **Sales** qualifies leads, discusses pricing, pushes toward a close. **Marketing** drafts campaigns and content. Handoffs between them are automatic and logged with a reason.

---

## Knowledge Base (`/app/knowledge`)

The Company Brain — every agent reads from here.

- **Add entry** — title + content + type (`product`, `service`, `pricing`, `faq`, `policy`, `document`) + optional tags, image, price/currency/stock for product cards.
- **Upload document** — PDF, DOCX, or TXT up to 8 MB. Text is extracted, chunked, and indexed; you'll see how many chunks were indexed.
- **Sections** filter entries (company, documents, …).
- **Search + Test retrieval** — regular search filters your entries; *test retrieval* shows the top-5 snippets an agent would actually receive for a question. Use this whenever an agent gives a wrong/missing answer.
- **Core shared files** — the compiled markdown the platform maintains (advanced; most users never touch these).

Only owners/admins can create, edit, or delete.

---

## Conversations (`/app/conversations`)

Every thread across every channel (website widget, WhatsApp, Instagram, dashboard tests), newest first, with channel, agent used, sentiment, lead status, and a preview. Click into a thread for the full transcript with agent handoffs and citations. **Resolve** (owner/admin) closes a thread. The list paginates as you scroll (server-side cursor pagination — fast even with thousands of threads).

---

## Leads (`/app/leads`)

Contacts your agents captured automatically — when a chat contains a name/phone/email plus buying intent, a lead record is created with the conversation context. Filter by status, page through with the same cursor pagination. Push them to your CRM from *Marketing → CRM sync*.

---

## Analytics (`/app/analytics`)

KPIs and charts over your conversations and leads: volumes over time, per-agent split, lead conversion, response health. The summary is computed server-side and cached ~60 s, so heavy dashboards stay fast.

---

## Integrations (`/app/integrations`)

- **Website chat** — copy the embed snippet (contains your `pk_…` public key). Works on any site; the widget page is the only part of the app allowed inside an iframe.
- **WhatsApp** — connect a Meta WhatsApp Business number: Phone Number ID, WABA ID, permanent access token, and a webhook verify token you choose. Then register the webhook URL in Meta's dashboard (guide: [whatsapp-setup.md](../whatsapp-setup.md)). **Send test message** verifies the full loop; **webhook logs** show the last 50 inbound events for debugging.
- **Instagram** — same pattern with your Instagram Business Account ID.

Access tokens are stored encrypted. If a token expires, the page shows it and replies stop — paste a fresh token.

---

## Channels (`/app/channels`)

Connection status for each channel at a glance — connected/disconnected, last error, message counts. Configuration itself lives in Integrations.

---

## Settings (`/app/settings`)

- **Profile** — your display name.
- **Workspace** — company name (what agents introduce themselves as).
- **Notifications** — email and/or WhatsApp alerts to the address/number you set (new leads, escalations).
- **Rotate public key** (owner/admin) — instantly revokes the embed key and issues a new one. Every widget install must be updated afterward, so treat it as an emergency lever.

---

## Billing (`/app/billing`)

Current plan, usage against limits (messages this month, agents in use), invoice history, and upgrade buttons. Checkout runs through Paystack or Stripe depending on region/config; **Manage billing** opens the Stripe customer portal (card changes, invoices). **Cancel** stops renewal at the period end — you keep access until then.

---

## System Health (`/app` → System Health, owner only)

Request volumes, error rates, and latency for the platform over the last 24 h (adjustable). Green across the board is normal; see [troubleshooting.md](troubleshooting.md) when it isn't. The Admin Health page is the deeper ops view of the same data.

---

## Embed widget (`/embed/:publicKey`)

What your customers see: a chat window branded with your workspace name, powered by the same agents + knowledge. It keeps conversation state client-side and passes it back each turn, so threads survive page reloads. Rate-limited per visitor IP (30 messages/min) to protect your message quota.
