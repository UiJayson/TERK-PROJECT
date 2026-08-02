# Security Documentation — AI Business OS

**Last updated:** 2026-07-09
**Owner:** Engineering
**Companion doc:** [`AUDIT_REPORT.md`](../AUDIT_REPORT.md) (findings), this file (controls + verification)

This describes the security controls in place, how they are enforced in code, and how to verify them manually. Automated coverage lives in [`tests/security.test.ts`](../tests/security.test.ts) — run `npm run test:security` (34 cases).

---

## 1. Secrets & keys

| Control | Where | Notes |
| --- | --- | --- |
| No hardcoded secrets in code | verified by grep + `config.ts` | Only placeholder patterns exist; real values come from env |
| Env-based config with validation | `_shared/config.ts` | `loadConfig()` throws in production if `AUTH_SECRET`, `DATABASE_URL`, or the active AI provider key are missing |
| Placeholder rejection | `isConfiguredSecret()` | Rejects `change-me`, `your-*`, masked `sk-ant-…x`, sub-8-char values |
| `.env` never committed | `.gitignore` | `.env` and `.env.*` ignored; `!.env.example` explicitly kept |
| `.env.example` uses placeholders only | `.env.example` | No real keys; documents required vs optional |

**Admin token:** In production, an unset/placeholder `ADMIN_TOKEN` resolves to an empty string that **never authorizes** (`resolveAdminToken` in `config.ts`). Comparison is timing-safe (`_shared/admin-auth.ts`).

**Git history scan:** run before any public release —
```bash
# quick pattern scan of history
git log -p --all | grep -nE 'sk-ant-|sk_live_|sk_test_|whsec_|-----BEGIN'
# recommended tools
gitleaks detect --source . --redact
trufflehog git file://. --only-verified
```
This repo is currently `git`-uninitialized locally; run the scan on the canonical remote. If a secret is found in history, **rotate it first**, then purge with `git filter-repo`.

---

## 2. Authentication

| Control | Implementation |
| --- | --- |
| Password hashing | bcrypt, cost factor **12** (`hashPassword` in `auth-crypto.ts`) |
| JWT | HS256, signed with `AUTH_SECRET`, **24h expiry**, `sub`/`workspaceId`/`role`/`sessionVersion` claims |
| Sliding session | `/api/auth/me` re-issues a fresh token each load, so active users stay in while idle tokens expire |
| Session revocation | `sessionVersion` on the user row; incremented on **logout** and **password change**, invalidating all outstanding tokens |
| Logout | `/api/auth/logout` bumps `sessionVersion` server-side (not just cookie clear) |
| Cookie flags | `HttpOnly; SameSite=Lax; Secure` (Secure in production) |
| Brute-force protection | 5 attempts / 15 min per IP on login, register, forgot, reset (`rate-limit.ts`) |
| Auth logging | Success + failure logged; ≥10 failures/hour/IP emits `auth_bruteforce_suspected` (error level) |
| Generic auth errors | Login returns "Invalid email or password" for both unknown user and bad password (no user enumeration) |

**Not yet implemented (roadmap, documented honestly):** TOTP 2FA and OAuth (Google/GitHub) social login. These are larger features requiring UI + schema work; tracked as follow-ups, not claimed as done. See "Roadmap" below.

---

## 3. Authorization (RBAC)

- Roles: `owner` > `admin` > `staff` (rank-based, `_shared/rbac.ts`). A `viewer` tier is on the roadmap; today read-only access is achieved by not granting `admin`.
- Enforcement helpers: `hasMinimumRole`, `canManageAgents/Knowledge/Channels/Settings`, `assertPermission`, `withRole`.
- Every authenticated endpoint calls `requireAuth` / `requireAuthWithWorkspaceAccess`; mutating routes additionally gate on role (e.g. settings PATCH/POST require `owner`/`admin`).
- **Workspace isolation:** all queries scoped by `workspace_id` plus `set_config('app.workspace_id', …)`; covered by `tests/tenant-isolation.test.ts`.
- **UI:** `usePermissions` / role in `AuthContext` hide controls the user can't use — the API is the source of truth, the UI is a convenience layer (never trusted for enforcement).
- **Embed key:** each workspace has a scoped `public_key` (`pk_…`) used only by the chat widget. It is **revocable/rotatable** via `POST /api/settings {action:"rotate_public_key"}` (owner/admin) — the old key stops working immediately.

---

## 4. Input validation

- Chat endpoint bounds every field: message ≤ 4000 chars, history ≤ 40 turns, each turn ≤ 4000 chars, public_key ≤ 100 chars.
- Auth endpoints validate email format + password length; email normalized (trim+lowercase).
- **No NoSQL** in the stack — Postgres only, via postgres.js **parameterized tagged templates** (no string interpolation anywhere; SQL injection structurally prevented).
- **File uploads** (`upload-validation.ts`): extension blocklist, magic-byte verification (PDF `%PDF`, DOCX `PK\x03\x04`), size cap, and content scan for `<script>`, `javascript:`, event handlers, template markers — on both the raw file and extracted text.

---

## 5. Output encoding

- React escapes all interpolated content by default; **no `dangerouslySetInnerHTML` / `innerHTML`** anywhere in `web/src` (verified). This is why DOMPurify is not a dependency — there is no raw-HTML sink to sanitize. If one is ever introduced, add DOMPurify at that call site.
- API responses use `Response.json` (proper JSON escaping).
- CSP restricts script sources (see §6).

---

## 6. Infrastructure security (`netlify.toml`)

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | `script-src 'self'` (no `unsafe-inline` — the Vite build has no inline scripts) |
| `X-Frame-Options` / `frame-ancestors` | `DENY` / `'none'` on all app + auth routes; `frame-ancestors *` on `/embed/*` only (the widget must be embeddable) |

- **CORS:** authenticated dashboard APIs (`auth-http.ts`) echo only the site origin in production (not `*`), with `Allow-Credentials`. The public chat endpoint intentionally uses `*` (no credentials).
- **TLS:** terminated by Netlify (TLS 1.2+, 1.3 preferred). HSTS preload enforces HTTPS.
- **Encryption at rest:** Supabase Postgres encrypts data at rest (AES-256) by default — verify in Supabase dashboard → Settings → Database. Channel credentials (WhatsApp/IG tokens) are additionally app-encrypted via `secret-crypto.ts` before storage.
- **DDoS / edge:** Netlify provides baseline edge protection + CDN. For hardening at scale, front the site with Cloudflare or enable Netlify rate-limiting rules — noted as an infra follow-up.

---

## 7. Monitoring & alerting

- Structured JSON logging (`logger.ts`) with a **redaction layer** (`redact.ts`) that strips emails, phones, tokens, JWTs, passwords, and known secret keys before anything is written. Covered by `tests/logger-redaction.test.ts`.
- Auth attempts (success + failure) logged with IP and user/email.
- Brute-force heuristic emits an error-level `auth_bruteforce_suspected` event at ≥10 failures/hour/IP — wire this to your log alerting (Netlify log drains / Sentry).
- Observability alerts (`observability-alerts.ts`, `alerts.ts`) evaluate operational thresholds; `ADMIN_ALERT_EMAIL` receives them.
- Sentry integration (`lib/sentry.ts`, `_shared/sentry.ts`) captures exceptions when `SENTRY_DSN` is set.

**Note on rate-limit/brute-force state:** counters are in-memory per function instance (serverless). Effective across the fleet but not globally exact, and reset on cold start. For hard guarantees, move counters to Postgres or Redis (roadmap).

---

## Roadmap (explicitly NOT yet implemented)

These items from the hardening request are real work, not one-line changes, and are **not** claimed as complete:

1. **TOTP 2FA for admin accounts** — needs `totp_secret` column, enrollment UI, verification step in login. ~2–3 days.
2. **OAuth (Google/GitHub)** — needs provider apps, callback functions, account-linking logic. ~3–4 days.
3. **`viewer` role** — add to `ROLES`/`ROLE_RANK` and audit each `canX` helper. ~0.5 day.
4. **Distributed rate limiting** — Postgres/Redis-backed counters. ~1 day.
5. **Zod adoption** — current validation is hand-rolled and sufficient; migrating to Zod schemas would improve consistency. ~1 day.

---

## Penetration test checklist (manual verification)

### Authentication
- [ ] Login with valid creds succeeds; invalid returns generic 401 (no user enumeration)
- [ ] 6th login attempt within 15 min from one IP returns 429 + `Retry-After`
- [ ] Register is rate-limited (6th attempt → 429)
- [ ] JWT with tampered payload is rejected (edit a claim, re-request `/api/auth/me`)
- [ ] JWT signed with a different secret is rejected
- [ ] Expired JWT is rejected
- [ ] After logout, the previously-issued token no longer works on `/api/auth/me` (sessionVersion bump)
- [ ] After password change, old sessions are invalidated
- [ ] Session cookie has `HttpOnly`, `SameSite=Lax`, `Secure` (prod) — check DevTools → Application → Cookies

### Authorization
- [ ] `staff` user cannot PATCH `/api/settings` (403)
- [ ] `staff` cannot rotate the public key (403)
- [ ] User from workspace A cannot read workspace B data (swap IDs in requests)
- [ ] Admin endpoints (`/api/admin/*`) reject requests without/with wrong `ADMIN_TOKEN`
- [ ] In production with `ADMIN_TOKEN` unset, admin endpoints are fully disabled

### Injection & input
- [ ] SQLi payloads (`' OR 1=1--`, `'; DROP TABLE`) in login/chat/knowledge have no effect (parameterized)
- [ ] Chat message > 4000 chars → 400
- [ ] Oversized history array → 400
- [ ] Upload `.exe` renamed to `.pdf` → rejected (magic-byte check)
- [ ] Upload > 10MB → rejected
- [ ] Upload containing `<script>` → rejected

### XSS / output
- [ ] Inject `<img src=x onerror=alert(1)>` as a name/message; confirm it renders as text, never executes
- [ ] CSP blocks an injected inline `<script>` (check console for CSP violation)

### Webhooks
- [ ] WhatsApp/Instagram POST with missing/bad `x-hub-signature-256` → 403
- [ ] In production with app secret unset, webhook → 403 (fails closed)
- [ ] Paystack/Stripe webhook with bad signature → 400 (fails closed)

### Infrastructure
- [ ] All security headers present (`curl -I https://<site>/`)
- [ ] `/embed/<key>` is frameable; `/app/*` and `/login` are not (`X-Frame-Options: DENY`)
- [ ] HTTP redirects to HTTPS; HSTS header present
- [ ] CORS: cross-origin request to an authenticated API from a non-site origin is not granted credentials
- [ ] Public chat endpoint returns 429 after 30 requests/min from one IP

### Secrets & logs
- [ ] `git log -p --all | grep -E 'sk-ant-|whsec_'` (or gitleaks) finds nothing
- [ ] Trigger an error and confirm logs contain `[REDACTED]` in place of email/token/password
- [ ] Error responses to clients are generic (no stack traces or internal messages)
