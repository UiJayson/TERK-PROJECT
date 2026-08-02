# Frequently Asked Questions

## Product basics

**1. What exactly is AI Business OS?**
Three AI employees — Reception, Sales, and Marketing — that answer your customers on your website, WhatsApp, and Instagram, sharing one knowledge base you control, with every conversation and lead visible in a dashboard.

**2. Which AI model powers the agents?**
The platform supports Anthropic Claude and OpenAI models (operator-configurable). You don't manage models or prompts — you manage knowledge and agent notes.

**3. Do I need technical skills to use it?**
No. Adding knowledge is like writing notes; installing the website widget is copy-pasting one snippet. WhatsApp setup is the most technical step and has a step-by-step guide.

**4. What languages does it support?**
The agents respond in the language the customer writes in, as supported by the underlying model. Your knowledge base can be written in any language your customers use.

**5. Can the AI book appointments or take orders?**
It captures the request, the customer's details, and intent as a lead, and can run booking-style flows. It doesn't charge cards in chat — payment links belong in your knowledge base.

## Agents & knowledge

**6. What's the difference between the three agents?**
Reception handles greetings, FAQs, and routing; Sales handles pricing, qualification, and closing; Marketing drafts campaigns and content. Handoffs between them are automatic and logged.

**7. How do I change what an agent says?**
Two levers: the **Knowledge Base** (facts — pricing, policies, FAQs) and per-agent **notes** (behavior — "always mention the free trial"). You never edit prompts directly.

**8. Why did the agent say something wrong?**
It either found a wrong/outdated knowledge entry or found nothing and hedged. Use *Test retrieval* in the Knowledge Base with the same question to see what it read, then fix that entry. See [troubleshooting.md](troubleshooting.md).

**9. Can I stop the AI from answering certain topics?**
Yes — add it to the agent's notes (e.g. "Never discuss legal advice; offer to connect a human"). Escalation to a human is built in for angry or sensitive conversations.

**10. What file types can I upload to the Knowledge Base?**
PDF, DOCX, and TXT, up to 8 MB each. Text is extracted and indexed automatically.

**11. Is there a limit on knowledge entries?**
No hard limit on entries; retrieval selects the most relevant snippets per question, so a bigger base doesn't slow replies down.

## Channels

**12. How does the website chat widget work?**
Copy the snippet from Integrations onto your site. It uses a public key (`pk_…`) that identifies your workspace and only permits chatting — no data access.

**13. Someone stole my public key — what now?**
Settings → **Rotate public key**. The old key dies instantly; update the snippet on your site(s).

**14. What do I need for WhatsApp?**
A Meta WhatsApp Business account: Phone Number ID, a permanent access token, and a verify token you choose. Growth plan or higher. Guide: [whatsapp-setup.md](../whatsapp-setup.md).

**15. Why do WhatsApp replies feel slightly delayed?**
Deliberate human-feel typing delay (plus a typing indicator), tuned per message length. Customers respond better to it than to instant walls of text.

## Conversations & leads

**16. Where do leads come from?**
When a conversation contains contact details plus buying intent, the platform creates a lead automatically with the conversation context attached. You can push leads to HubSpot, Salesforce, Zoho, or any webhook via Marketing → CRM sync.

**17. Can I jump into a conversation myself?**
You can read every thread live. Escalated conversations flag a human takeover; direct in-thread replies from the dashboard are on the roadmap.

**18. What does "Resolve" do to a conversation?**
Marks it closed for reporting. The customer can always write again — that opens activity on the same thread.

## Billing & limits

**19. What happens when I hit my monthly message limit?**
Agents stop answering (with a polite notice to the customer) until you upgrade or the month resets. You're never silently charged for overage.

**20. How do I cancel?**
Billing → Cancel. Your plan stays active until the end of the paid period; no partial-month refunds. Your data stays intact if you come back.

**21. Which payment providers do you support?**
Paystack and Stripe, chosen automatically. Stripe subscribers also get a self-service billing portal for card changes and invoices.

**22. Is there a free plan?**
A free trial: 50 messages, 1 agent, website channel — enough to test the whole loop with real customers.

## Security & data

**23. Is my data isolated from other companies?**
Yes — every record is scoped to your workspace, enforced at the application layer and covered by a dedicated tenant-isolation test suite, plus Postgres row-level security as a second net.

**24. Are my WhatsApp/Instagram tokens safe?**
Stored encrypted at rest; sensitive values are redacted from logs (also covered by tests).

**25. Can I export my data?**
Yes — every conversation, lead, and knowledge entry belongs to you. Operators run a per-workspace export (JSON) on request; see [ops/backup-and-recovery.md](../ops/backup-and-recovery.md#customer-data-export).

**26. What happens to conversations if the AI provider goes down?**
A circuit breaker detects the outage; the widget shows a friendly retry message rather than hanging, and WhatsApp messages are logged for follow-up. See the [ops runbook](../ops/runbook.md#ai-provider-down).

**27. Who can see the System Health page?**
Workspace owners only. Admins can change anything else; staff are read-only.
