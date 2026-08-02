# Multi-Channel Routing Contract

## Purpose

The routing contract converts website chat, email, WhatsApp, and social DMs into one internal event model. This lets the platform route consistently while preserving channel-specific delivery details.

## Supported Channels

| Channel | Interaction Style | Threading Key | Response Expectations |
| --- | --- | --- | --- |
| `website_chat` | Live or near-live chat | Session ID plus visitor ID | Short responses, fast handoff, optional lead capture |
| `email` | Asynchronous thread | Message ID plus thread ID | Fuller replies, quoted context handling, slower follow-up |
| `whatsapp` | Mobile messaging | Provider conversation ID plus phone number | Concise replies, opt-in compliance, template constraints |
| `social_dm` | Platform direct message | Provider conversation ID plus user handle | Concise replies, platform policy limits, attachment awareness |

## Normalized Inbound Event

Every channel adapter must produce this shape before the platform router runs:

```json
{
  "event_id": "evt_01J...",
  "workspace_id": "workspace_123",
  "channel": "website_chat",
  "provider": "first_party_chat",
  "provider_event_id": "provider_msg_456",
  "received_at": "2026-06-30T15:50:00Z",
  "conversation": {
    "id": "conv_789",
    "provider_thread_id": "thread_456",
    "status": "open",
    "active_agent": null,
    "last_agent": null,
    "language": "en",
    "timezone": "Europe/London"
  },
  "sender": {
    "type": "customer",
    "display_name": "Avery Example",
    "external_id": "visitor_123",
    "email": "avery@example.com",
    "phone": null,
    "handle": null,
    "consent": {
      "marketing": false,
      "transactional": true
    }
  },
  "message": {
    "id": "msg_123",
    "text": "Hi, can someone help me book a consultation?",
    "format": "plain_text",
    "attachments": [],
    "reply_to_message_id": null
  },
  "channel_context": {
    "page_url": "https://example.com/pricing",
    "referrer": "https://google.com",
    "campaign": null,
    "device": "desktop"
  },
  "delivery_constraints": {
    "max_length": 1200,
    "supports_markdown": false,
    "supports_buttons": true,
    "requires_template": false,
    "response_window_expires_at": null
  }
}
```

## Required Inbound Fields

- `event_id`: Platform idempotency key for this inbound event.
- `workspace_id`: Tenant boundary for all routing, retrieval, and tools.
- `channel`: One of `website_chat`, `email`, `whatsapp`, or `social_dm`.
- `provider`: Adapter or provider name.
- `provider_event_id`: Original provider event ID for deduplication.
- `received_at`: Platform receive timestamp.
- `conversation.id`: Stable internal conversation ID.
- `message.id`: Stable internal message ID.
- `message.text`: Text extracted from the channel payload.
- `delivery_constraints`: Limits the agent and outbound renderer must respect.

## Channel Adapter Requirements

### Website Chat

Website chat adapters should include:

- Current page URL.
- Referrer and campaign parameters when available.
- Visitor ID or anonymous session ID.
- Whether the user is still online.
- Widget capabilities such as buttons, forms, or file uploads.

Routing hints:

- Pricing or product pages may increase Sales routing confidence.
- Contact or booking pages may increase Reception routing confidence.
- Admin pages may increase Reception or human handoff confidence.

### Email

Email adapters should include:

- Subject.
- Thread ID.
- From, reply-to, and recipient addresses.
- Clean message body without signatures and quoted history when possible.
- Attachment metadata.

Routing hints:

- Subject lines containing quote, proposal, pricing, or demo usually indicate Sales.
- Newsletter, campaign, audience, copy, or report requests usually indicate Marketing when the sender is an internal user.
- Generic contact, booking, opening hours, or appointment requests usually indicate Reception.

### WhatsApp

WhatsApp adapters should include:

- Phone number.
- Conversation window state.
- Template requirement state.
- Media metadata.
- Consent and opt-in state.

Routing hints:

- Keep default responses short.
- If the response window is closed, the platform must use an approved template or request human intervention.
- Marketing use must respect explicit consent and workspace policy.

### Social DMs

Social DM adapters should include:

- Provider platform.
- User handle.
- Public profile metadata allowed by the provider.
- Conversation ID.
- Attachment metadata.

Routing hints:

- Public-comment follow-up DMs often start with Reception triage.
- Product questions, quote requests, and buying objections route to Sales.
- Influencer, campaign, brand, or content collaboration requests may route to Marketing or human review depending on workspace policy.

## Intent Labels

The router should classify each turn with one primary intent and optional secondary intents:

- `greeting`
- `faq`
- `appointment_intake`
- `admin_triage`
- `lead_qualification`
- `product_fit`
- `pricing`
- `quote_request`
- `sales_objection`
- `campaign_strategy`
- `content_draft`
- `audience_segmentation`
- `marketing_performance`
- `complaint`
- `support_request`
- `human_request`
- `unknown`

## Routing Decision

The router must output a decision before invoking an agent:

```json
{
  "decision_id": "route_01J...",
  "event_id": "evt_01J...",
  "workspace_id": "workspace_123",
  "selected_agent": "reception",
  "confidence": 0.91,
  "primary_intent": "appointment_intake",
  "secondary_intents": [
    "faq"
  ],
  "reason": "User asks to book a consultation and has not requested sales qualification or marketing work.",
  "knowledge_filters": {
    "categories": [
      "faqs",
      "processes",
      "policies"
    ],
    "agent": "reception",
    "status": "approved"
  },
  "allowed_tools": [
    "knowledge.search",
    "calendar.availability.read",
    "calendar.booking.create_pending",
    "email.draft.create"
  ],
  "fallback": {
    "type": "human_review",
    "reason": "Route to human if booking policy is missing or calendar access fails."
  }
}
```

## Agent Selection Rules

Select Reception when:

- The user is making first contact.
- The user needs greeting, triage, basic FAQs, booking intake, admin routing, or a handoff.
- Intent is ambiguous and there is no strong Sales or Marketing signal.

Select Sales when:

- The user asks about product fit, pricing, packages, quotes, buying objections, comparisons, demos, or proposals.
- The conversation already has an active sales opportunity.
- Reception requests Sales handoff with enough buying context.

Select Marketing when:

- The requester is internal or the platform invoked a marketing workflow.
- The request is about campaigns, content drafts, audience segmentation, brand messaging, or marketing analytics.
- The message is not a direct inbound customer request unless workspace policy explicitly permits marketing handling.

Select human review when:

- The message includes threats, legal concerns, safety concerns, harassment, payment disputes, or sensitive personal data beyond agent scope.
- The router confidence is below the workspace threshold.
- Required knowledge is missing or contradictory and the answer would make a business commitment.
- Channel policy requires a human or approved template.

## Conversation State

The platform should persist:

- Active agent.
- Last routed intent and confidence.
- Open handoff request.
- Collected customer fields.
- Missing fields.
- Tool actions performed.
- Knowledge items used.
- Human review state.
- Channel delivery status.

Conversation state must be scoped by `workspace_id` and `conversation.id`.

## Handoff Contract

When an agent requests handoff, the router validates the request and creates a new routing decision:

```json
{
  "handoff_id": "handoff_01J...",
  "from_agent": "reception",
  "requested_target_agent": "sales",
  "approved_target_agent": "sales",
  "reason": "Customer asked for pricing and product-fit guidance.",
  "summary": "Customer wants to know which package fits a 20-person team.",
  "collected_fields": {
    "company_size": "20"
  },
  "missing_fields": [
    "budget",
    "timeline"
  ],
  "status": "approved"
}
```

The platform may override the requested target when policy, confidence, or workspace configuration requires a different destination.

## Normalized Outbound Response

Agents return drafts. The platform approves, renders, and sends:

```json
{
  "response_id": "resp_01J...",
  "conversation_id": "conv_789",
  "agent": "reception",
  "text": "I can help with that. What day works best for your consultation?",
  "format": "plain_text",
  "actions": [
    {
      "type": "calendar.availability.read",
      "status": "completed",
      "audit_id": "audit_123"
    }
  ],
  "handoff_request": null,
  "citations": [
    {
      "knowledge_id": "knowledge.processes.appointment-intake",
      "title": "Appointment Intake Process"
    }
  ]
}
```

## Delivery Rules

- Website chat responses should be concise and can include quick reply buttons when supported.
- Email responses may include fuller context and a subject-preserving reply.
- WhatsApp responses must fit the response window and template requirements.
- Social DM responses must avoid unsupported formatting and respect provider policy.

The outbound renderer must enforce `delivery_constraints` before sending.

## Idempotency And Ordering

- Deduplicate inbound events by `workspace_id`, `channel`, and `provider_event_id`.
- Deduplicate outbound sends by `response_id`.
- Preserve provider ordering when the channel guarantees it.
- If events arrive out of order, route using the latest persisted conversation state and record the ordering anomaly.

## Observability

Each routing decision should be logged with:

- Workspace and conversation IDs.
- Channel and provider.
- Primary and secondary intents.
- Selected agent and confidence.
- Knowledge filters.
- Allowed tools.
- Handoff state.
- Fallback decision.

Logs must be suitable for eval replay without exposing unnecessary private customer data.
