# Backup & Disaster Recovery

What can be lost, how it's protected, and exactly how to get it back.

## What state lives where

| State | Location | Loss impact | Protection |
| --- | --- | --- | --- |
| All customer data (users, workspaces, conversations, leads, knowledge, billing state) | Supabase Postgres | **Critical** | Supabase automated backups + our off-platform `pg_dump` |
| Code, prompts, default knowledge, migrations | Git repository | Rebuildable | Git remote (GitHub) |
| Deployed site + functions | Netlify | None — redeploy from repo | Netlify keeps immutable deploy history |
| Environment variables / secrets | Netlify site settings | Painful | Encrypted copy of `.env` in the team password manager — **keep it current when adding vars** |
| Subscriptions / payment records | Stripe & Paystack (they are the source of truth) | Recoverable from provider | Provider-side; our DB mirrors state via webhooks |
| Uploaded documents | Extracted text stored in Postgres (originals are not retained) | Covered by DB backup | — |

**Single point of truth: the database.** Everything else is rebuildable from the repo + provider dashboards.

## Backups

### Layer 1 — Supabase automated backups

Supabase Pro takes **daily automated backups** (7-day retention) and offers **PITR** (point-in-time recovery, up to the retention window) as an add-on. Verify in *Supabase → Project → Database → Backups* that the plan actually has these enabled — the free tier does **not** include them, which makes Layer 2 mandatory.

### Layer 2 — Off-platform daily dump (ours)

```bash
npm run backup:db          # → backups/aios-<timestamp>.dump (pg_dump custom format)
```

- Retention: newest 14 by default (`BACKUP_KEEP` env to change).
- Schedule it daily off the production machine — e.g. a GitHub Actions scheduled workflow with `DATABASE_URL` as a secret, uploading the dump to private object storage; or Windows Task Scheduler / cron on an ops box.
- **Store dumps encrypted and off-site** (they contain all customer data).

### Backup verification (monthly drill)

A backup you haven't restored is a hope, not a backup. Monthly:

1. Create a scratch Postgres database (local or a throwaway Supabase project).
2. `pg_restore --clean --if-exists -d "<scratch-url>" backups/<latest>.dump`
3. Sanity queries: `SELECT count(*) FROM workspaces;` / `conversations` / `leads` — compare against production dashboards.
4. Log the drill (date, file, counts, who ran it) in the ops journal.

## Point-in-time recovery

Use when data was corrupted/deleted at a known moment (bad migration, bad script, malicious action) rather than lost wholesale.

**With Supabase PITR enabled:** *Dashboard → Database → Backups → Point in time* → choose the timestamp just **before** the incident → restore. Supabase restores in place; expect minutes of downtime. Everything written *after* that timestamp is lost — export any post-incident writes you need first (`pg_dump` selected tables before restoring).

**Without PITR:** restore the newest good daily dump (below). RPO is up to 24 h — this is the accepted trade-off until PITR is enabled.

## Disaster recovery runbook

Targets: **RPO ≤ 24 h** (daily dumps; ≤ minutes with PITR), **RTO ≤ 4 h** for full-region loss.

### Scenario A — Database lost or unusable (Supabase project deleted/corrupted/region down)

1. **Declare** the incident (see [runbook.md](runbook.md#escalation)); note the time.
2. **Freeze writes:** in Netlify, set env `DATABASE_URL` to empty and redeploy *or* pause the site — a clearly-down site beats one silently writing to nowhere.
3. **New database:** create a Supabase project (same region or fallback).
4. **Schema:** run all files in `supabase/migrations/` in numeric order (SQL Editor or `supabase db push`). They are idempotent.
5. **Data:** `pg_restore --clean --if-exists -d "<new-pooler-url>" backups/<latest>.dump`
   (use the **transaction pooler URL, port 6543** everywhere).
6. **Repoint:** update `DATABASE_URL` in Netlify env → redeploy.
7. **Verify:** `node scripts/health-check.mjs <site-url>`, then log in, open Conversations, send a test agent message.
8. **Announce** recovery + data-loss window (time of last backup → incident) to affected customers.

### Scenario B — Netlify site lost (account/site deleted, platform outage)

1. Create a new Netlify site; connect the repo (or `netlify deploy --build --prod` from a checkout).
2. Restore env vars from the password-manager copy (`scripts/sync-netlify-env.mjs` helps).
3. Re-point DNS (CNAME/A records — see DEPLOYMENT.md §6); SSL re-issues automatically.
4. Update webhook URLs at Stripe/Paystack/Meta if the domain changed.
5. Health-check + smoke test.

### Scenario C — Secrets compromised

1. Rotate in this order: `AUTH_SECRET` (kills all sessions **and** stored channel-token decryption — customers must re-enter WhatsApp/Instagram tokens), database password (Supabase → Settings → Database), AI provider keys, Stripe/Paystack keys + webhook secrets, `ADMIN_TOKEN`.
2. Redeploy after each Netlify env change.
3. Audit: Supabase logs, Netlify function logs, Stripe events for the exposure window.
4. Disclose per your obligations if customer data was reachable.

### Scenario D — Bad deploy or bad migration

- **Bad deploy:** Netlify → Deploys → publish the previous deploy (instant, no data touched).
- **Bad migration:** migrations are additive/idempotent by convention, so prefer a *forward* fix (new migration reverting the change). If data was damaged: PITR to just before the migration, or restore Scenario-A style.

## Customer data export

For GDPR/portability requests or offboarding:

```bash
npm run export:workspace -- <workspaceId>
# → exports/<workspaceId>-<date>.json
```

Includes users (no password hashes), agents config, business profile, knowledge, conversations, messages, and leads. Excludes our operational secrets (channel tokens). Deliver via a secure channel, never email attachment. For **deletion** requests: after export, `DELETE FROM workspaces WHERE id = '<id>'` cascades to all child tables (verify counts before/after, then confirm to the customer in writing).
