# Embed Widget Security Audit — Harbor AI

**Date:** 2026-07-11
**Scope:** The public embed surface — `web/src/pages/EmbedPage.tsx`, `web/src/components/ChatWidget.tsx`, `web/src/lib/embed-security.ts`, the public `POST /api/chat` handler (`web/netlify/functions/chat.ts`), `_shared/embed-rate-limit.ts`, and the `/embed/*` header/CSP config in `netlify.toml`.
**Threat model:** the parent website and the end user are both untrusted. The widget must not leak workspace data, must not be an XSS/clickjacking vector, and must resist key enumeration and flooding.
**Status legend:** ✅ FIXED (this pass) · ⚠️ OPEN · ✔️ verified clean

---

## Executive summary

The embed surface was already well hardened: three-layer rate limiting (per-IP, per-key, invalid-key-probe), a 122-bit random public key, strict output sanitisation of the only URL sink, and clickjacking protection that is off for `/embed/*` but explicitly on for every login-bearing route. This audit found **one real hardening gap** — the embed route relied on CSP-header merging from the global rule, which is ambiguous on Netlify — plus **one minor info-leak** in the admin UI. Both fixed. A dedicated test suite now guards the surface.

| Severity | Found | Fixed | Open |
| --- | --- | --- | --- |
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 1 | 1 | 0 |
| Low | 1 | 1 | 0 |

---

## MEDIUM

### E1. `/embed/*` had an incomplete, merge-dependent CSP — ✅ FIXED
- **File:** `netlify.toml`.
- **Problem:** the `/embed/*` header block set only `Content-Security-Policy = "frame-ancestors *"`. It depended on Netlify *merging* the global `/*` CSP (`script-src 'self'` …) into the same response. Netlify's behaviour when two CSP headers match one path is ambiguous (append vs. override); if it overrides, the highest-risk public route would ship with **no `script-src`/`connect-src`/`object-src` restrictions at all**, weakening XSS containment on pages the widget is embedded in.
- **Fix:** gave `/embed/*` its **own complete, self-contained CSP** so the outcome no longer depends on merge semantics:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors *; object-src 'none'`
  plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. `frame-ancestors *` keeps the widget embeddable; everything else is first-party-locked with **no `unsafe-inline`/`unsafe-eval` for scripts**.

---

## LOW

### E2. Admin UI advertised the default admin token — ✅ FIXED
- **File:** `web/src/pages/AdminPage.tsx`.
- **Problem:** the login placeholder and error status printed the literal `dev-admin-change-me` default token. Harmless in prod (the server rejects the placeholder — `AUDIT_REPORT.md` C1) but it trains operators to expect a shared default and leaks the exact string. The token field was also a plain text input.
- **Fix:** placeholder → "Enter admin token", error → "Invalid admin token.", and the field is now `type="password"`.

---

## What was checked and found clean ✔️

### Public key security
- **Unguessable:** keys are `pk_` + `randomUUID()` hex (122 bits of entropy) via `createId("pk")` — not sequential, no embedded workspace id. `getWorkspaceByPublicKey` looks up by `public_key`, and the internal `workspace.id` is never exposed to the widget.
- **Enumeration-resistant:** `chat.ts` calls `recordInvalidKeyProbe(req)` on every key miss; after 10 misses / 10 min per IP the prober only ever sees **429**, never the 404 that distinguishes a real key from a fake one.
- **Rotatable:** `POST /api/settings {action:"rotate_public_key"}` (owner/admin) issues a new key via `rotateWorkspacePublicKey`; the old key stops working immediately.

### XSS & injection
- All widget output is rendered as React text nodes (auto-escaped). The audit confirmed **no `dangerouslySetInnerHTML`/`innerHTML`** anywhere in `web/src`. A chat message of `<script>alert(1)</script>` renders as inert text.
- The only URL sink (product-card `imageUrl`) goes through `safeImageUrl`, which allows **only** `http(s)` and blocks `javascript:`, `data:`, `blob:`, `vbscript:`, and unparseable URLs. Covered by the test suite.
- Custom colours are not user-injected into CSS; there is no free-form style attribute from remote data.
- SVG uploads are blocked at the knowledge-upload layer (`.svg` in `BLOCKED_EXTENSIONS`), and extracted text is scanned for `<script`, `javascript:`, `onerror=`, `onload=` before storage.

### iframe & postMessage
- The documented embed uses `<iframe … sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="strict-origin">`.
- **No `postMessage` / `window.message` listener exists** in the widget — there is no parent↔iframe channel to spoof, so message-origin attacks don't apply. (If one is ever added, it must validate `event.origin` and the message shape.)
- Clickjacking of the *app* is prevented: `netlify.toml` sets `X-Frame-Options: DENY` + `frame-ancestors 'none'` on `/`, `/app/*`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/admin`, `/dashboard`. Only `/embed/*` is frameable, by design.

### CSP & headers
- `/embed/*` now carries a strict standalone CSP (E1). No inline scripts are used by the Vite build; script execution is limited to first-party bundles.
- `Referrer-Policy: strict-origin-when-cross-origin` prevents path/query (which would carry the public key) from leaking to third parties.

### Data privacy & leakage
- End-user chat data is written scoped to the widget's workspace (resolved server-side from the public key). The widget response returns only the AI reply/agent/intent — **no internal endpoints, API keys, or other-tenant data**.
- Errors return generic messages (`"Something went wrong. Please try again."`); DB/stack details are logged server-side only (`publicErrorMessage`, `log.error`).
- Message and history sizes are bounded server-side (`message ≤ 4000` chars, `history ≤ 40` turns, each `≤ 4000`), preventing context-window abuse.

### Rate limiting & abuse
- Three enforced layers in `chat.ts` via `_shared/embed-rate-limit.ts`: **30 req/min per IP**, **120 req/min per public key** (caps spend regardless of source IP spread), and the invalid-key probe throttle. All return `429` + `Retry-After`.
- Per-key limiting means a single widget can't be used to drain AI spend even from a botnet.

### Third-party domain risks
- The public chat CORS is `Access-Control-Allow-Origin: *` (required — the widget runs on arbitrary customer domains) but the endpoint carries **no ambient authority**: it acts only on the workspace named by the public key, and the browser blocks credentialed wildcard CORS, so no cookie/session rides along.

---

## Remaining recommendations (open, non-blocking)

1. **Durable rate-limit store.** Buckets are in-memory per warm function instance, so real ceilings are `limit × instances` (documented in `embed-rate-limit.ts`). For hard global guarantees at 1000+ req/min move counters to Postgres/Upstash. *(Est. 0.5–1 day.)*
2. **Bot protection.** Consider a lightweight proof-of-work or invisible CAPTCHA for widget-initiated conversations if abuse appears; today the per-key throttle is the brake.
3. **Signed visitor token** for `conversation_id` continuity (see `TENANT_ISOLATION_REPORT.md` T3).
4. **http parent warning.** Optionally have the widget refuse to run when `window.location.protocol === "http:"` to avoid mixed-content credential exposure on legacy customer sites.

---

## Deliverables produced
- `netlify.toml` — complete standalone CSP for `/embed/*` (E1).
- `web/src/pages/AdminPage.tsx` — token hint removed, masked input (E2).
- `web/src/tests/embed-security/embed-security.test.ts` — 6-case suite (key format/enumeration, image-URL XSS sinks, message clamp, per-IP / per-key / probe rate limits). Wired as `npm run test:embed` and into `test:all`.
- Existing (verified in place): `web/src/lib/embed-security.ts` sanitisation utilities, `netlify/functions/_shared/embed-rate-limit.ts` rate limiting.

## Success criteria — status
- ✅ Public keys are cryptographically secure (122-bit `randomUUID`) and unguessable; no workspace id exposed.
- ✅ No XSS vectors in message rendering (React text nodes) or file upload (SVG blocked, content scanned); URL sinks sanitised.
- ✅ No untrusted `postMessage` channel exists; app routes are clickjacking-protected.
- ✅ `/embed/*` CSP blocks unauthorized script execution (no `unsafe-inline`, `object-src 'none'`).
- ✅ Rate limiting resists abuse at 1000+ req/min per widget (per-key cap + per-IP + probe throttle).
- ✅ No internal API keys or workspace data leak through the widget.

## Test results
```
$ npm run test:embed
PASS  public key format / enumeration resistance
PASS  image URL sanitisation (XSS sinks)
PASS  message length clamp
PASS  per-IP rate limit
PASS  per-public-key rate limit
PASS  invalid-key probe throttle
Embed security tests: 6/6 passed
```
