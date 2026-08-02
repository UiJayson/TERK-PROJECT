# Contributing to AI Business OS

## Getting set up

Follow [DEPLOYMENT.md §1](DEPLOYMENT.md#1-local-development-setup). TL;DR: `npm install` at root and in `web/`, copy `.env.example` → `.env`, `npm run dev`.

> **Note:** this working copy is not yet a git repository. Before the PR process below applies, bootstrap it:
>
> ```bash
> git init -b main
> git add -A && git commit -m "Initial import"
> git remote add origin <repo-url> && git push -u origin main
> npx husky init   # activates the pre-commit hook in .husky/
> ```

## Repository layout

```text
agents/          Agent behavior prompts (source of truth — behavior only, no facts)
shared/          Default knowledge + profile seed (facts only, no behavior)
prompts/         System + routing prompts
platform/        Routing contract documentation
knowledge/       Knowledge model documentation
tools/           Tool contract documentation
evals/           Agent behavior evals (npm run eval)
tests/           Cross-cutting test suites (npm run test:all)
scripts/         Ops + build scripts (backup, health check, load test, env sync)
supabase/        SQL migrations (numbered, idempotent)
docs/            Architecture, product, security, ops, user documentation
web/             The product: Vite + React 19 app + Netlify Functions backend
  src/           Frontend (pages, components, styles)
  netlify/functions/          One file per API endpoint
  netlify/functions/_shared/  All backend logic (auth, db, AI engine, stores)
```

**The architecture rule that outranks all others:** agents own behavior (`agents/*/agent.md`), shared knowledge owns facts (`shared/`), platform owns routing/isolation (`_shared/`). Never duplicate a business fact into an agent prompt or routing logic into a channel adapter. See [docs/core-architecture.md](docs/core-architecture.md).

## Coding standards

### TypeScript

- Strict TypeScript everywhere; no `any` unless interfacing with untyped third-party payloads (then type the boundary immediately).
- Backend files import with explicit `.ts` extensions (the functions bundler requires it).
- Typecheck before pushing: `cd web && npx tsc -b` (checks both the app and `tsconfig.functions.json`).

### Backend (Netlify Functions)

Every endpoint follows the same skeleton — copy an existing function (e.g. `leads.ts`) rather than inventing a new shape:

1. `OPTIONS` → `optionsResponse()`.
2. Auth: `requireAuthWithWorkspaceAccess(req)`; role-gate writes with `withRole(auth, ["owner", "admin"])`.
3. Validate and **bound** every user-supplied field (length limits, enum checks) — see `chat.ts` for the pattern.
4. Errors: `jsonResponse({ error: "…" }, { status })`; sentinel errors as thrown `Error("SCREAMING_SNAKE")` mapped to friendly messages in the catch block.
5. `export const config: Config = { path: "/api/…" }` and `export default withObservability(handler)`.

Hard rules:

- **Workspace isolation is non-negotiable.** Every query filters by `workspace_id` from the *session*, never from the request body. `npm run test:tenant` must stay green.
- **No query fragments.** The db client executes template literals eagerly; dynamic filters are written as explicit branches (see `_shared/db.ts`).
- **Cache invalidation:** any write to conversations/leads/knowledge must call `invalidateWorkspaceCaches(workspaceId)`.
- **Logging:** use `log.info/warn/error` from `_shared/logger.ts` with event-style names (`auth_login_failed`); never log secrets or message bodies (redaction is tested by `npm run test:logging`).
- New env vars go through `_shared/config.ts` *and* get documented in `.env.example`.

### Frontend

- Design tokens come from `web/src/styles/tokens.css` only — blue `#2563EB` is the sole accent; never define `--dash-*` variables elsewhere.
- Data fetching through the existing API client in `web/src/api/`; new endpoints get a typed wrapper there.
- Keep pages working in dev preview mode (`web/src/dev/mockApi.ts`) — add mock handlers for new endpoints.

### Comments & docs

- Comment *why*, not *what*; match the density of the file you're editing.
- API changes update **API.md + docs/api/openapi.yaml** in the same PR.
- Schema changes ship as a new numbered idempotent migration in `supabase/migrations/` — never edit an applied migration.

## Tests

| Command | Scope | When required |
| --- | --- | --- |
| `npm run test:security` | Authz, headers, input bounds | Any backend change |
| `npm run test:tenant` | Workspace isolation | Any db.ts / store change |
| `npm run test:logging` | Log redaction | Logging changes |
| `npm run test:perf` | Perf regressions | Cache/pagination changes |
| `npm run eval` | Agent routing/behavior | Prompt or routing changes |

`npm run test:all` runs the first four. Add tests alongside new behavior — endpoints with auth, at minimum: 401 without session, 403 for staff on writes, and cross-workspace denial.

## Pre-commit hook

[.husky/pre-commit](.husky/pre-commit) runs the TypeScript build check on every commit (activate with `npx husky init` after `git init`). Don't bypass with `--no-verify`; if the hook fails, fix the type error.

## PR process

1. Branch from `main`: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
2. Keep PRs to one concern. Schema migration + code that uses it belong together; refactors ship separately from behavior changes.
3. Before opening: `npm run test:all` and `npm run build` locally.
4. PR description: what changed, why, how it was verified (paste test output), any env-var or migration steps for the deployer.
5. CI must pass (typecheck, tests, security scan, build — see [.github/workflows/ci.yml](.github/workflows/ci.yml)).
6. One approving review required. Squash-merge with a conventional-commit title (`feat: …`, `fix: …`).
7. Merge to `main` auto-deploys **staging**; production ships by tagging a release: `git tag v0.2.0 && git push --tags`.

## Commit messages

Conventional commits: `type(scope): imperative summary` — e.g. `fix(chat): bound history length to 40 turns`. Body explains why when non-obvious.

## Security

Never commit secrets (`.env` is gitignored — keep it that way). Report vulnerabilities privately to the maintainer, not via public issues. Security posture and threat model: [docs/security.md](docs/security.md).
