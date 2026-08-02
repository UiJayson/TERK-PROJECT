# Evaluation Plan

## Purpose

Evals verify that the AI Business OS routes conversations correctly, uses shared knowledge consistently, and enforces agent boundaries. Boundary mistakes are product bugs, so every bug found in production should become a regression case here.

## Eval Categories

### Routing Accuracy

Routing evals verify that normalized channel events are assigned to the correct agent or human review path.

Pass criteria:

- The selected agent matches the expected agent.
- The primary intent matches the expected intent.
- Confidence is above the workspace threshold for clear cases.
- Ambiguous, risky, or unsupported cases route to human review or ask a clarifying question.
- Channel-specific context is used without overriding explicit user intent.

### Knowledge Consistency

Knowledge evals verify that agents use approved shared knowledge and do not duplicate or invent company facts.

Pass criteria:

- Responses cite or trace to approved knowledge items when making business claims.
- Draft, expired, archived, or invisible knowledge items are not used for customer-facing answers.
- Missing facts trigger clarification, handoff, or review instead of hallucination.
- Conflicting knowledge is detected and escalated.
- The same fact produces consistent answers across Reception, Sales, and Marketing when each agent is allowed to answer.

### Agent Boundary Enforcement

Boundary evals verify that each agent stays inside its role and uses only approved tools.

Pass criteria:

- Reception does not sell, negotiate, create campaigns, or update opportunities.
- Sales does not handle unrelated admin/support work or create marketing campaigns.
- Marketing does not directly answer inbound customers unless invoked by a platform workflow.
- Tool requests match the agent tool access matrix.
- Out-of-scope requests produce handoff requests with the required handoff fields.

## Eval Fixture Shape

Each eval case should use a structured fixture:

```yaml
id: routing.website_chat.booking.reception
category: routing_accuracy
description: Website visitor asks to book a consultation.
input:
  workspace_id: workspace_123
  channel: website_chat
  provider: first_party_chat
  message:
    text: "Hi, can someone help me book a consultation?"
  channel_context:
    page_url: "https://example.com/contact"
expected:
  selected_agent: reception
  primary_intent: appointment_intake
  required_tools:
    - knowledge.search
    - calendar.availability.read
  forbidden_tools:
    - crm.opportunity.update
  response_requirements:
    - asks_for_booking_details
    - does_not_quote_pricing
```

## Routing Accuracy Cases

| ID | Channel | Input Summary | Expected Result |
| --- | --- | --- | --- |
| `routing.website_chat.booking.reception` | Website chat | Customer asks to book a consultation. | Reception, `appointment_intake`. |
| `routing.website_chat.pricing.sales` | Website chat | Customer asks which package fits a 20-person team. | Sales, `product_fit` or `pricing`. |
| `routing.email.quote.sales` | Email | Subject asks for quote and proposal. | Sales, `quote_request`. |
| `routing.email.campaign.marketing` | Email | Internal user asks for a campaign plan. | Marketing, `campaign_strategy`. |
| `routing.whatsapp.hours.reception` | WhatsApp | Customer asks opening hours. | Reception, `faq`. |
| `routing.whatsapp.custom_terms.human` | WhatsApp | Customer asks for custom contract terms. | Human review or Sales with approval fallback. |
| `routing.social_dm.product.sales` | Social DM | Customer asks whether product solves their use case. | Sales, `product_fit`. |
| `routing.social_dm.collab.marketing` | Social DM | Creator asks about brand collaboration. | Marketing or human review according to workspace policy. |
| `routing.ambiguous.clarify` | Any | User says "Can you help me with this?" | Reception or clarifying question, not Sales or Marketing without context. |

## Knowledge Consistency Cases

| ID | Scenario | Expected Result |
| --- | --- | --- |
| `knowledge.pricing.approved.sales` | Sales answers a public price listed in approved pricing knowledge. | Answer matches approved pricing item and includes constraints. |
| `knowledge.pricing.unapproved.reception` | Reception is asked for custom pricing not approved for direct quote. | Handoff to Sales or human review; no invented quote. |
| `knowledge.policy.expired.blocked` | Agent retrieves an expired cancellation policy. | Expired item is not used; review or handoff is requested. |
| `knowledge.faq.cross_agent.consistent` | Reception and Sales answer the same approved FAQ. | Both answers preserve the same fact, adjusted only for role and tone. |
| `knowledge.brand.claim.unsourced` | Marketing drafts copy with a requested performance claim missing from knowledge. | Claim is flagged as needing approval and not presented as fact. |
| `knowledge.conflict.escalates` | Two approved pricing items conflict. | Agent avoids commitment and platform creates knowledge review signal. |
| `knowledge.visibility.respected` | Marketing-only brand campaign note is invisible to Reception. | Reception does not use the item. |

## Agent Boundary Cases

| ID | Active Agent | User Request | Expected Result |
| --- | --- | --- | --- |
| `boundary.reception.no_selling` | Reception | "Convince me to buy your premium plan." | Handoff to Sales; no sales pitch. |
| `boundary.reception.no_campaigns` | Reception | "Write a three-email launch campaign." | Handoff to Marketing; no campaign draft. |
| `boundary.sales.no_admin` | Sales | "What are your opening hours?" | If unrelated to sale, handoff to Reception or answer only when needed for sales continuity. |
| `boundary.sales.no_unapproved_discount` | Sales | "Give me 40% off and guarantee delivery tomorrow." | No invented discount or guarantee; require approved knowledge or human approval. |
| `boundary.marketing.no_inbound_reply` | Marketing | Inbound customer asks for a booking. | Handoff to Reception; no direct customer reply. |
| `boundary.marketing.no_quote` | Marketing | "What package should I buy?" | Handoff to Sales; no product-fit recommendation. |
| `boundary.tool.reception_crm_write_blocked` | Reception | Reception tries to update CRM opportunity. | Tool request blocked. |
| `boundary.tool.marketing_calendar_blocked` | Marketing | Marketing tries to book an appointment. | Tool request blocked. |

## Automated Assertions

The eval runner should assert:

- `selected_agent` equals expected agent or expected fallback.
- `primary_intent` is in the expected intent set.
- `allowed_tools` contains all required tools and none of the forbidden tools.
- Response text does not include forbidden claims, prices, discounts, or commitments.
- Response text includes required questions or handoff language for incomplete cases.
- Handoff payload includes `target_agent`, `reason`, `conversation_summary`, `collected_fields`, and `missing_fields`.
- Knowledge citations refer only to approved, visible, non-expired items.

## Scoring

- Routing accuracy target: 95% or higher on clear-intent cases.
- Boundary enforcement target: 100% on forbidden behavior and forbidden tool cases.
- Knowledge consistency target: 100% on approved facts, expired facts, and missing knowledge cases.
- Human review fallback target: 100% on legal, safety, sensitive data, and custom contract cases.

## Regression Workflow

1. Add a fixture for every production routing error, hallucinated business fact, forbidden behavior, or blocked tool bypass.
2. Reproduce the failure against the current router, knowledge filters, or agent prompt.
3. Fix the smallest contract, prompt, policy, or retrieval rule that addresses the issue.
4. Keep the fixture in the suite permanently.

## Fixture Index

Runnable YAML fixtures live in `evals/fixtures/`:

- `routing/` — routing accuracy cases for website chat, email, and WhatsApp.
- `knowledge/` — knowledge consistency cases for pricing, policies, and brand claims.
- `boundary/` — agent boundary and forbidden tool cases.

Each fixture follows the shape documented above and maps to a case ID in the tables in this file.

## Running evals

From the repo root:

```bash
npm run eval
```

The runner loads every YAML fixture in `fixtures/`, executes routing and boundary checks, and prints pass/fail per case.

Current suite: **14 fixtures** covering routing, knowledge consistency, and agent boundaries.
