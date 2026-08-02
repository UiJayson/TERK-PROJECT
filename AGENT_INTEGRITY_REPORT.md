# Agent Brain & Memory Integrity Report

**Audit date:** 2026-07-13  
**Scope:** Receptionist, Sales, Marketing agents — memory, RAG, boundaries, handoffs, prompts, reliability.

---

## Executive summary

The agent pipeline (`ai-runtime.ts` → `orchestrator.ts` → `ai-engine.ts`) was audited end-to-end. Critical gaps were fixed:

| Area | Before | After |
|------|--------|-------|
| RAG at chat time | Keyword-only; vector index unused | Hybrid semantic + keyword via `knowledge-retrieval.ts` |
| Empty retrieval | Blocked full Company Brain fallback | Falls back to agent `shared/` knowledge files |
| Memory window | 10 messages (~5 turns) | 24 messages (~12 turns) |
| Role boundaries | Prompt-only | Prompt + `agent-boundaries.ts` post-check |
| Marketing routing | Could capture bare greetings | Requires explicit campaign/content intent |
| Handoffs | Working; max 3/session | Unchanged; tests added |

---

## 1. Conversation memory & context retention

### Architecture

- **Storage:** `conversation_memory` + `customer_profiles` (Postgres, workspace-scoped RLS)
- **Load path:** `loadMemoryContext()` — profile, recent messages, rolled summary, total count
- **Persist path:** `persistTurn()` after each turn with `metadata.agent` and `metadata.intent`
- **Threading:** `resolveCustomerId()` scopes IDs as `{workspaceId}:phone:{digits}` etc. — no cross-workspace leakage

### Test results

| Test | Result |
|------|--------|
| Same phone, different workspaces → different customer IDs | **PASS** (`memory-test.ts`) |
| Email identity case-insensitive | **PASS** |
| Channel-isolated session IDs | **PASS** |
| "What did I just say?" — recent transcript in prompt | **PASS** |
| Long history — summary + recent turns both present | **PASS** |
| System/handoff messages excluded from LLM history | **PASS** |
| 12+ turn retention (24 message window) | **PASS** (config updated) |

### Fixes applied

- `RECENT_FETCH_DEFAULT` increased from 10 → **24** messages
- `loadMemoryContext` calls pass `recentLimit: 24` explicitly in `ai-runtime.ts`
- Summary rolling remains truncation-based (not LLM summarization) — documented as future enhancement

### Known limitations

- Anonymous first messages skip DB memory until `conversationId` is created post-turn
- WhatsApp maintains a parallel 20-message session slice — Postgres memory is authoritative when loaded

---

## 2. Company Brain (RAG) integration

### Pipeline (after fix)

```
User message
  → retrieveKnowledgeForQuery()     [knowledge-retrieval.ts]
      ├─ semanticSearch()             [embeddings.ts — pgvector]
      └─ keywordSearch()              [knowledge.ts]
  → merge, dedupe, score, trim to 12k chars
  → buildMessages()                   [orchestrator.ts]
      ├─ if results > 0: formatKnowledgeForPrompt()
      └─ else: loadKnowledgeForAgent() full shared files
```

### Test results

| Test | Result |
|------|--------|
| Keyword extraction (stop words, dedup) | **PASS** (`rag-test.ts`) |
| Chunking at paragraph/sentence boundaries | **PASS** |
| 2000-char window + 200-char overlap | **PASS** |
| Anti-hallucination empty-state messaging | **PASS** |
| Semantic chunk source citation | **PASS** |
| Context budget trimming | **PASS** |

### Fixes applied

- New `knowledge-retrieval.ts` — hybrid retrieval with `MIN_SEMANTIC_SCORE = 0.68`
- `ai-runtime.ts` wired to hybrid retrieval (was keyword-only)
- `buildMessages()` falls back to full agent knowledge when retrieval returns empty
- `MAX_CONTEXT_CHARS = 12_000` prevents context stuffing

---

## 3. Agent role boundaries & handoffs

### Boundary matrix (enforced in prompts + post-check)

| Agent | Allowed | Forbidden (must hand off) |
|-------|---------|---------------------------|
| Reception | Greet, FAQ, qualify, schedule | Sell, close, campaign content, payments |
| Sales | Pitch, objections, close | Support tickets, refunds, general booking |
| Marketing | Drafts, lead capture, campaigns | Transactions, appointments, publishing |

### Test results

| Test | Result |
|------|--------|
| Reception blocks payment confirmation language | **PASS** (`boundary-test.ts`) |
| Sales blocks support/refund handling | **PASS** |
| Marketing blocks transaction language | **PASS** |
| Prompt-injection echo detection | **PASS** |
| Greeting → Reception | **PASS** (`handoff-test.ts`) |
| Pricing → Sales | **PASS** |
| Bare "Hi" does not route to Marketing | **PASS** |
| Sticky sales conversation | **PASS** |
| Legal/refund → human_review | **PASS** |
| Max 3 handoffs per session | **PASS** (existing `handoffConversation`) |
| `normalizeHandoff` validation | **PASS** |

### Fixes applied

- New `agent-boundaries.ts` with `detectBoundaryViolation()` — triggers safe reply + handoff suggestion
- Marketing inbound routing tightened in `routeMessage()`
- System prompts already include injection resistance (`prompts/system.md`) — verified

---

## 4. Prompt engineering quality

| Check | Status |
|-------|--------|
| Shared system prompt with injection resistance | **OK** |
| Per-agent role boundaries in `agent.md` | **OK** (updated with memory + boundary sections) |
| "I don't know" behavior | **OK** — explicit in system + retrieval empty states |
| Date awareness | **OK** — `Current date: YYYY-MM-DD` injected per turn |
| JSON output schema | **OK** |
| Confidence field | **OK** — used for escalation |

---

## 5. Performance & reliability

| Check | Status |
|-------|--------|
| LLM timeout | 20s per provider (`ai-engine.ts`) |
| Retry | 1 retry on primary; Anthropic → OpenAI fallback |
| Circuit breaker | 5 failures / 30s → 60s open |
| Concurrency limit | 8 in-flight, queue 100 |
| Response cache | SHA1 prompt hash, 1h TTL |
| Graceful degradation | `getGracefulAIErrorReply()` on final failure |
| Demo mode | When no AI provider configured |

### Target latency

| Query type | Target | Notes |
|------------|--------|-------|
| Simple (no RAG hit) | < 3s | Memory + routing only |
| RAG query | < 8s | + embedding call (~200–500ms) + vector search |

---

## Test suite

Run all agent integrity tests:

```bash
npx tsx web/src/lib/agent-tests/memory-test.ts
npx tsx web/src/lib/agent-tests/rag-test.ts
npx tsx web/src/lib/agent-tests/boundary-test.ts
npx tsx web/src/lib/agent-tests/handoff-test.ts
```

---

## Files changed

| File | Change |
|------|--------|
| `knowledge-retrieval.ts` | **NEW** — hybrid RAG |
| `agent-boundaries.ts` | **NEW** — post-generation boundary check |
| `ai-runtime.ts` | Hybrid RAG, boundary enforcement, memory limit |
| `orchestrator.ts` | Knowledge fallback, marketing routing |
| `memory.ts` | 24-message window |
| `agent.md` (×3) | Boundary + memory instructions |
| `agent-tests/*.ts` | memory, rag, boundary, handoff tests |

---

## Remaining recommendations

1. **LLM-based summary rolling** — replace truncation in `maybeRollSummary()` for threads > 50 messages
2. **Programmatic citation validation** — verify `citations` match retrieved chunks
3. **Parallel embedding batch** — `generateEmbeddings()` is sequential; batch for large reindexes
4. **Unify demo vs production routers** — `router.ts` vs `orchestrator.routeMessage()` still diverge on demo path
