# Tool Contracts

## Purpose

Tools expose external system capabilities to agents through platform-mediated adapters. Agents never call provider SDKs directly. The platform policy engine validates every tool request against the agent tool access matrix in `agents/boundaries.md`.

## Design Rules

- Tools return structured results with `success`, `failure`, `retry`, or `permission_denied` states.
- Every write requires an idempotency key and creates an audit record.
- Tools contain no agent prompts and no durable business facts.
- Tool adapters do not make routing decisions.

## Registered Tools

| Tool ID | Description | Used By |
| --- | --- | --- |
| `knowledge.search` | Retrieve approved shared knowledge snippets | Reception, Sales, Marketing |
| `crm.contact.read` | Look up a contact by email, phone, or external ID | Reception (limited), Sales |
| `crm.contact.write` | Create or update a contact | Sales |
| `crm.opportunity.read` | Read opportunity or pipeline stage | Sales |
| `crm.opportunity.write` | Create or update opportunities and activities | Sales |
| `calendar.availability.read` | Check open slots for booking | Reception, Sales |
| `calendar.booking.create_pending` | Create a pending appointment request | Reception |
| `calendar.booking.create_sales` | Book a sales call or demo | Sales |
| `email.draft.create` | Draft an email for platform review | Reception, Sales, Marketing |
| `email.send` | Send a platform-approved email | Platform-mediated only |
| `analytics.read` | Read marketing or sales-attribution summaries | Sales (attribution), Marketing |
| `messaging.reply.draft` | Draft a channel reply for platform delivery | Reception, Sales |
| `messaging.send` | Send a platform-approved channel message | Platform-mediated only |

## Tool Request Shape

Every tool call from an agent must include:

```json
{
  "request_id": "tool_req_01J...",
  "workspace_id": "workspace_123",
  "conversation_id": "conv_789",
  "agent": "reception",
  "tool": "calendar.availability.read",
  "idempotency_key": "idem_01J...",
  "parameters": {
    "date_range_start": "2026-07-01",
    "date_range_end": "2026-07-07",
    "appointment_type": "consultation"
  }
}
```

## Tool Result Shape

```json
{
  "request_id": "tool_req_01J...",
  "status": "success",
  "audit_id": "audit_456",
  "data": {
    "available_slots": [
      {
        "start": "2026-07-02T10:00:00Z",
        "end": "2026-07-02T10:30:00Z"
      }
    ]
  },
  "error": null
}
```

## Permission Denial

When an agent requests a tool outside its allowed set, the platform returns:

```json
{
  "request_id": "tool_req_01J...",
  "status": "permission_denied",
  "audit_id": "audit_457",
  "data": null,
  "error": {
    "code": "tool_not_allowed_for_agent",
    "message": "Marketing cannot call calendar.booking.create_pending."
  }
}
```

Boundary evals must verify that forbidden tool requests are blocked. See `evals/fixtures/boundary/`.

## Related Documents

- Agent tool access matrix: `agents/boundaries.md`
- Routing allowed_tools field: `platform/routing-contract.md`
- Architecture boundaries: `docs/core-architecture.md`
