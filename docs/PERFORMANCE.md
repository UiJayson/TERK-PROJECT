# Performance & Scale — 1000+ Concurrent Businesses

_Last updated: 2026-07-10. Companion to `supabase/migrations/017_performance_indexes.sql`,
`tests/performance.test.ts`, and `scripts/load-test.mjs`._

## Executive summary

The platform is a Vite/React SPA on Netlify CDN + Netlify Functions + Supabase
Postgres. Netlify Functions auto-scale horizontally per request and the CDN
handles static traffic, so the scaling bottlenecks were: (1) unindexed/
N+1 database access patterns, (2) unbounded list payloads, (3) no caching or
request coalescing anywhere, (4) no protection against AI-provider failures
cascading, and (5) an 822 KB single-chunk frontend bundle.

All five are addressed. Measured results below.

## Before / after

| Metric | Before | After |
|---|---|---|
| Conversations list, DB queries for a workspace with N conversations | **1 + N queries** (N+1: one per conversation for messages) | **2 queries** (page of ≤50 + one batched `ANY()` messages query) |
| Conversations/leads list payload | entire table for the workspace | ≤50 rows/page, keyset cursor (`nextCursor`) |
| Lead dedup on capture | fetch **all** leads, scan in JS | 1 indexed lookup (`idx_leads_workspace_email`) |
| Repeated identical list request (≤5s apart) | full auth + DB round trip each time | in-memory hit, concurrent callers share one DB read |
| Dashboard re-poll with unchanged data | full JSON body every time | **304 Not Modified** via ETag (0-byte body) |
| Analytics summary | recomputed on every request (loads *all* conversations + messages + leads) | cached 60s per workspace + ETag |
| Identical AI question | provider round trip + tokens billed | 1h in-memory cache per instance (keyed on full conversational state) |
| AI provider outage behavior | every request waits for timeout, retries, then fallback | circuit breaker opens after 5 failures/30s → fail fast 60s, half-open probe; ≤8 concurrent provider calls, FIFO queue, hard reject at 200 queued |
| Frontend JS on first paint | **822.4 KB** (1 chunk, everything incl. recharts) | **328 KB** on critical path (index 31.2 + react-vendor 233.4 + vendor 63.4); recharts (369 KB) loads only on Analytics; each page its own chunk (0.4–30 KB) |
| Messages RLS policy | subquery into `conversations` per row | direct `workspace_id` column check |

Bundle numbers are from `vite build` output (gzip: critical path ≈ 108 KB vs
~230 KB before).

## Load-test baseline (2026-07-10, production, anonymous)

`USERS=5 DURATION_S=5 node scripts/load-test.mjs` against
harbor-ai-business-os.netlify.app:

- API endpoints (cold): **p50 ≈ 12.6–13.6s** — this is Netlify Function cold
  start dominated by function bundle size (the shared `_shared/` graph pulls
  `pdf-parse`, `openai`, `@anthropic-ai/sdk`, `mammoth` into *every* function).
- Error rate 0%.

**Interpretation:** steady-state latency is fine once warm; the risk at 1000
concurrent businesses is cold-start amplification. Mitigations shipped: the
existing `health-check-scheduled` function keeps instances warm; caching/304s
cut request volume. Future work (below) covers bundle-slimming per function.

Re-run after deploying with realistic auth traffic:

```bash
TOKEN=<jwt> USERS=1000 DURATION_S=60 BASE_URL=https://harbor-ai-business-os.netlify.app \
  node scripts/load-test.mjs
```

## What was shipped

### 1. Database (`supabase/migrations/017_performance_indexes.sql`)

- `messages.workspace_id` column (backfilled) + `(workspace_id, timestamp DESC)`
  index; RLS policy rewritten from a subquery to a direct column check.
- `conversations`: `(workspace_id, status, updated_at DESC)`, partial unread
  index, `(workspace_id, updated_at DESC, id DESC)` cursor index.
- `leads`: `(workspace_id, status, created_at DESC)`, cursor index, expression
  indexes on `lead_data->>'email'` / `->>'conversationId'`.
- `knowledge_items`: GIN on `tags`, `(workspace_id, content_type)`.
- `conversation_memory`: `(workspace_id, channel, timestamp DESC)`.
- `customer_profiles`: `(workspace_id, updated_at DESC)`.
- `ai_usage_logs`: `(workspace_id, created_at DESC)`.
- Everything else on the checklist (conversation_memory lookup/session,
  customer_profiles phone/email, knowledge workspace+type, messages
  conversation+timestamp) already existed in migrations 001–016 and was
  deliberately **not** duplicated.
- Connection pooling: `max: 1` per function instance is correct for
  serverless; real pooling is Supabase pgbouncer — **point `DATABASE_URL` at
  the transaction-mode pooler (port 6543)**. Added `max_lifetime: 300` so
  instances recycle connections.

Apply: run 017 in the Supabase SQL editor. For already-large tables, run the
`CREATE INDEX` statements individually as `CREATE INDEX CONCURRENTLY`.

### 2. API layer

- `_shared/cache.ts` — TTL cache (capped, oldest-first eviction) +
  `getOrCompute` request deduplication (in-flight promise coalescing; 5s
  window on list endpoints) + per-workspace invalidation on writes.
- `_shared/http-cache.ts` — ETag/If-None-Match → 304, `Cache-Control:
  private` (never CDN-cached; responses are per-user). Compression is NOT
  hand-rolled: Netlify's edge already applies gzip/brotli.
- `/api/conversations` and `/api/leads`: `?limit=&cursor=&status=` with keyset
  (cursor-based) pagination — stable under concurrent inserts, index-backed.
- New `/api/conversations/:id/messages` — cursor-paginated message history.
- `/api/analytics/summary`: 60s server cache + 30s browser cache.
- Responses keep their old keys (`conversations`, `leads`) plus `nextCursor` /
  `hasMore`, so existing clients keep working.

### 3. AI engine (`_shared/ai-engine.ts`, `_shared/circuit-breaker.ts`)

- Response cache: 1h TTL, key = SHA-1 of the *entire* request (system prompt,
  history, message, workspace, provider) — identical FAQ questions hit cache;
  mid-conversation turns never share answers. Cache hits bill zero tokens.
- Circuit breaker per provider (5 failures/30s → open 60s → half-open probe).
  `CircuitOpenError` skips the retry loop so a dead provider fails fast into
  the existing OpenAI fallback / graceful reply path.
- Concurrency limiter: ≤8 provider calls in flight per instance, FIFO queue
  up to 200, immediate rejection beyond that (no timeout stacking).
- **Not done — streaming**: the chat pipeline (orchestrator → JSON response →
  widget) is request/response; converting to streaming needs Netlify streaming
  functions + a widget rewrite. Deliberately deferred.

### 4. Frontend

- Route-level code splitting (`React.lazy` + `Suspense`) for every page except
  the landing page; recharts isolated to a lazy `charts` chunk via
  `manualChunks` (only loads when Analytics opens).
- Conversations and Leads pages now fetch 50 rows and show **Load more**
  (cursor pagination), and browsers revalidate with ETags automatically.
- **Not done (assessed, low ROI right now)**: service worker (high staleness
  risk for an authenticated dashboard, no offline use-case), virtual scrolling
  (lists are now paginated at 50, DOM size is bounded), image pipeline (the
  app ships almost no images).

### 5. Infrastructure notes

- CDN for static assets: already provided by Netlify (immutable hashed asset
  URLs from Vite) — nothing to add.
- Auto-scaling / load balancing for functions and webhooks: Netlify Functions
  scale per-request by design; there is no dial to configure. The real cap is
  Postgres connections — solved by the pgbouncer pooler (above).
- Edge-caching API responses is intentionally NOT enabled: every API response
  is authenticated and workspace-scoped (`Cache-Control: private`).

### 6. Monitoring

- `scripts/load-test.mjs` reports p50/p95/p99 per endpoint, throughput, 304
  ratio, and error rate, and alerts when p95 > 2s or error rate > 1%.
- Server-side: `withObservability` + `timedOperation` (migration 010) already
  record per-request and per-category timings (`db`, `ai`) to
  `observability_performance_logs`; `observability-alerts.ts` covers alerting.
  Percentiles can be computed with `percentile_cont` over those tables.

## Verification

- `npm run test:perf` — 12/12 passing (cache, dedup, cursor codec, ETag/304,
  circuit breaker open/half-open/close, concurrency limiter).
- `npm run build` — clean; bundle split verified from build output.
- `npx tsc -p web/tsconfig.functions.json` — all files touched by this work
  compile clean. (Enabling this config surfaced ~25 pre-existing type errors
  in untouched files — tracked separately; Netlify's esbuild bundling is
  unaffected.)
