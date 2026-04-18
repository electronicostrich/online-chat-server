# AI Development Guardrails
## Online Chat Server

## 1. Purpose

Nearly all code in this project is written by AI (Claude Code). Left ungoverned, AI-written code tends to drift:

- it invents schemas that don't match documented contracts
- it introduces patterns that conflict with earlier decisions
- it silently skips tests, handles errors with `catch (_) {}`, or sprinkles `any`
- it adds TODO comments instead of finishing the work
- it answers the immediate question instead of the question the PR should answer

This document is the **rulebook** every AI session must obey. The rules are paired with their **enforcement mechanism** — a rule without enforcement is a suggestion, and this project does not run on suggestions.

If you are Claude Code reading this file: these rules are binding for every change you author. The user approving your plan does not waive any rule here.

## 2. Before writing any code

### 2.1 Read the AC and the relevant doc

Every code change maps to at least one row in `docs/traceability.md`. Before writing code:

1. Identify the AC ID(s) the change implements or affects.
2. Read the row in `docs/traceability.md` for those ACs.
3. Read the referenced sections in `api-and-events.md`, `data-model.md`, `state-model.md`, and `permissions-matrix.md`.
4. Read or open the existing Playwright test file for the AC. If it doesn't exist yet, create it *first* (see §3).

**Enforcement**: PR description template requires listing the AC IDs and a one-line rationale. CI parses the description.

### 2.2 Check the existing code

Before adding a new function/module/file:

1. Search for existing implementations (`grep`, `rg`) — do not write a new normalization helper if one already exists.
2. If the existing code is wrong for the new use case, extend it or refactor with explicit reasoning, documented in the PR.
3. Do not leave the old code behind as a "just in case" fallback. See §5 for dead-code policy.

**Enforcement**: code review. Reviewers reject PRs that duplicate functionality already present.

## 3. Test-first preference (TDD-lite)

For any change that implements an AC:

1. Create or update the Playwright test file named `AC-<ID>-<slug>.spec.ts` first.
2. Commit the failing test (this can be a WIP commit within the PR branch).
3. Implement the backend and frontend changes until the test passes.
4. Only then move to additional edge cases or follow-up ACs.

Bug fixes follow the same pattern: reproduce the bug in a test, confirm it fails, then fix.

**Enforcement**: PR must contain at least one commit where a test was added/modified before the commit that made it pass. CI checks commit ordering for PRs tagged `AC-*`. (For pure refactors tagged `CHORE:`, this rule is relaxed.)

## 4. PR conventions

### 4.1 PR title

Every PR title MUST start with one of:

- `AC-<ID>:` — implements or fixes a specific acceptance criterion
- `CHORE:` — refactor, dependency bump, formatting, test infrastructure (must not change behavior)
- `DOC:` — documentation only (no code)
- `INFRA:` — CI, compose, runtime config, scripts
- `SPIKE:` — experimental work; MUST be closed without merging once the spike concludes

Example: `AC-MSG-04: author edits own message`.

### 4.2 PR description

Every PR description MUST include:

- **AC IDs** (if any) with a link to each row in `docs/traceability.md`
- **Docs updated** — a checkbox list of every doc file touched (or "no doc changes because X")
- **Testing** — one line per AC: "AC-XXX: Playwright test `AC-XXX-slug.spec.ts` passes locally"
- **Screenshots or recordings** if the change is UI-visible

**Enforcement**: PR template in `.github/pull_request_template.md`. A CI check fails the build if required sections are empty.

### 4.3 PR size

Each PR should be small enough to review in 15 minutes. Large PRs get split by workstream (see `docs/workstreams/proposed-workstreams.md`). The rule of thumb: one AC per PR, unless multiple ACs are coupled by a single migration or schema change.

### 4.4 No hook skipping

Never commit with `--no-verify`. Never push with `--no-verify`. If a hook fails, fix the root cause.

**Enforcement**: branch protection on `main` rejects commits without verified signatures. Pre-push hook warns on `--no-verify` flags.

## 5. Code quality rules

### 5.1 Hard bans

The following patterns are merge-blocking. Each rule is enforced in at least one of the three layers (Claude Code hooks → pre-commit → CI). See `docs/hooks.md` §2.1 for the full who-catches-what matrix.

| Pattern | Why | Layer 1 | Layer 2 | Layer 3 |
|---|---|---|---|---|
| `as any` / `as unknown as` on new lines | Erases type safety | Write hook | `suppression-check` | ESLint `@typescript-eslint/no-explicit-any` |
| `// @ts-ignore`, `// @ts-nocheck` | Silent type-check breakage | Write hook | `suppression-check` | ESLint `ban-ts-comment` (banned outright) |
| `// @ts-expect-error` without a ≥10-char description | Silent type-check breakage | Write hook | `suppression-check` | ESLint `ban-ts-comment` (allow-with-description) |
| Net-new `// eslint-disable*` anywhere | Silently weakens lint | Write hook | `suppression-check` | — (hooks catch it first) |
| `catch { /* noop */ }` / `catch (_) {}` | Swallows errors | — | — | ESLint `no-unused-vars` + review |
| Bare `TODO:` / `FIXME:` without `(#N)` issue link | Leaves known broken state | Write hook | `suppression-check` | ESLint `no-warning-comments` |
| Commented-out code | Obscures intent | — | — | ESLint + review |
| `console.*` in `apps/api/src/**` | Use the Pino logger | Write hook | `lint-staged` | ESLint `no-console: error` |
| Direct `process.env.*` reads outside `apps/api/src/config/` | Centralise env reads | — | `lint-staged` | ESLint `no-restricted-properties` |
| Imports from `zod`/`yup`/`joi`/`ajv` | TypeBox only (ADR-010) | Write + Bash hooks | `lint-staged` | ESLint `no-restricted-imports` |
| Hand-written wire-shape interfaces outside `packages/shared-schemas` | Schemas are single source of truth | — | — | `doc-consistency` |
| Committed `.skip` / `.only` in tests | Hides regressions | — | — | ESLint `vitest/no-focused-tests`, `playwright/no-focused-test`, `playwright/no-skipped-test` |
| `git commit --no-verify` / `git push --no-verify` | Bypasses the pre-commit layer | Bash hook | — | Branch protection (force-push blocked) |
| Force push to `main` / `develop` | Overwrites history | Bash hook | — | Branch protection |
| Destructive SQL outside `apps/api/test/` paths | Data loss risk | Bash hook | `drizzle-guard` | Review + `destructive-migration` disclosure in PR template |

### 5.2 Soft expectations (code review catches)

- **Comments explain *why*, not *what*.** If the code explains the what, no comment is needed.
- **Functions do one thing.** If a function takes five arguments and returns two things, it's two functions.
- **No defensive programming for impossible cases.** If the type says non-null, don't add a null check "just in case".
- **No abstraction ahead of need.** Three concrete usages before extracting a helper.
- **Names describe intent.** `processMessage` is bad; `validateInboundMessagePayload` is good.

### 5.3 Dependencies policy

Adding a runtime or dev dependency requires:

- (a) **justification in the PR description** under "Dependencies added" — at minimum: why, what it replaces (if anything), and whether it overlaps with an existing sanctioned library
- (b) **no overlap** with any §5.1-banned library (`zod`, `yup`, `joi`, `ajv`). The Bash PreToolUse hook blocks `pnpm add` for these
- (c) **lockfile sanity** — CI fails if `pnpm-lock.yaml` diffs without a corresponding PR-description "Dependencies added" section listing the new entries

### 5.4 Secrets policy

- **Nothing resembling a secret is ever committed.** Gitleaks (`lefthook.yml` pre-commit) scans every staged diff against its default ruleset plus repo-local custom patterns under `.gitleaks.toml`.
- **Local secrets** live in `.env.local` (gitignored). `.env.example` commits placeholder values only.
- **CI secrets** live in GitHub Actions Secrets; the workflow references `${{ secrets.NAME }}`. Never inline.
- **Test fixtures** that LOOK like secrets (e.g., `SESSION_SECRET=TESTTESTTESTTESTTEST`) are allowed ONLY inside `apps/api/test/**` or `e2e/**` paths and must be documented as fixtures in a comment adjacent to the value.

### 5.5 Destructive migrations

Migrations that execute `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` (outside test paths), `ALTER COLUMN ... SET NOT NULL` on an existing column, or any renaming of a column require:

- (a) disclosure in the PR description under "Destructive-migration disclosure"
- (b) a paired data-preservation plan described in `docs/data-model.md` (either inline or in a dedicated subsection)
- (c) PO sign-off recorded on the PR
- (d) a targeted integration test proving the migration's behavior against both empty and populated databases

The Bash PreToolUse hook blocks destructive SQL outside `apps/api/test/` paths. The `drizzle-guard` pre-commit hook flags schema changes that lack a matching migration file.

### 5.6 Test substance

Playwright tests MUST assert against a real HTTP response, a real DOM state, or a real WebSocket event — NOT tautologies.

Banned patterns (enforced by `scripts/check-test-substance.ts` in CI):

- `expect(true).toBe(true)`, `expect(1).toBeTruthy()`, `expect([]).toEqual([])` and similar
- tests with zero `expect()` calls
- tests whose only `expect()` targets a local variable not derived from `request.*`, `page.*`, or `fetch`
- tests entirely skipped or marked `.only`

A test that can pass without the system under test running is not a test.

### 5.7 `__test/*` endpoint guard

The test-only seed endpoint (`POST /__test/seed`, see `docs/testing-strategy.md` §4.3) MUST:

- be registered inside a module guarded by `if (process.env.NODE_ENV !== 'test') return;`
- have a unit test asserting the guard (registration succeeds under `NODE_ENV=test`, returns 404 otherwise)
- be stripped from production Docker builds — the `prod` stage of `apps/api/Dockerfile` greps the compiled bundle for `__test` and fails the build if it finds any match

This prevents a single env-var flip or an accidental Compose override from exposing the seed route to a production caller.

## 6. Schema and data-model discipline

### 6.1 Adding an API endpoint

If your change adds a new endpoint:

1. Add the request/response TypeBox schemas to `packages/shared-schemas/src/schemas/<module>.ts`.
2. Register the route in `apps/api/src/modules/<module>/routes.ts` with the `{ schema: { body, querystring, response } }` config.
3. Update `docs/api-and-events.md` to include the new endpoint's shape, rules, and error codes.
4. Add a row in `docs/traceability.md` linking it to the AC.
5. Write a Playwright test named `AC-<ID>-<slug>.spec.ts`.

Skipping any step fails CI.

### 6.2 Adding a database column

If your change adds a column:

1. Edit the Drizzle schema in `apps/api/src/db/schema/<entity>.ts`.
2. Run `pnpm --filter api db:generate` to produce the migration SQL. Review the generated file. Commit both the schema change and the migration in the same commit.
3. Update `docs/data-model.md` to reflect the new column, its type, nullability, default, and (if applicable) its cascade behaviour.
4. If the column affects behaviour visible in an AC, update the relevant AC or add a new one.

The `schema-drift.yml` CI job fails if schema code and migrations disagree.

### 6.3 Changing an error code

1. Edit `packages/shared-schemas/src/constants/error-codes.ts`.
2. Update the HTTP-status table in `docs/api-and-events.md` §4.5.
3. Update `docs/error-envelope-and-conventions.md` if the envelope shape changes.
4. Update the Playwright test or integration test that asserts the error path.

### 6.4 Changing a state transition

1. Update `docs/state-model.md` with the new transition (preserving the existing format).
2. Update the service function in `apps/api/src/modules/<module>/service.ts`.
3. Update the Playwright test that covers the affected AC.
4. If the transition emits a WebSocket event, update `docs/api-and-events.md` §6.4 and the event schema.

## 7. When to stop and ask

### 7.1 Long-session discipline

Long Claude Code sessions lose track of earlier-resolved decisions. Mitigations:

- If a session exceeds **90 minutes** OR **20 tool calls** since last reading `docs/traceability.md`, re-read the rows relevant to the current AC before the next code edit.
- If a session exceeds **three hours**, offer to checkpoint: commit current work on the feature branch, summarize state in the PR description, and suggest a fresh session for the next chunk. Long sessions are OK for large refactors; they are drift-prone for feature builds.
- Merge conflicts always STOP and ask (see `docs/git-workflow.md` §9) — never auto-resolve.
- The `SessionStart` hook prints open contract questions from `traceability.md` and the CLAUDE.md hard constraints. Read them.

### 7.2 Reasons to stop and ask the PO

Claude Code sessions MUST stop and ask for human (PO) input if:

- The required change touches the database schema in a way not covered by existing documentation.
- The fix for a bug requires changing an acceptance criterion (the AC is wrong, or the implementation is wrong-but-accepted).
- Two plausible designs exist and the choice has downstream architectural implications not settled by an ADR.
- The task as stated would require a new ADR, new workstream, or broader product decision.
- The PO's global CLAUDE.md rules conflict with a project CLAUDE.md rule (raise the conflict; don't silently pick).

Do NOT stop and ask for:

- Straightforward naming choices (pick one and move on).
- Small refactors inside an existing module.
- Adding a missing test when the rest of the AC is clearly implemented.

## 8. Commit hygiene

- One logical change per commit.
- Commit message: imperative mood, present tense. `"Add AC-MSG-04 edit-own test"`, not `"Added test"`.
- No "Generated by Claude Code" footer (per PO's global CLAUDE.md rule).
- Commit ordering matters for PRs that introduce new ACs — see §3.

## 9. Working with existing code

- When asked to fix a bug: reproduce first, then fix.
- When asked to refactor: do not also fix bugs in the same PR. File a separate issue and fix it next.
- When asked to add a feature: do not rewrite existing working code "while you're there". Propose a separate refactor PR if warranted.

## 10. Documentation discipline

### 10.1 Location rules

See `docs/documentation.md` (PO's global rule, also in effect here):

- No new root-level `.md` files except `README.md` and `CLAUDE.md`.
- Feature docs go under `docs/`; API reference goes in `docs/api-and-events.md`; design decisions go in `docs/adr/`.
- No `*-v2.md`, `*-final.md`, `*-summary.md` suffixes. Clean kebab-case names only.

### 10.2 Update, don't duplicate

If information already exists in a doc, update it in place rather than writing a new doc. The three cases where a *new* doc is warranted:

- A new ADR for an architectural decision.
- A genuinely new concern (testing strategy, CI pipeline, security posture) not covered elsewhere.
- A workstream-specific guide.

Anything else: edit the existing doc.

### 10.3 Keeping CLAUDE.md in sync

The repo-root `CLAUDE.md` is the AI's entry point. It must stay in sync with this file and the key docs it references. Whenever a rule here changes, verify `CLAUDE.md` still points at the right sections.

## 11. Enforcement summary (three-layer matrix)

Layers: **1** = Claude Code hooks (`.claude/settings.json`), **2** = pre-commit / pre-push (`lefthook.yml`), **3** = GitHub Actions CI. See `docs/hooks.md` for the full reference.

| Rule | L1 | L2 | L3 |
|---|:---:|:---:|:---:|
| No `--no-verify` on commit / push | PreToolUse Bash | branch protection (force-push) | — |
| No `as any` / `as unknown as` on new lines | PreToolUse Write | `suppression-check` | ESLint |
| No `@ts-ignore` / `@ts-nocheck` | PreToolUse Write | `suppression-check` | ESLint `ban-ts-comment` |
| `@ts-expect-error` requires description | PreToolUse Write | `suppression-check` | ESLint `ban-ts-comment` |
| No net-new `eslint-disable*` | PreToolUse Write | `suppression-check` | — (caught at L1/L2) |
| No bare `TODO:` | PreToolUse Write | `suppression-check` | ESLint `no-warning-comments` |
| No `console.*` in apps/api/src | PreToolUse Write | `lint-staged` | ESLint `no-console` |
| TypeBox only (no zod/yup/joi/ajv) | PreToolUse Write + Bash | `lint-staged` | ESLint `no-restricted-imports` |
| No destructive SQL outside test paths | PreToolUse Bash | `drizzle-guard` | review + `destructive-migration` disclosure |
| No force push to main/develop | PreToolUse Bash | — | branch protection |
| Secrets scanning | — | `gitleaks` | `gitleaks` re-scan |
| Typecheck passes | Stop hook | `typecheck-staged` | `ci/typecheck` |
| Lint passes | Stop hook | `lint-staged` | `ci/lint` |
| Doc consistency | Stop hook | `doc-consistency` (pre-push) | `doc-consistency.yml` |
| Schema ↔ migrations in sync | — | `drizzle-guard` | `schema-drift.yml` |
| AC ↔ Playwright test mapping | — | `ac-test-presence` | `scripts/doc-coverage.ts` |
| Route ↔ TypeBox schema | — | — | `scripts/doc-coverage.ts` |
| No stub Playwright tests | — | — | `scripts/check-test-substance.ts` |
| `__test/*` prod-image leakage | — | — | Dockerfile grep step |
| PR title format | — | — | `ci/check-pr-title` |
| PR description completeness | — | — | `ci/check-pr-description` |
| Commit message format | — | `commit-msg: title-format` | — |
| No AI-coauthor footer in commits | — | `commit-msg: no-ai-footer` | — |
| Compose ↔ runtime doc | — | — | `scripts/lint-compose.ts` |
| Required 1 approving review (no CODEOWNER requirement for MVP) | — | — | branch protection |
| Linear history on main/develop | — | — | branch protection |

"—" means the rule is not enforced at that layer (either not enforceable, or caught sufficiently at another layer).

## 12. Why these rules (a short note for the PO)

Each rule here exists because its absence would let AI-generated code drift in a way that's hard to detect until the system is in production. The rules trade a small amount of per-PR friction for a much larger amount of later debugging avoided.

If any of them ever feel like bureaucracy slowing things down, raise it and we'll review. But the default posture is: enforce, measure, and relax only when data proves the rule isn't pulling weight.
