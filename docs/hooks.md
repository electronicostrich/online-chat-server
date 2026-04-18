# Hooks — Three-Layer Enforcement
## Online Chat Server

## 1. Purpose

This document is the authoritative reference for every automated check that runs between a Claude Code session typing a character and `main` accepting a commit. It specifies:

- what each hook does
- where the config lives
- which layer catches which class of mistake
- how to test a hook locally
- how to legitimately bypass a hook (almost never)

The rules in `docs/ai-development-guardrails.md` name the enforcement mechanism for each rule. This document specifies **what those mechanisms actually do**.

## 2. Three-layer enforcement model

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: Claude Code hooks        (.claude/settings.json)        │
│  fires: inside an AI session, on each tool use                   │
│  catches: unsafe edits and commands BEFORE they become files     │
└────────────────────┬────────────────────────────────────────────┘
                     │ session writes, session commits
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2: Pre-commit and pre-push hooks  (lefthook.yml)           │
│  fires: on `git commit` and `git push`                           │
│  catches: regressions in staged diff BEFORE they reach origin    │
└────────────────────┬────────────────────────────────────────────┘
                     │ commit pushed
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3: GitHub Actions CI       (.github/workflows/*.yml)       │
│  fires: on PR open/update and on merge                           │
│  catches: integration / E2E issues; final merge gate             │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Who catches what (matrix)

| Problem class | Layer 1 | Layer 2 | Layer 3 |
|---|---|---|---|
| AI writes `as any` | ✅ (PreToolUse Edit) | ✅ (suppression-check) | ✅ (ESLint) |
| AI runs `git commit --no-verify` | ✅ (PreToolUse Bash) | n/a (bypassed) | n/a |
| Committed file contains a secret | ❌ (written to disk first) | ✅ (gitleaks) | ✅ (gitleaks re-scan) |
| TypeScript error in committed file | ✅ (Stop hook) | ✅ (typecheck-staged) | ✅ (full typecheck) |
| ESLint warning | ✅ (Stop hook) | ✅ (lint-staged) | ✅ (full lint) |
| Missing Playwright test for AC | ✅ (PreToolUse Edit guidance) | ✅ (ac-test-presence) | ✅ (doc-coverage) |
| Schema edit without migration | ✅ (Stop hook) | ✅ (drizzle-guard) | ✅ (schema-drift) |
| Drizzle migration unsafe | ⚠️ (Write scan) | ✅ (destructive-migration prompt) | ✅ (schema-drift + review) |
| Stub Playwright test | ❌ (content-dependent) | ❌ | ✅ (check-test-substance) |
| Endpoint without TypeBox schema | ❌ | ❌ | ✅ (doc-coverage) |
| Breaking integration test | ❌ | ✅ (pre-push smoke) | ✅ (full integration) |
| PR title wrong | n/a | n/a | ✅ (check-pr-title) |
| PR description missing sections | n/a | n/a | ✅ (check-pr-description) |

Layer 1 is advisory to the AI but uncompromising for most regressions at the moment of writing. Layer 2 is the safety net before push. Layer 3 is the merge gate.

## 3. Layer 1 — Claude Code hooks (`.claude/settings.json`)

The project-level `.claude/settings.json` configures hooks for any Claude Code session working in this repo. It is a real committed file (not the user's global `~/.claude/settings.json`).

### 3.1 Hook reference

| Event | Matcher | What it does | Blocks on |
|---|---|---|---|
| `SessionStart` | (all sessions) | Prints the top of `docs/traceability.md`, the current git branch, and the first 100 characters of `CLAUDE.md`. | Never (informational) |
| `PreToolUse` | `Bash` | Regex-scans the command for dangerous patterns. | `git commit --no-verify`, `git push --no-verify`, `pnpm add (zod\|yup\|joi\|ajv)`, `rm -rf /`, `DROP TABLE \| TRUNCATE` outside `apps/api/test/` paths, attempts to touch `.claude/settings.json` or `lefthook.yml` without an `infra/` branch |
| `PreToolUse` | `Write\|Edit` | Scans the `content`/`new_string` field for banned patterns. | New `// eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `as any`, `as unknown as`, `console.log` under `apps/api/src/`, imports of `zod`/`yup`/`joi`/`ajv`, `TODO:` without `(#N)` |
| `Stop` | (all sessions) | Runs `pnpm typecheck && pnpm lint && pnpm doc-consistency`. | Any non-zero exit. Exception: if the branch name starts with `spike/`, the doc-consistency check is skipped (typecheck + lint still run). |

### 3.2 Why each hook

- **SessionStart** exists because a fresh session cold-reads the repo and can miss open contract questions (e.g., "Resolve before AC-DM-05 implementation" notes). Printing the relevant doc slice reduces drift from session to session.
- **PreToolUse Bash** blocks the escape valves Claude Code might reach for under deadline pressure. `--no-verify` is the canonical one.
- **PreToolUse Write/Edit** catches the pattern at the moment of intent, before the diff is staged. Even if the AI somehow stages the diff, the pre-commit hook catches it. Layered defense.
- **Stop** ensures the AI cannot end a turn with a broken workspace. If the AI claims "done", the workspace must type-check, lint-pass, and doc-check-pass.

### 3.3 Hook output

Every PreToolUse block returns an error payload like:

```
BLOCKED by .claude/settings.json: pattern "as any" is banned.
See docs/ai-development-guardrails.md §5.1 for the rule.
If this is genuinely needed, add an eslint-disable with a linked issue number.
```

The Claude Code session receives this as a tool error and must adjust.

### 3.4 Enforcement reality

Claude Code hooks are **advisory within a session** — a determined agent with shell access could subvert them. The assumption is not that they are tamper-proof. The assumption is:

- The PO cannot manually review every tool call, so the hook catches the 99% case.
- Tampering leaves a visible audit trail (the hook's own edit would be blocked; the AI trying to edit the hook file is a red flag).
- Layer 2 and Layer 3 re-apply the same checks; a bypass at Layer 1 is still caught before merge.

## 4. Layer 2 — Pre-commit and pre-push hooks (`lefthook.yml`)

### 4.1 Why lefthook, not husky

- Single Go binary — no Node dependency for the hook process itself (matters when `pnpm install` is mid-run).
- First-class parallelism (hooks run in parallel by default, serialised only where data dependencies require it).
- Simpler YAML config.
- ~200 ms faster per commit on this repo size. Over a 6-month dev cycle, 200 ms × thousands of commits = noticeable.

Install is automatic: `pnpm install` runs `lefthook install` via the root `package.json` `prepare` script, which creates `.git/hooks/*` pointing at lefthook.

### 4.2 pre-commit hooks

Runs on every `git commit`. Each hook operates on staged files only (`{staged_files}` interpolation).

| Hook | Command | Blocks on |
|---|---|---|
| `typecheck-staged` | `pnpm tsc --noEmit --incremental` (project-wide because TS references) | Any TS error |
| `lint-staged` | `pnpm eslint {staged_files} --max-warnings=0 --no-inline-config` | Any warning or error; `--no-inline-config` ignores file-level `eslint-disable` comments |
| `gitleaks` | `gitleaks protect --staged --redact` | Any detected secret (AWS keys, Stripe keys, generic high-entropy strings, etc.) |
| `drizzle-guard` | `pnpm dlx tsx scripts/drizzle-guard.ts {staged_files}` | Schema file staged without matching migration file AND without `docs/data-model.md` change |
| `suppression-check` | `pnpm dlx tsx scripts/check-suppressions.ts --staged` | New suppression patterns on net-new lines without issue link (see `docs/script-specs.md` §7) |
| `ac-test-presence` | `pnpm dlx tsx scripts/ac-test-presence.ts` | Branch `feature/AC-*` without staged `e2e/specs/AC-*-*.spec.ts` |

All pre-commit hooks run in parallel unless they have file dependencies; total time budget: ~3 seconds on the full repo.

### 4.3 pre-push hooks

Runs on `git push`. Pushing is when CI eyes see your work, so the pre-push gate is stricter than pre-commit.

| Hook | Command | Blocks on |
|---|---|---|
| `integration-smoke` | `pnpm test:smoke` | Any failure. Runs a curated subset of integration tests (< 30 s total) |
| `doc-consistency` | `pnpm doc-consistency` | Any consistency violation (see `docs/script-specs.md` §3) |

If pre-push blocks, the push is rejected. Fix the cause and push again.

### 4.4 commit-msg hooks

Runs on every commit, after the commit message is written.

| Hook | Rule |
|---|---|
| `title-format` | Commit subject must match `^(AC-[A-Z]+-\d+\|chore\|fix\|doc\|infra\|spike):\s.+` |
| `no-ai-footer` | Commit body MUST NOT contain `Generated by Claude` or `Co-Authored-By: Claude` (per user's global CLAUDE.md rule) |

### 4.5 Hook update discipline

Any change to `lefthook.yml` or a script under `scripts/` that a hook calls is:

- tagged `infra:` in the commit message
- reviewed like any other PR
- never merged unilaterally by the PO without someone (or the AI) verifying the rule still fires

## 5. Legitimate bypass path (almost never)

**You almost never bypass a hook.** The rule is: fix the root cause, don't paper over.

The only legitimate bypass paths:

### 5.1 Known false positive

Example: gitleaks fires on a literal string that happens to match a pattern but is NOT a secret (a test fixture, a documented placeholder).

**Right way**: add an inline gitleaks-allowlist comment next to the false-positive string AND open a `chore:` PR to update the gitleaks config for the pattern. Do NOT bypass the hook.

### 5.2 Mid-incident hotfix

If a production incident requires bypassing a hook that is itself broken (e.g., the hook script has a bug), the PO can set the env var `HOOKS_SKIP_<HOOK_NAME>=1` for one push. Example:

```
HOOKS_SKIP_INTEGRATION_SMOKE=1 git push origin fix/hotfix-urgent
```

This flag is reset by default on the next terminal session. Its use is logged in `docs/releases/vX.Y.Z.md` ("Hotfix bypassed integration-smoke due to <reason>; issue #NNN tracks hook fix").

### 5.3 What is NOT a bypass

- `--no-verify` on `git commit` or `git push` — blocked by Layer 1 and the branch-protection force-push rule. Do not attempt.
- Editing `.claude/settings.json` or `lefthook.yml` to weaken the rule — requires an `infra/` branch and PR review.
- Self-approving an `infra/` PR that weakens a hook — the PO must not do this without a second opinion (even another AI session's review is acceptable; solitary sign-off on hook weakening is forbidden).

## 6. Testing a hook locally

Before committing a change to `.claude/settings.json` or `lefthook.yml`, verify the hook still fires as expected.

### 6.1 Test a Claude Code hook

Start a new Claude Code session in the repo. Attempt the pattern the hook is supposed to block. The session should receive the BLOCKED message.

Example test: after editing the PreToolUse Edit hook, try:

```
(ask the AI: "add a const x: any = 1 to apps/api/src/index.ts")
```

If the AI writes the file without the hook firing, the rule is broken.

### 6.2 Test a lefthook hook

Lefthook supports dry-run:

```
lefthook run pre-commit --all-files    # runs on every file, not just staged
lefthook run pre-commit --force         # runs even if hook is disabled
```

Or create a staged fixture file and run:

```
echo "const x: any = 1;" > /tmp/fixture.ts
git add /tmp/fixture.ts    # (assuming path is inside repo for real test)
lefthook run pre-commit
```

The `lint-staged` or `suppression-check` hook should reject.

### 6.3 Hook regression tests

Every custom script under `scripts/` that a hook calls has a unit test in `scripts/test/`. When editing the script, run:

```
pnpm test:scripts
```

Covers happy path + at least one failure case per check.

## 7. Recovery — when a hook becomes a blocker

If a hook starts blocking all sessions (regression, false positive, or a dependency bug), the fix-forward path:

1. Open `infra/fix-hook-<name>` branch from `develop`.
2. Minimal fix: either correct the script or tighten the hook's applicability.
3. Unit-test the fix.
4. Temporarily set `HOOKS_SKIP_<HOOK>=1` in the env for your own work, and flag this in `docs/releases/vX.Y.Z.md` once the fix merges.
5. Merge the infra fix to `develop` ASAP.
6. Unset `HOOKS_SKIP_<HOOK>` from any ambient shells and verify.

Never leave a hook broken in `develop` overnight — it is a blast radius for every other session.

## 8. Configuration files — canonical paths

| File | Purpose |
|---|---|
| `.claude/settings.json` | Claude Code hooks (§3) |
| `lefthook.yml` | Pre-commit / pre-push / commit-msg (§4) |
| `scripts/check-suppressions.ts` | `suppression-check` backing script |
| `scripts/ac-test-presence.ts` | `ac-test-presence` backing script |
| `scripts/drizzle-guard.ts` | `drizzle-guard` backing script |
| `.github/workflows/ci.yml` | Layer 3 CI pipeline |
| `.github/workflows/doc-consistency.yml` | Layer 3 doc consistency |
| `.github/workflows/schema-drift.yml` | Layer 3 schema drift |
| `.github/pull_request_template.md` | PR template enforced by `check-pr-description` |
| `.github/CODEOWNERS` | Advisory auto-reviewer assignment (no merge block for MVP) |

## 9. What this document enforces

- Any change to `.claude/settings.json` or `lefthook.yml` updates the relevant table in §3 or §4 in the same PR.
- Any new script added to `scripts/` updates §8.
- The full matrix in §2.1 is revisited whenever a new rule lands in `docs/ai-development-guardrails.md`.

Drift between this document and the actual config files is a CI-blocking error once `doc-consistency.yml` learns to detect it (post-MVP enhancement).
