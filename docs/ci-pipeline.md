# CI Pipeline
## Online Chat Server

## 1. Purpose

This document defines the continuous-integration contract: which workflows run, what they check, which checks block merging, and how the pipeline enforces the rules in `docs/ai-development-guardrails.md`.

CI for this project has two jobs:

1. **Catch AI drift** that humans wouldn't spot in review.
2. **Gate merges on green.** No yellow. No "I'll fix it after merge."

CI runs on **GitHub Actions**. All workflow files live in `.github/workflows/`.

## 2. Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | PR open/update, push to `main` | Typecheck, lint, unit, integration, build, E2E |
| `doc-consistency.yml` | PR open/update | Verify docs and code agree |
| `schema-drift.yml` | PR open/update (when `apps/api/src/db/` changes) | Verify Drizzle schema code matches migrations |
| `dependency-audit.yml` | nightly on `main` | `pnpm audit`, `pnpm outdated` for visibility (non-blocking) |
| `release.yml` | manual dispatch only | Tag and publish a release (post-MVP; placeholder) |

## 3. `ci.yml` — main pipeline

Runs on every PR and every push to `main`. All jobs must pass for merge.

### 3.1 Jobs

```
install → typecheck (api, web, shared) ─┐
         → lint (flat config, whole repo)─┤
         → unit tests (api, web) ─────────┼→ build (api, web) → e2e-smoke
         → integration tests (api) ───────┘
         → check-pr-title
         → check-pr-description
```

### 3.2 Environment

- Runner: `ubuntu-latest`
- Node: `24.x` (aligned with ADR-009)
- pnpm: installed via `pnpm/action-setup@v4`
- Cache: pnpm store cached by lockfile hash
- PostgreSQL + Redis: provided as GitHub Actions service containers (see §3.4)
- **Container runtime: Docker** (GitHub-hosted Ubuntu runners ship with a Docker daemon; podman is not pre-installed). The workflow sets `CONTAINER_CLI=docker` explicitly so shared scripts pick the right path. PO's local runtime (podman) does not affect CI.

### 3.3 Job details

**install**
```yaml
- actions/checkout@v4
- pnpm/action-setup@v4
- actions/setup-node with cache: 'pnpm'
- pnpm install --frozen-lockfile
```

Fails if the lockfile is stale.

**typecheck**
```yaml
- pnpm -r exec tsc --noEmit
```
Runs in every workspace. Fails on any TS error.

**lint**
```yaml
- pnpm lint
```
Root-level ESLint against the whole repo. Must be zero warnings AND zero errors. `--max-warnings=0`.

**unit tests**
```yaml
- pnpm --filter api test:unit
- pnpm --filter web test
```

**integration tests**
```yaml
# With postgres + redis service containers
- pnpm --filter api test:integration
```

Service containers:
```yaml
services:
  postgres:
    image: postgres:17-alpine
    env: { POSTGRES_USER: chat, POSTGRES_PASSWORD: chat, POSTGRES_DB: chat_test }
    options: --health-cmd pg_isready --health-interval 5s --health-timeout 3s --health-retries 12
    ports: ['5432:5432']
  redis:
    image: redis:7-alpine
    options: --health-cmd "redis-cli ping" --health-interval 5s --health-timeout 3s --health-retries 12
    ports: ['6379:6379']
```

**build**
```yaml
- pnpm --filter shared-schemas build
- pnpm --filter api build
- pnpm --filter web build
```
Frontend `vite build` must produce a bundle under the configured size budget (enforced via a `size-limit` config; exact size thresholds are TBD and tracked in an issue once an initial bundle exists).

**e2e-smoke**
```yaml
- docker compose up -d
- wait-for-health all services
- pnpm e2e
- docker compose logs > e2e-logs.txt (always, on failure)
- upload Playwright trace artifacts on failure
```

The E2E job is the slowest (~5 minutes on MVP). It runs once per PR against a freshly-started Compose stack. Failed runs upload Playwright traces as GitHub Actions artifacts for debugging.

**check-pr-title**
```yaml
- uses: amannn/action-semantic-pull-request@v5
  with:
    types: |
      AC
      CHORE
      DOC
      INFRA
      SPIKE
    requireScope: false
```

**check-pr-description**
```yaml
- scripts/check-pr-description.ts
```
Parses the PR body, fails if required sections from `docs/ai-development-guardrails.md` §4.2 are missing.

### 3.4 Timing budget

Target pipeline duration:

| Job | Target |
|---|---|
| install | < 1 min (warm cache) |
| typecheck | < 1 min |
| lint | < 30s |
| unit | < 30s |
| integration | < 2 min |
| build | < 2 min |
| e2e-smoke | < 6 min |

Total: ~10 minutes on a warm cache.

If a single job breaches its target by 50%, file an issue tagged `ci-perf`.

## 4. `doc-consistency.yml` — documentation guardrails

This is the most project-specific workflow. It enforces the consistency between docs and code described in `docs/ai-development-guardrails.md` and `docs/traceability.md`.

### 4.1 Checks

Implemented as `scripts/doc-coverage.ts`:

| Check | Rule |
|---|---|
| **Every AC has a traceability row** | Every `AC-*` ID in `docs/acceptance-criteria-pack.md` appears in `docs/traceability.md` |
| **Every traceability row has a Playwright test** | The test filename in each row exists under `e2e/specs/` |
| **Every Playwright test matches an AC** | Every file in `e2e/specs/` starts with an `AC-*` prefix that exists in `docs/acceptance-criteria-pack.md` |
| **Every Fastify route has a schema** | Every `.route(...)` or `fastify.get/post/...` call in `apps/api/src/modules/` passes a `schema` with `response` defined |
| **Every API path in docs exists in code** | Every `POST /path` or `GET /path` in `docs/api-and-events.md` §5 has a matching route registration |
| **Every error code is in the constant** | Every code in `docs/api-and-events.md` §4.5 is in `packages/shared-schemas/src/constants/error-codes.ts` |
| **Compose ↔ runtime doc** | `scripts/lint-compose.ts` — service list, ports, and env var references in `compose.yaml` match `docs/runtime-and-environment.md` |

### 4.2 Failure mode

Any violation prints:

- The rule that failed
- The specific doc path and line (or code path) where the mismatch is
- A one-line hint on how to resolve it

CI is blocked until the diff is fixed.

## 5. `schema-drift.yml` — Drizzle schema integrity

Runs when `apps/api/src/db/**` or `apps/api/drizzle/**` changes. Implementation lives in `scripts/schema-drift-check.ts` (spec in `docs/script-specs.md`).

### 5.1 Behavior (three orthogonal checks)

Drizzle Kit's `generate` command compares the TypeScript schema to the prior migration snapshot (`apps/api/drizzle/meta/_journal.json`), NOT to a live database. The workflow therefore performs three distinct checks — each catches a different class of drift (see ADR-011 §Schema drift detection for rationale):

```
Check 1 — journal integrity:
  drizzle-kit check
  → fails on corrupt journal, hand-edited migrations, or internal contradictions

Check 2 — generator round-trip:
  Run `drizzle-kit generate` against current schema code in a temp directory
  → fails if any new migration would be produced (means schema code
    has diverged from committed migrations)

Check 3 — fresh-DB apply round-trip:
  Start fresh Postgres service container
  Apply all committed migrations with `drizzle-kit migrate`
  Introspect the live DB (pg_dump --schema-only or Drizzle introspection)
  Compare against expected shape derived from schema code
  → fails if live DB diverges from code (hand-edited migration that applied
    but diverged from declaration)
```

### 5.2 Meaning of failure

- **Check 1 fails**: the migration journal is corrupt or a migration file was edited after generation. The author must regenerate cleanly: delete the offending migration, adjust schema code, re-run `pnpm --filter api db:generate`, verify the new file.
- **Check 2 fails**: schema code was edited without running `db:generate`. Run `pnpm --filter api db:generate` locally and commit the resulting migration file.
- **Check 3 fails**: a committed migration does not express what the schema code says. Reconcile by either fixing the migration file or fixing the schema code, then re-run check 2 locally.

## 6. Branch protection

Two protected branches: `main` (release target) and `develop` (integration). Rules for `main` are strictly a superset of `develop`. See `docs/git-workflow.md` §8 and §10 for the release-gate flow.

### 6.1 `main` branch protection

- Require PR before merge: **yes**
- PRs may come from: **`develop` only** (or `fix/hotfix-*` in emergencies — see `docs/git-workflow.md` §8.4)
- Require status checks to pass: **yes**. Required checks (all must be green):
  - `ci / typecheck`
  - `ci / lint`
  - `ci / unit`
  - `ci / integration`
  - `ci / build`
  - `ci / e2e-smoke`
  - `ci / check-pr-title`
  - `ci / check-pr-description`
  - `doc-consistency`
  - `schema-drift` (when applicable)
- Require conversations resolved: **yes**
- Require linear history: **yes** (squash-merge on release PRs; no merge commits)
- Require signed commits: **yes**
- Require review from CODEOWNER: **no** (MVP — flip to yes when a second human joins; see `docs/git-workflow.md` §7.3)
- Require 1 approving review: **yes** (PO self-approval allowed)
- Restrict force pushes: **yes** (disallowed)
- Allow deletions: **no**
- Admins cannot bypass: **checked**

### 6.2 `develop` branch protection

Same rules as `main`, with one exception:

- PRs may come from: **`feature/*`**, **`fix/*`**, **`chore/*`**, **`doc/*`**, **`infra/*`**, **`spike/*`**

`spike/*` branches may open draft PRs to verify CI against them, but MUST NOT be merged — they are closed without merging once the spike concludes.

### 6.3 Release tags

After a successful `develop → main` merge:

- The merge commit is tagged `v0.X.0` (minor for workstream releases, patch for hotfixes)
- A release note is committed at `docs/releases/v0.X.0.md` as part of the release PR
- The tag is pushed: `git push origin v0.X.0`

See `docs/git-workflow.md` §8 for the complete release recipe.

## 7. Caching strategy

- **pnpm store**: cached by `pnpm-lock.yaml` hash. Separate cache per Node version.
- **Playwright browsers**: cached by `@playwright/test` version.
- **Docker layers**: `docker buildx` cache via GHA `cache-to: type=gha`.
- **Vite build**: no explicit cache; builds are fast enough cold.

Caches are evicted automatically after 7 days of non-use; this is acceptable for MVP.

## 8. Secrets

For MVP (local-only deployment), CI needs very few secrets:

- `GITHUB_TOKEN` — auto-provided, used by `check-pr-title`.
- No API keys, no deploy keys.

If a secret is ever added:

- Store in GitHub Actions Secrets, not in repo files.
- Document its purpose here in a "Secrets" table.
- Rotate if exposure is suspected.

## 9. Non-blocking jobs

These jobs run but do not block merge:

- `dependency-audit.yml` — nightly; opens an issue per new vulnerability.
- `e2e-extended` (future) — running the full E2E matrix (multi-browser) on a schedule rather than per PR.

## 10. Running CI checks locally

Every CI check MUST be runnable locally via pnpm. Developers and AI sessions can reproduce failures without pushing:

```
pnpm typecheck
pnpm lint
pnpm test                    # unit + integration (starts Testcontainers)
pnpm build
pnpm e2e                     # requires docker compose up first
pnpm doc-consistency         # runs scripts/doc-coverage.ts
pnpm schema-drift            # runs scripts/schema-drift-check.ts
```

The repo root `package.json` defines each script to invoke the same underlying commands GitHub Actions runs. If a check fails in CI but passes locally, the first debugging step is to compare Node and pnpm versions.

## 11. Failure triage

When CI fails:

1. **Read the failing job's summary.** GitHub Actions shows the failing step highlighted.
2. **Open the artifact if there is one.** Playwright traces, E2E logs, schema-drift diff are all uploaded on failure.
3. **Reproduce locally.** Run the same script locally with the same Node/pnpm versions.
4. **Fix the root cause.** Do not retry CI to "see if it passes this time". A flaky test is a bug — fix or delete it.

Repeated flakes on the same test: delete the test, open an issue to restore it once stable.

## 12. What this document enforces

- Any workflow file added/changed requires a matching update to this document in the same PR.
- New required status checks are added to §6 when they're introduced.
- `docs/ai-development-guardrails.md` §11 enforcement matrix cross-references the checks here.
- The repo root README points here for all CI questions.

Drift between this document and `.github/workflows/` is a CI-blocking error once `doc-consistency.yml` learns to detect it (post-MVP enhancement, tracked as an issue).
