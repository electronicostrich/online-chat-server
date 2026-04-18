# CLAUDE.md — Online Chat Server

This file is the entry point for every Claude Code session working in this repository. Read it in full before making any changes. If a rule in this file conflicts with your global `~/.claude/CLAUDE.md`, raise the conflict with the user rather than silently choosing.

## 1. What this project is

A self-contained online chat server (rooms, direct messages, presence, attachments, sessions). MVP runs locally via Docker Compose. No cloud deployment in scope yet.

The project has been designed almost entirely in documentation before any code was written. The `docs/` tree is comprehensive and authoritative. Your job is to implement from it, not to invent alongside it.

## 2. Who writes the code

Nearly all code in this repo is written by AI (you). The human working with you is a **Product Owner, not a developer**. You cannot defer judgment on code quality to them — they will trust what you produce unless another AI session, CI, or a dev-lead reviewer catches an issue.

This raises the stakes on:

- Reading docs first, always.
- Following the guardrails in `docs/ai-development-guardrails.md` strictly.
- Stopping to ask when the task crosses into product decisions.

## 3. Hard constraints — read these FIRST, always

If your context is tight and you can only read three things, read:

1. **§6 of this file** (hard constraints)
2. **`docs/ai-development-guardrails.md` §5 and §11** (rules + enforcement matrix)
3. **The `docs/traceability.md` rows** for the AC(s) you're implementing

These three items are the fail-safe minimum. Everything else in §4 below is important, but if you know only the above and hit a gap, you will stop and ask rather than silently invent.

## 4. Reading order (first time or after long gap)

Spend 15 minutes reading these in order before you touch anything:

1. `docs/README.md` — doc map
2. `docs/product-requirements.md` — what the product is
3. `docs/requirements-decisions.md` — frozen product rules
4. `docs/architecture-overview.md` — system shape
5. `docs/adr/ADR-009-typescript-node-fastify-react-stack.md` — stack
6. `docs/adr/ADR-010-typebox-as-schema-source-of-truth.md` — contract discipline
7. `docs/adr/ADR-011-drizzle-orm-and-migration-strategy.md` — persistence
8. `docs/repo-layout.md` — where files go
9. `docs/ai-development-guardrails.md` — the rules you must follow
10. `docs/git-workflow.md` — branching, commits, release gates
11. `docs/hooks.md` — the three-layer enforcement (what will block you and why)
12. `docs/traceability.md` — the AC-to-code map (the anti-drift keystone)
13. `docs/stage-0-bootstrap.md` — if the repo has no code yet, this is your Stage-0 target

Then, for your specific task, read:

- The AC rows you're implementing from `docs/acceptance-criteria-pack.md` and `docs/traceability.md`
- The relevant section of `docs/api-and-events.md`, `docs/data-model.md`, `docs/state-model.md`, `docs/permissions-matrix.md`

## 5. Tech stack quick reference

| Layer | Choice | Doc reference |
|---|---|---|
| Language | TypeScript strict | ADR-009 |
| Backend runtime | Node 24 LTS | ADR-009 |
| HTTP framework | Fastify | ADR-009 |
| Schema source of truth | **TypeBox** (not Zod) | ADR-010 |
| ORM / migrations | **Drizzle** | ADR-011 |
| Frontend | React 19 + Vite 8 | ADR-009 |
| Server-state | TanStack Query v5 | ADR-009 |
| Unit/integration tests | Vitest | `docs/testing-strategy.md` |
| E2E tests | **Playwright** | `docs/testing-strategy.md` |
| Package manager | **pnpm workspaces** | `docs/repo-layout.md` |
| CI | **GitHub Actions** | `docs/ci-pipeline.md` |

## 6. Hard constraints

These are merge-blocking. Do not bypass them, do not ask the PO to bypass them. Every one is enforced by at least one layer (Claude Code hook, pre-commit, or CI) — see `docs/hooks.md` §2.1 for the matrix.

- **No `as any` / `as unknown as`** on new lines. Use proper types.
- **No `@ts-ignore`, `@ts-nocheck`.** `@ts-expect-error` is allowed with a 10+ char description.
- **No net-new `eslint-disable*`** without an issue link.
- **No `zod`, `yup`, `joi`, `ajv`** imports. TypeBox only (ADR-010).
- **No schema changes without** a migration file AND `docs/data-model.md` update in the same PR.
- **No new API endpoint without** a TypeBox schema in `packages/shared-schemas` AND a row in `docs/traceability.md`.
- **No commit or push with `--no-verify`.** The Bash hook blocks it; branch protection rejects it.
- **No force push to `main` or `develop`.**
- **No `.skip` or `.only`** committed in tests.
- **No `console.*` in `apps/api/src/**`.** Use the Pino logger.
- **No bare `TODO:` / `FIXME:`.** Use `TODO(#N): ...` with an issue number.
- **No destructive SQL** (`DROP TABLE`, `TRUNCATE`, `DROP COLUMN`) outside `apps/api/test/` paths without PO sign-off in the PR description.
- **No merging to `main` from anywhere except `develop`** (or `fix/hotfix-*` in emergencies — see `docs/git-workflow.md` §8).
- **Every PR references at least one AC ID** (or is tagged `chore:` / `fix:` / `doc:` / `infra:` / `spike:` per `docs/git-workflow.md` §4.1).

## 7. Before you write code — mandatory checklist

Every change you author MUST:

- [ ] Map to at least one AC ID in `docs/traceability.md` (or be tagged `chore:` / `fix:` / `doc:` / `infra:` / `spike:`)
- [ ] Have read the relevant doc section(s) for the ACs you're touching
- [ ] Start with a Playwright test (`AC-<ID>-<slug>.spec.ts`) if implementing an AC — test-first per `docs/ai-development-guardrails.md` §3
- [ ] Use existing utilities before writing new ones (grep first; don't duplicate)
- [ ] Follow the repo layout in `docs/repo-layout.md` — no new top-level dirs
- [ ] Be on a branch named `feature/AC-<ID>-<slug>` (or `fix/*`, `chore/*`, etc.) targeting `develop` — see `docs/git-workflow.md` §3

## 8. When to stop and ask

Stop the session and ask the PO when:

- A DB schema change isn't obviously covered by existing documentation
- Fixing a bug would require changing an AC (AC is wrong, or impl is wrong-but-accepted)
- Two plausible designs with downstream architectural impact both fit
- A new ADR or workstream seems warranted
- You hit a merge conflict during rebase (`docs/git-workflow.md` §9 — never auto-resolve)
- A hook blocks you and fixing the root cause would require touching `.claude/settings.json` or `lefthook.yml`

Also stop and re-read `docs/traceability.md` if your session has been running for >90 minutes or >20 tool calls since you last read it (`docs/ai-development-guardrails.md` §7.1).

## 9. Commands cheat sheet

```
# First-time setup
pnpm install
cp .env.example .env.local      # then fill secrets
docker compose up -d

# Development (daily)
pnpm --filter api dev           # Fastify with hot reload
pnpm --filter web dev           # Vite dev server

# Tests
pnpm typecheck                  # whole repo
pnpm lint
pnpm test                       # unit + integration
pnpm e2e                        # Playwright (needs compose up)
pnpm e2e AC-AUTH-01             # filter by AC prefix

# DB
pnpm --filter api db:generate   # create migration from schema code
pnpm --filter api db:migrate    # apply migrations
pnpm --filter api db:seed       # seed dev data

# Doc consistency
pnpm doc-consistency            # traceability + schema checks
pnpm schema-drift               # Drizzle code ↔ migrations
```

Details: `docs/runtime-and-environment.md`, `docs/ci-pipeline.md`.

## 10. PR conventions

Every PR title: `AC-<ID>: short summary` (or `chore:` / `fix:` / `doc:` / `infra:` / `spike:`).

Every PR description uses `.github/pull_request_template.md`:

- **Summary** — one paragraph, WHY not WHAT
- **AC IDs addressed** — links to `docs/traceability.md` rows
- **Docs updated** — checklist of every doc file touched (or "no doc changes because …")
- **Testing** — one line per AC, one line on unit/integration coverage
- **Screenshots** if UI-visible
- **Destructive-migration disclosure** (empty unless applicable)
- **Dependencies added** (empty unless `package.json` changed)

Target branch is `develop` (NOT `main`). Release gates happen from `develop → main` per workstream — see `docs/git-workflow.md` §8.

## 11. When you're unsure

Prefer asking over guessing. Prefer a small PR that does one thing well over a large PR that tries to be complete. Prefer following an existing pattern over inventing a new one. If you genuinely can't find guidance in the docs, stop and ask — don't paper over a spec gap with a silent assumption.

## 12. Authority

- **Product truth**: `docs/product-requirements.md` + `docs/requirements-decisions.md` + `docs/acceptance-criteria-pack.md`
- **Technical truth**: `docs/adr/` (ADRs, in ascending order of number)
- **Contract truth**: `docs/api-and-events.md` + `packages/shared-schemas/`
- **Data truth**: `docs/data-model.md` + `apps/api/src/db/schema/` + `apps/api/drizzle/`
- **Process truth**: `docs/git-workflow.md` + `docs/ai-development-guardrails.md` + `docs/hooks.md`
- **Behavior truth**: `e2e/specs/` (Playwright tests — these are executable specifications)

When `docs/build-order.md` and `docs/workstreams/proposed-workstreams.md` disagree: workstreams wins for ownership, build-order wins for sequence.

When two sources disagree on anything else, flag it to the PO. Don't silently pick.

## 13. This file

`CLAUDE.md` is updated whenever a rule changes that affects how you work. If a new rule is added in `docs/ai-development-guardrails.md`, update the relevant section of this file too. When in doubt about whether to update this file, err on the side of updating — a stale CLAUDE.md is worse than no CLAUDE.md.
