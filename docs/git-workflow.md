# Git Workflow and Development Etiquette
## Online Chat Server

## 1. Purpose

This document defines how code moves from a Claude Code session to `main`. It commits the project to a branching model, commit cadence, PR discipline, and release-gate process. Every contributor (human or AI) follows it.

The goal is **auditability and recoverability**: any state `main` has ever been in is reproducible; any change is traceable to an AC, a PR, and a reviewer. Nothing lands on `main` without passing through the layered enforcement in `docs/hooks.md`.

## 2. Branching model — Git-Flow-light

```
  main ◄──── release PR ◄──── develop ◄──── feature/* ◄──── (work happens here)
   │                                      ◄──── fix/*
   │                                      ◄──── chore/*
   │                                      ◄──── doc/*
   │                                      ◄──── infra/*
   │                                      ◄──── spike/*
   │
   └────── (hotfix PR only — emergency path — see §8) ◄──── fix/hotfix-*
```

### 2.1 Branches

| Branch | Role | Protected | Can receive PRs from | Can merge to |
|---|---|---|---|---|
| `main` | Always-deployable release snapshot. Every commit is a release. | Yes (hard) | `develop` only (or hotfix/* — see §8) | none |
| `develop` | Integration branch. Where all feature work lands. | Yes (soft) | `feature/*`, `fix/*`, `chore/*`, `doc/*`, `infra/*`, `spike/*` | `main` (release PR) |
| `feature/AC-<ID>-<slug>` | One AC per branch (or a tight group of ACs) | No | none (work happens here) | `develop` |
| `fix/<slug>` | Bug fix without a new AC | No | none | `develop` |
| `chore/<slug>` | Refactor / dependency bump / no behavior change | No | none | `develop` |
| `doc/<slug>` | Doc-only changes | No | none | `develop` |
| `infra/<slug>` | CI / Compose / tooling | No | none | `develop` |
| `spike/<slug>` | Exploratory; **never merged** | No | none | nowhere — deleted after concluding |

### 2.2 Why Git-Flow-light and not trunk-based

- Trunk-based requires feature flags to hide unfinished work in production. MVP has no production deployment yet, so flags are overhead.
- The PO reviews most PRs manually. A `develop` integration branch gives them a stable place to test a workstream before it gates to `main`.
- Release-gate discipline (§7) prevents `main` from accruing half-finished workstreams.
- When the project outgrows local-only deployment, either model still works. Revisit the choice then.

## 3. Branch naming

Branch names are strict. Pre-push hook rejects non-conforming names.

```
feature/AC-AUTH-03-login-session
feature/AC-MSG-04-edit-own
fix/session-revoked-race
chore/bump-drizzle-0-30
doc/clarify-unread-semantics
infra/add-gitleaks-hook
spike/try-trpc
fix/hotfix-session-leak    ← used only in the emergency main path
```

Rules:

- `feature/` branches MUST include exactly one `AC-<ID>` in the name. Multi-AC branches are discouraged; if a PR genuinely touches several ACs, pick the anchor AC for the branch name and list the rest in the PR description.
- Slugs are kebab-case, 3–50 characters, `[a-z0-9-]` only.
- No personal prefixes (`elisey/fix-foo`). The branch's purpose is the namespace, not the author.

## 4. Commit hygiene

### 4.1 Commit message format

```
<type>: <short summary in imperative mood>

<optional body explaining the WHY, not the WHAT>

<optional footer: refs, breaking-change notes>
```

Where `<type>` is:

| Type | When to use |
|---|---|
| `AC-<ID>` | The commit implements or fixes that specific AC |
| `chore` | Refactor, dependency, format; no behavior change |
| `fix` | Bug fix without a new AC (rare — usually there's an AC) |
| `doc` | Docs only |
| `infra` | CI, Compose, scripts, tooling |
| `spike` | Exploration; WIP on a spike branch |

Examples of good commit subjects:

```
AC-AUTH-03: establish session on successful login
AC-MSG-04: allow author to edit own message within 5 min
chore: bump @fastify/swagger to 9.0.0
fix: race condition when session revoked mid-request
doc: clarify AC-UNREAD-03 explicit advance semantics
infra: add gitleaks pre-commit hook
```

Examples of bad commit subjects (will be rejected by `commit-msg` hook):

```
wip                                  ← no type prefix
fix stuff                            ← vague
AC-AUTH-03 login works now           ← no colon after type
update code                          ← useless
```

### 4.2 Commit frequency

- **Commit every time you reach a stable milestone**: a new test passes, a refactor is self-consistent, a schema migration is complete. Not per day, not per hour — per milestone.
- **Prefer many small commits over one big commit.** Reviewers can read 5 × 40-line commits faster than 1 × 200-line commit. The history is also easier to bisect later.
- **Never commit broken code to a shared branch** (`develop`, `main`). On a feature branch, broken intermediate commits are acceptable if they get squashed (see §6).
- **AI session discipline**: at the end of a substantive edit block (several files changed, tests passing), make a commit. Do NOT accumulate an entire AC's worth of changes into one commit unless the PR is trivial.

### 4.3 Authorship

- Use your actual git user (email is in `.git/config`).
- Never write `Co-Authored-By: Claude Opus 4.7` or similar — see the user's global CLAUDE.md rule.
- No "Generated by …" footers.

## 5. Pre-commit enforcement

See `docs/hooks.md` for the full reference. In summary, the `lefthook.yml`-configured pre-commit hook runs on every `git commit`:

| Check | Blocks commit on |
|---|---|
| `typecheck-staged` | Any staged TypeScript file fails `tsc --noEmit` |
| `lint-staged` | Any ESLint warning or error; inline disables via new lines |
| `gitleaks` | Any matching secret pattern in the staged diff |
| `drizzle-guard` | Schema change without matching migration file and doc update |
| `suppression-check` | New `eslint-disable` / `@ts-expect-error` / `as any` on net-new lines without issue link |
| `ac-test-presence` | Branch name is `feature/AC-...` but no Playwright test file staged |

**When a hook blocks a commit**: do NOT commit with `--no-verify`. Fix the root cause. If the hook is genuinely wrong, open an `infra/fix-hook-<name>` branch first. See `docs/hooks.md` §5 for the legitimate bypass path.

## 6. Working on a feature branch

### 6.1 Start

```
git checkout develop
git pull --rebase
git checkout -b feature/AC-XXX-short-slug
```

### 6.2 Commit as you go

Follow §4.2. Small commits. Each passes typecheck + lint locally before committing (the pre-commit hook enforces this anyway).

### 6.3 Stay current with `develop`

If `develop` advances while your branch is open, rebase rather than merge:

```
git checkout develop
git pull --rebase
git checkout feature/AC-XXX-...
git rebase develop
# resolve conflicts if any; AI sessions STOP and ask the PO here (see §9)
git push --force-with-lease
```

`--force-with-lease` (not `--force`) is required — it refuses to overwrite commits you haven't seen.

### 6.4 Pre-push

`lefthook` runs a smoke subset of integration tests (`pnpm test:smoke`) and the doc-consistency check on push. Either can block. Fix the cause and push again.

### 6.5 Open a PR

Target: `develop`. Title and body follow the PR template (`.github/pull_request_template.md`) — see §7.1.

### 6.6 After review feedback

Add commits that address feedback. Do NOT rebase or squash away the review history until the PR is approved; reviewers need to see the diff between their last read and now.

### 6.7 Squash on merge

`develop` uses **squash-merge**. When the PR is merged, its commits collapse into a single commit on `develop`. The commit message becomes the PR title + body. This keeps `develop` history readable.

### 6.8 After merge

```
git checkout develop
git pull --rebase
git branch -D feature/AC-XXX-...     # local cleanup
git push origin --delete feature/AC-XXX-...   # remote cleanup (usually automatic)
```

## 7. Pull request discipline

### 7.1 PR template

Every PR targeting `develop` uses `.github/pull_request_template.md`. Required sections:

- **Summary** — one paragraph, "why", not "what"
- **AC IDs addressed** — list with links to `docs/traceability.md` rows; or "None — see title tag" for non-AC PRs
- **Docs updated** — checkbox list of the doc files touched
- **Testing** — one line per AC, confirming Playwright test passes locally; and one line on unit/integration coverage
- **Screenshots or recordings** — for UI-visible changes
- **Destructive-migration disclosure** — empty unless the PR contains `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or `NOT NULL` on an existing column (§5.5 of `ai-development-guardrails.md`)
- **Dependencies added** — empty unless `package.json` or `pnpm-lock.yaml` changed

CI job `check-pr-description` rejects PRs missing required sections.

### 7.2 PR size

Target: ≤ 400 lines of non-generated diff. PRs bigger than 800 lines are presumed too large; reviewer may request a split. Large PRs are still acceptable when the change is genuinely atomic (e.g., a migration that must land with its code and doc update in one atom).

### 7.3 Review

- **CodeRabbit is the required reviewer.** Its PR review state gates the merge: a `CHANGES_REQUESTED` review blocks until CodeRabbit itself flips to `APPROVED`. No human approving-review count is required by branch protection (see §10).
- `.coderabbit.yaml` at the repo root (picked up from the default branch per CodeRabbit's security model) ensures auto-review fires on every PR targeting `main` or `develop`, and re-fires on every new commit. Re-reviews are also triggered by the organisation-UI toggle the PO owns.
- The PO may still read the diff and leave comments, but a human approving review is not needed. CODEOWNERS remains advisory (drives auto-reviewer assignment for FYI only).
- Review feedback is tracked in-thread; resolved when the PR author clicks "resolve conversation" after addressing the comment. `required_conversation_resolution: true` on both `main` and `develop` enforces that no unresolved thread lands on merge.

### 7.4 Auto-merge

GitHub auto-merge is enabled once all required checks are green and CodeRabbit's latest review is `APPROVED` (with all conversations resolved). The author enables auto-merge after addressing CodeRabbit feedback; the merge fires automatically when CodeRabbit's re-review settles.

### 7.5 Draft PRs

For work-in-progress that's not ready for review, use GitHub's "Draft" status. Draft PRs do NOT require the PR template to be complete. They DO still run CI.

## 8. Release gates — `develop → main`

### 8.1 When to cut a release

A `develop → main` release PR is prepared when **all ACs in a workstream milestone** are complete. Examples:

- After WS-01 (Platform and Runtime Foundations) is done → `v0.1.0`
- After WS-02 (Identity, Sessions, Security) is done → `v0.2.0`
- After WS-03 (Core Chat Domain) is done → `v0.3.0`
- … and so on through the workstreams in `docs/workstreams/proposed-workstreams.md`

One workstream per release, numbered sequentially. Minor releases (`v0.2.1`) are reserved for hotfixes (§8.4).

### 8.2 How to prepare the release PR

1. Create the branch: `git checkout -b release/v0.X.0 develop`.
2. Create the release notes file `docs/releases/v0.X.0.md` with:
   - Workstream(s) included
   - List of AC IDs completed
   - Schema migrations applied (from `apps/api/drizzle/`)
   - Breaking changes, if any
   - Migration/rollback notes (always "forward-only" per ADR-011)
3. Open the PR with target = `main`, title = `release: v0.X.0 — <workstream name>`.
4. CI runs the full pipeline including the E2E smoke suite against a Compose-built release image.

### 8.3 Release PR requirements

To merge to `main`, the PR MUST have:

- All ACs in the declared workstream marked complete in `docs/traceability.md`
- Full CI green on `develop` (PR CI also runs)
- `docs/releases/v0.X.0.md` present and non-empty
- CodeRabbit review `APPROVED` with all conversations resolved (same policy as `develop` — see §7.3 and §10). The PO cuts the release PR but no human approving-review is required.

After merge:

- Tag the merge commit: `git tag -a v0.X.0 -m "Release v0.X.0"` and push the tag.
- Back-merge `main` → `develop` to reconcile any release-branch adjustments (rare but possible if last-minute edits happened on the release PR).

### 8.4 Hotfix path — `fix/hotfix-* → main`

Only when a production-blocking bug is found in a released build:

1. Branch from `main`: `git checkout -b fix/hotfix-<slug> main`.
2. Reproduce the bug as a failing Playwright test.
3. Implement the fix.
4. Open PR targeting `main` directly.
5. CI runs. PO reviews.
6. Merge. Tag `v0.X.1` (patch bump).
7. Back-merge `main` → `develop` immediately so the fix doesn't get lost on the next release.

Hotfixes are rare — for MVP they should be zero. The mechanism exists so the rule is clear when needed.

## 9. Merge-conflict policy (AI-specific)

If a rebase or merge produces a conflict:

- **AI sessions STOP and ask the PO before resolving.** Never auto-resolve. Conflicts indicate two changes touched the same region — a silent auto-resolve can drop one side's intent.
- Show the conflict regions to the PO with a brief explanation of what each side was trying to do.
- The PO decides which side wins, or whether the fix is a combination.

Humans may resolve conflicts directly, but they are advised to read both sides before picking.

## 10. `main` and `develop` branch protection (authoritative)

Both `main` and `develop` carry the same GitHub branch-protection rules. The only human-in-the-loop reviewer required at MVP is **CodeRabbit**; a human approving-review is not required (the PO remains accountable for the code and can override as admin when needed, since `enforce_admins: false`).

- **Required status checks** (all must pass, `strict: true` so the branch must be up to date with the base):
  - `typecheck`
  - `lint`
  - `unit`
  - `integration`
  - `e2e-smoke`
  - `check-pr-title`
  - `check-pr-description`
  - `doc-consistency`
  - `schema-drift`
- **Required approving reviews**: `0` (no human count required).
- **Dismiss stale approvals on new push**: `true` (new commits automatically invalidate prior approving reviews; `CHANGES_REQUESTED` reviews persist and are superseded only when the reviewer — CodeRabbit — posts a new review, per GitHub's last-review-per-reviewer rule).
- **CodeRabbit as effective gate**: a `CHANGES_REQUESTED` review from CodeRabbit blocks the merge until CodeRabbit's latest review flips to `APPROVED`. This is enforced by GitHub's own PR review state machine, not by a branch-protection setting; the policy works only because `required_pull_request_reviews` is set (even with count 0) so the review state remains part of mergeability.
- **Require CODEOWNER review**: `false` for MVP (flip when a second accountable human joins).
- **Require conversation resolution**: `true`. Every CodeRabbit inline comment must be clicked "Resolve conversation" before merge.
- **Require linear history**: `true`.
- **Require signed commits**: `false` at MVP (flip later if needed).
- **Allow force pushes**: `false`.
- **Allow deletions**: `false`.
- **Enforce on admins**: `false` (PO keeps an escape hatch for genuine emergencies — see §8.4 hotfix path).

Configuration precedence for CodeRabbit's own review behaviour:
- `.coderabbit.yaml` at the repo root is read from the **default branch** (`main`) and names the base branches that get auto-review (`main`, `develop`). Changes to this file take effect only once they reach `main` via the normal release path.
- The CodeRabbit organisation-UI setting can add base branches directly without a code change; it's the PO's lever for enabling auto-review on a new long-lived branch faster than the release cadence.

## 11. Forbidden operations

- `git push --force` to `main` or `develop` (always rejected by branch protection).
- `git push --force-with-lease` to `main` or `develop` (same).
- `git rebase -i` on `main` or `develop` commits already pushed.
- `git revert` a migration commit on `main` — per ADR-011, rollback means a new forward migration.
- Merging to `main` from anywhere except `develop` or `fix/hotfix-*`.
- Bypassing hooks via `--no-verify`.
- Committing with a type prefix that doesn't match the actual change (e.g., `chore:` when behavior changed — reviewers catch this, and re-labelling is required before merge).

## 12. Rollback policy

Per ADR-011, migrations are **forward-only**. Rollback means:

- **Code rollback**: identified a bad release → revert the release PR on `main` → tag `v0.X.2` → redeploy. This is a "revert commit", not a rebase.
- **Data rollback**: the migration landed but the data is wrong → write a new forward migration that corrects the data → release as patch.

There is no git-revert of a migration commit. Migrations are cumulative; subtracting one breaks the history assumption.

## 13. Feature flags

Deferred for MVP. All merges to `develop` are user-visible-as-of-the-next-release. If the project later needs flags (e.g., to land a feature on `main` but hide it from users), revisit this section and pick a flag provider (GrowthBook, LaunchDarkly, or a simple env-based toggle).

## 14. What this document enforces

- `lefthook.yml` hooks enforce branch-name, commit-message, and pre-commit rules (§3–§5).
- `.github/workflows/ci.yml` enforces PR title, description, and test-presence rules (§7.1).
- GitHub branch protection enforces the merge rules (§10).
- `.github/CODEOWNERS` is advisory for MVP (drives auto-assigned reviewers only; does not block merges).

Any change to this document that affects enforcement MUST land in the same PR as the corresponding config change. Drift between prose here and config elsewhere is a CI-blocking error once `doc-consistency.yml` learns to detect it.
