# Shared Knowledge Model

## Purpose

Shared knowledge is the single source of truth for reusable company facts. Reception, Sales, and Marketing all retrieve from this system instead of storing business facts in their own prompts.

## Phase 1 authoring (`shared/`)

For the sample web app and first agent build, edit human-readable facts in `shared/`:

| File | Maps to category |
| --- | --- |
| `shared/company.md` | Company |
| `shared/products.md` | Products and services |
| `shared/pricing.md` | Pricing |
| `shared/faq.md` | FAQs |
| `shared/brand_voice.md` | Brand voice |
| `shared/policies.md` | Policies |
| `shared/sops.md` | Processes |

At scale, these files are indexed into the knowledge item schema below. Do not duplicate the same facts in agent prompts.

## Ownership Principle

Store a fact once at the most reusable layer:

- Shared knowledge: durable business facts used by more than one workflow.
- Agent-specific files: behavior rules for one role.
- Platform files: routing, permissions, workflow state, identity, billing, and integration configuration.
- Tool records: external system data such as CRM contacts, calendar events, email threads, and analytics reports.

If a fact would be wrong or risky when copied into two agent prompts, it belongs here.

## Knowledge Item Schema

Every knowledge item should be represented with the following fields before it is indexed for retrieval:

```yaml
id: knowledge.products.primary-service
title: Primary Service
category: products
workspace_id: workspace_123
owner: operations
status: approved
visibility:
  agents:
    - reception
    - sales
    - marketing
  channels:
    - website_chat
    - email
    - whatsapp
    - social_dm
source:
  type: internal_document
  uri: docs://company/services
  last_verified_at: 2026-06-30
freshness:
  review_interval_days: 30
  expires_at: null
content:
  summary: Short answer safe for agent use.
  details: Longer canonical explanation.
  constraints:
    - Conditions, exclusions, or caveats.
approved_claims:
  - Claim that can be used in customer-facing responses.
forbidden_claims:
  - Claim that agents must not make.
tags:
  - service
  - pricing-relevant
```

## Required Fields

- `id`: Stable unique identifier used by retrieval, citations, and tests.
- `title`: Human-readable label.
- `category`: One of the approved knowledge categories.
- `workspace_id`: Tenant or workspace owner.
- `owner`: Business owner responsible for correctness.
- `status`: Draft, approved, archived, or expired.
- `visibility`: Which agents and channels may use the item.
- `source`: Where the fact came from.
- `last_verified_at`: Last date the owner confirmed the fact.
- `content`: Canonical summary and details.
- `constraints`: Conditions that prevent overbroad answers.

## Knowledge Categories

### Company

Durable business identity facts:

- Company name, description, locations, service area, opening hours.
- Contact methods and escalation contacts.
- Legal disclaimers, guarantees, and compliance statements.

### Products And Services

Reusable offering details:

- Product and service descriptions.
- Features, plans, packages, and eligibility.
- Comparison points and fit criteria.
- Service limitations and exclusions.

### Pricing

Approved pricing facts:

- Public prices, quote ranges, discounts, fees, and billing cadence.
- Price conditions, exclusions, and approval requirements.
- Rules for when Sales must quote versus when an agent may answer directly.

Pricing must include explicit permission metadata. If `can_quote_directly` is false, agents must route to Sales or request human approval.

### FAQs

Common customer questions with approved answers:

- Buying questions.
- Admin questions.
- Appointment questions.
- Basic support questions.

FAQs may link to product, pricing, policy, or process items instead of duplicating details.

### Policies

Rules that constrain commitments:

- Refunds, cancellations, privacy, data use, delivery, shipping, appointment changes, and support scope.
- Escalation thresholds and required human review cases.

### Brand Voice

Approved messaging guidance:

- Tone, vocabulary, phrasing examples, words to avoid, and compliance-safe claims.
- Audience-specific voice guidance.
- Campaign-level messaging only when approved for reuse.

### Processes

Repeatable operational facts:

- Appointment intake requirements.
- Lead qualification stages.
- Handoff requirements.
- Follow-up timing.

Process facts describe what must happen. Agent files describe how a specific agent behaves while doing it.

## Folder Structure

```text
knowledge/
  README.md
  company/
  products/
  pricing/
  faqs/
  policies/
  brand-voice/
  processes/
  sources/
```

Each category folder should contain workspace-scoped knowledge files when implementation begins. The `sources/` folder should contain source registry records that map knowledge items back to documents, websites, policy owners, or imported data feeds.

## Feature Placement Checklist

Before adding any new content, classify it:

| If the content is... | Put it in... |
| --- | --- |
| A durable business fact used by more than one workflow | Shared knowledge (`knowledge/`) |
| A behavior rule for one agent role | Agent-specific file (`agents/reception/`, `agents/sales/`, `agents/marketing/`) |
| Routing, permissions, billing, or channel handling | Platform (`platform/`) |
| Live data from CRM, calendar, or analytics | Tool records via platform adapters (`tools/`) |

## Duplication Rules

- Agent prompts may reference knowledge IDs, categories, and retrieval instructions, but they must not duplicate product, pricing, policy, FAQ, or brand facts.
- If two agents need the same detail, move the detail into shared knowledge.
- If a knowledge item links to another item, summarize only the relationship and keep the canonical fact in one place.
- If a fact changes often, store it as a structured field with owner and freshness metadata.
- If a fact comes from an external system of record, store a pointer and retrieval rule rather than a stale copy.

## Review States

- `draft`: Visible to reviewers only, not used in customer-facing responses.
- `approved`: Available for agent retrieval and customer-facing use.
- `expired`: Blocked from customer-facing use until reviewed.
- `archived`: Preserved for history, not retrieved by agents.

Agents should not use draft, expired, or archived items unless the platform explicitly invokes an internal review workflow.

## Retrieval Contract

For each agent turn, the platform should retrieve knowledge using:

- Workspace ID.
- Conversation language and channel.
- Current agent role.
- User intent and extracted entities.
- Conversation stage.
- Permission filters.
- Knowledge status and freshness filters.

Retrieved snippets should include:

- `knowledge_id`.
- `title`.
- `category`.
- `summary`.
- `relevant_details`.
- `constraints`.
- `source_uri`.
- `last_verified_at`.

## Conflict Handling

When two approved items conflict:

1. Prefer the item with the more specific category and matching workspace.
2. Prefer the item with the newest `last_verified_at` date.
3. If still ambiguous, the agent must not invent a resolution.
4. The platform should create a knowledge review task for the owning team.

## Missing Knowledge Behavior

If the user asks for a durable business fact that is missing:

- Reception should acknowledge the gap and collect contact or appointment context when useful.
- Sales should ask a qualifying follow-up or offer to confirm details before making a commitment.
- Marketing should mark the claim as needing source approval before using it in campaign copy.

No agent should fill missing business facts from general model knowledge.
