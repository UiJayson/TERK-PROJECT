# Video Script Outlines

Outlines for the onboarding/marketing video series. Format per video: goal, runtime target, beat-by-beat outline with screen directions. Tone: confident, plain-spoken, zero AI hype — show the product doing work.

---

## Video 1 — "Meet your AI employees" (product overview)

**Goal:** a cold visitor understands what this is in 90 seconds. **Runtime:** 1:30.

1. *(0:00–0:10)* Hook over inbox/WhatsApp chaos b-roll: "Every message you're slow to answer is a customer someone else gets."
2. *(0:10–0:30)* The pitch: three AI employees — Reception, Sales, Marketing — one shared Company Brain. Screen: My Agents page, slow pan.
3. *(0:30–0:55)* Live demo: visitor asks a pricing question in the website widget → Sales agent answers with real pricing → lead appears in Leads. One unbroken take; this is the money shot.
4. *(0:55–1:15)* "It's your knowledge, not a chatbot script." Screen: Knowledge Base, typing an entry, retrieval test.
5. *(1:15–1:30)* CTA: free trial, 50 messages, no card. Register screen → dashboard.

---

## Video 2 — "From signup to first conversation" (onboarding walkthrough)

**Goal:** a new user completes setup without support. **Runtime:** 4:00. Mirrors [getting-started.md](getting-started.md).

1. *(0:00–0:20)* What we'll do: account → knowledge → agent → first chat. Promise: 15 minutes.
2. *(0:20–0:50)* Register (real form, note the company-name-becomes-workspace detail).
3. *(0:50–1:50)* Knowledge Base: add a pricing entry, an FAQ, upload a PDF. Show *Test retrieval* and explain why titles should match customer language.
4. *(1:50–2:30)* My Agents: Reception is on; enable Sales; write a real note ("Never promise same-day delivery"), explain notes vs knowledge.
5. *(2:30–3:20)* Test chat: ask opening hours, then a pricing question, point out the reception→sales handoff and citations. Show the conversation appearing in Conversations.
6. *(3:20–4:00)* Recap checklist + pointer to widget install video.

---

## Video 3 — "Put it on your website" (widget install)

**Goal:** widget installed on any site. **Runtime:** 2:00.

1. *(0:00–0:15)* "Two minutes, one copy-paste."
2. *(0:15–0:45)* Integrations page: copy snippet, explain the public key (safe to expose, chat-only, rotatable).
3. *(0:45–1:20)* Paste before `</body>` — show WordPress *and* raw HTML.
4. *(1:20–1:45)* Refresh, chat bubble appears, send a message, show it landing in Conversations.
5. *(1:45–2:00)* Key rotation as the safety lever; CTA.

---

## Video 4 — "Connect WhatsApp" (channel setup)

**Goal:** WhatsApp connected end-to-end. **Runtime:** 5:00 (the honest one — this has real steps).

1. *(0:00–0:20)* What you get: AI answers on your business number, with typing indicators and human pacing.
2. *(0:20–1:00)* Prerequisites: Meta Business account, WhatsApp Business API number, Growth plan. Set expectations.
3. *(1:00–2:30)* Meta side: create app, get Phone Number ID + WABA ID, generate a **permanent** token (System User) — call out the classic 24h-token trap.
4. *(2:30–3:30)* Our side: Integrations → WhatsApp, paste credentials, choose a verify token; register the webhook URL in Meta with the same verify token.
5. *(3:30–4:20)* Prove it: **Send test message**, then message the number from a personal phone and watch the AI reply + thread appear in Conversations. Show webhook logs as the debugging tool.
6. *(4:20–5:00)* Troubleshooting rapid-fire: no events = webhook/verify token; errors = expired token. Link to written guide.

---

## Video 5 — "The Company Brain" (knowledge deep-dive)

**Goal:** users write knowledge that makes agents accurate. **Runtime:** 3:00.

1. *(0:00–0:20)* Thesis: "Wrong answers aren't an AI problem — they're a knowledge problem you can fix in 30 seconds."
2. *(0:20–1:00)* Anatomy of a good entry: short, factual, title phrased like the customer's question. Bad vs good side-by-side.
3. *(1:00–1:45)* Document upload: drop a policy PDF, show chunks indexed, ask a question answered from it — with citation.
4. *(1:45–2:30)* The debug loop: agent answers wrong → *Test retrieval* → fix entry → re-test. Do it live with a planted wrong price.
5. *(2:30–3:00)* Habits: update knowledge when prices change; check retrieval after big edits.

---

## Video 6 — "Leads, analytics, and running the machine" (ops for owners)

**Goal:** owners trust the reporting loop. **Runtime:** 2:30.

1. *(0:00–0:30)* Morning routine: Dashboard scan — conversations, leads, agent activity.
2. *(0:30–1:10)* Leads: where they come from (auto-capture), statuses, CRM sync to HubSpot/webhook.
3. *(1:10–1:50)* Analytics: volume trends, per-agent split; what a healthy week looks like.
4. *(1:50–2:15)* Conversations hygiene: reading escalations, resolving threads.
5. *(2:15–2:30)* Owner-only System Health nod + upgrade path when limits approach.
