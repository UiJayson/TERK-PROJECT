# Getting Started with AI Business OS

From zero to your first AI-handled customer conversation in about 15 minutes.

## 1. Create your account

1. Go to **https://harbor-ai-business-os.netlify.app/register**.
2. Enter your name, work email, a password (8+ characters), and your **company name** — the company name becomes your workspace, so use the real business name; your AI agents will introduce themselves on its behalf.
3. Click **Create account**. You land in the dashboard as the workspace **owner**.

> Inviting teammates: additional users can hold the **admin** role (full control) or **staff** (read-only). Owners keep exclusive access to system-health dashboards.

## 2. Teach the Company Brain

Your agents are only as good as what they know. Before turning anything on, open **Knowledge Base** (`/app/knowledge`) and add:

- **Pricing** — every plan/product with its real price.
- **FAQs** — the 10 questions customers actually ask.
- **Policies** — refunds, shipping, guarantees, opening hours.
- **Documents** — upload existing PDFs, Word docs, or text files (max 8 MB each); the text is extracted and indexed automatically.

Use the **search test** (enter a question in the search box with *Test retrieval*) to see exactly what an agent would find for a given customer question. If the right fact doesn't come back, add or reword it.

**Rule of thumb:** write knowledge as short, factual entries with clear titles. "Starter plan costs $9/month, includes 500 messages" beats a marketing paragraph.

## 3. Turn on your first agent

1. Open **My Agents** (`/app/agents`).
2. **Reception** is enabled by default — it greets customers, answers general questions, and hands off to Sales when buying intent appears.
3. Toggle on **Sales** if you want lead qualification and pricing conversations handled; **Marketing** for campaign and content work.
4. Add **notes** to any agent (e.g. "Never promise same-day delivery") — notes are injected into that agent's behavior.

## 4. Have your first conversation

Still in **My Agents**, click **Test** on Reception and ask something a customer would ask — e.g. *"What are your opening hours?"*

Check three things in the reply:

- **The answer is right** (it cites your knowledge — fix the knowledge if not).
- **The agent is right** (a pricing question should route to Sales if it's enabled).
- **Mode is live**, not mock — mock means no AI key is configured (self-hosted installs: see DEPLOYMENT.md).

Every test conversation also appears in **Conversations**, and any contact details you drop in chat show up in **Leads** — that's the whole loop working.

## 5. Put it on your website

1. Open **Integrations** (`/app/integrations`).
2. Copy the embed snippet — it contains your workspace **public key** (`pk_…`).
3. Paste it before `</body>` on your site. The chat bubble appears immediately; visitors chat with your agents using your knowledge.

> The public key only allows chatting. If it ever leaks somewhere you don't want, rotate it in **Settings** — the old key stops working instantly (update every install).

## 6. Optional: connect WhatsApp

**Integrations → WhatsApp** walks you through connecting a Meta WhatsApp Business number (Phone Number ID + access token + a verify token you choose). Full walkthrough: [whatsapp-setup.md](../whatsapp-setup.md). Once connected, inbound WhatsApp messages get the same AI treatment as website chat, with human-feel typing delays.

## 7. Watch it work

- **Dashboard** (`/app`) — live counts of conversations, leads, and agent activity.
- **Conversations** — every thread across channels; resolve them when done.
- **Leads** — auto-captured contacts with status.
- **Analytics** — trends, per-agent volumes, response quality.

## Plans

| Plan | Price | Messages/mo | Agents | Channels |
| --- | --- | --- | --- | --- |
| Free trial | $0 | 50 | 1 | Website |
| Starter | $9 | 500 | 1 | Website |
| Growth | $29 | 5,000 | 3 | Website + WhatsApp |
| Pro | $79 | Unlimited | All | All channels |

Upgrade any time in **Billing** (`/app/billing`).

## Where to next

- Per-page details: [features.md](features.md)
- Something not working: [troubleshooting.md](troubleshooting.md)
- Quick answers: [faq.md](faq.md)
