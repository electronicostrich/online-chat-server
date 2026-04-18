# Script Specifications
## Online Chat Server

## 1. Purpose

Several workflows and developer commands reference custom TypeScript scripts under `scripts/`. This document specifies each script's **inputs, outputs, exit codes, and core algorithm** so that an AI coding session (or a human) implementing them has a single deterministic target instead of a prose description.

All scripts live under `scripts/` at the repo root, are written in TypeScript, and are executed via `pnpm dlx tsx scripts/<name>.ts` (or `pnpm <alias>` where a shorthand is defined in `package.json`).

## 2. Conventions for every script

### 2.1 Exit codes

Every script MUST use this convention:

| Code | Meaning |
|---|---|
| `0` | All checks passed. |
| `1` | One or more rule violations found (expected-failure state). |
| `2` | Tool error — dependency missing, file unreadable, unexpected exception. |

CI treats `1` as "PR blocked, author fix required" and `2` as "CI operator fix required". Never collapse the two.

### 2.2 Output format

- **Human format** (default when stdout is a TTY): one line per rule check with ✓/✗ prefix, plus a summary footer. Colours optional.
- **JSON format** (when invoked with `--json` or when stdout is piped in CI): a single JSON object on stdout with:

  ```json
  {
    "script": "doc-coverage",
    "status": "pass" | "fail" | "error",
    "checks": [
      { "name": "...", "status": "pass" | "fail", "details": "..." }
    ],
    "errors": [ "..." ]
  }
  ```

CI runs every script with `--json` and parses the result for GitHub-annotation output.

### 2.3 Parsing strategy

- **Doc parsing** (when the input is a markdown file): use [`remark`](https://github.com/remarkjs/remark) to produce an AST, then walk headings/tables. Never regex-parse markdown tables — table cells with embedded code or pipes break regexes.
- **Code parsing** (when the input is TypeScript): use [`ts-morph`](https://ts-morph.com/) to produce a program and walk the AST. Never regex-parse TypeScript for call sites or decorators — template literals, comments, and multi-line strings defeat regex.
- **YAML parsing**: use `yaml` (the npm package), not hand-rolled splitting.
- **JSON parsing**: `JSON.parse` is fine; validate against a TypeBox schema where the file is a config.

### 2.4 Shared utilities

Scripts share helpers in `scripts/_lib/`:

- `scripts/_lib/markdown.ts` — remark wrappers (headings, tables, links)
- `scripts/_lib/source.ts` — ts-morph wrappers (routes, schemas, decorators)
- `scripts/_lib/report.ts` — human + JSON output formatter

New scripts SHOULD reuse these helpers rather than re-implementing.

## 3. `scripts/doc-coverage.ts`

### Purpose

Verify the doc-and-code consistency invariants in `docs/traceability.md` §15.

### Input

- No CLI arguments.
- Reads these files at runtime:
  - `docs/acceptance-criteria-pack.md` — source of truth for AC IDs
  - `docs/traceability.md` — the mapping
  - `docs/api-and-events.md` — source of truth for REST endpoints and event types
  - `e2e/specs/**/*.spec.ts` — Playwright test files
  - `apps/api/src/modules/**/routes.ts` — Fastify route registrations
  - `packages/shared-schemas/src/schemas/**/*.ts` — TypeBox schemas
  - `packages/shared-schemas/src/constants/error-codes.ts` — error-code union

### Algorithm

1. Extract the set of AC IDs from `acceptance-criteria-pack.md` by walking the AST for headings matching `AC-[A-Z]+-\d+`.
2. Extract the set of AC IDs from `traceability.md` by walking every table row's "AC ID" column.
3. Extract the set of Playwright spec filenames from `e2e/specs/**/*.spec.ts`. Strip the `.spec.ts` suffix and `AC-XXX-` prefix to normalize.
4. Extract the set of REST paths from `api-and-events.md` by finding every heading matching `(GET|POST|PATCH|DELETE|PUT)\s+\``.
5. Extract the set of registered routes from `apps/api/src/modules/**/routes.ts` via ts-morph — find every call to `fastify.get|post|patch|delete|put` or `fastify.route({ method, url })`.
6. Extract the set of error-code string literals from `api-and-events.md` §4.5 and from `packages/shared-schemas/src/constants/error-codes.ts` (the exported union type).
7. Extract the set of event types from `api-and-events.md` §6.4 and compare against TypeBox schemas in `packages/shared-schemas/src/schemas/events.ts`.

### Checks

- `ac-pack-has-traceability-row` — every AC in `acceptance-criteria-pack.md` appears in `traceability.md`
- `traceability-ac-exists` — every AC in `traceability.md` exists in `acceptance-criteria-pack.md`
- `ac-has-playwright-test` — every AC in `traceability.md` has a Playwright file matching `AC-<ID>-*.spec.ts`
- `playwright-matches-ac` — every Playwright file matches some AC in `acceptance-criteria-pack.md`
- `api-path-matches-route` — every path in `api-and-events.md` has a registered Fastify route; every registered route has a path in the doc
- `route-has-schema` — every `fastify.get|post|...` call includes a `schema` option with `response` defined (ts-morph check on the call-expression arguments)
- `error-code-parity` — the set of codes in `api-and-events.md` §4.5 equals the set in `error-codes.ts`
- `event-type-parity` — the set of event types in `api-and-events.md` §6.4 equals the set in `events.ts`

### Output

Per §2.2. Exit `0` if every check passes; `1` otherwise. Each failing check's `details` string names the specific offending IDs/paths.

### Complexity budget

Must complete under 5 seconds on the full repo at MVP scale (~50 ACs, ~50 routes). If it exceeds this, profile; do not skip checks.

## 4. `scripts/schema-drift-check.ts`

### Purpose

Implement the three-check Drizzle schema-drift workflow from ADR-011 §Schema drift detection and `docs/ci-pipeline.md` §5.

### Input

- Env var `DATABASE_URL` — connection string to a Postgres instance the script can fully control.
- Env var `DRIZZLE_DIR` — defaults to `apps/api/drizzle`.
- Env var `SCHEMA_DIR` — defaults to `apps/api/src/db/schema`.

### Algorithm

1. **Check 1 — journal integrity**: invoke `drizzle-kit check` as a subprocess. Non-zero exit → check fails; capture stdout+stderr as the details.
2. **Check 2 — generator round-trip**: create a temp directory. Copy `DRIZZLE_DIR` into it. Invoke `drizzle-kit generate` pointing at `SCHEMA_DIR` with out-dir set to the temp copy's migration folder. If the command creates any new file or modifies `meta/_journal.json`, check fails. Clean up the temp directory regardless.
3. **Check 3 — fresh-DB apply round-trip**: drop and recreate the target database (`DROP DATABASE IF EXISTS drift_check; CREATE DATABASE drift_check;`). Connect to it and invoke `drizzle-kit migrate` against `DRIZZLE_DIR`. Then dump the resulting schema with `pg_dump --schema-only --no-owner --no-privileges`. Compare the dump against a canonical expected dump derived from the schema code (via Drizzle introspection API). If the diff is non-empty, check fails.

### Output

Per §2.2. Three `checks[]` entries, one per check. Fail on any.

### Safety

Never runs check 3 against a database named anything other than `drift_check` or whatever `DRIFT_CHECK_DB_NAME` env var specifies. Hard-refuses to drop a DB whose name contains "prod", "production", "main", or "master".

## 5. `scripts/lint-compose.ts`

### Purpose

Verify that `compose.yaml` matches the service, port, volume, and env-var references in `docs/runtime-and-environment.md` §2–§6.

### Input

- `compose.yaml` at repo root
- `docs/runtime-and-environment.md`
- `.env.example` at repo root

### Algorithm

1. Parse `compose.yaml` via the `yaml` package.
2. Extract the set of declared services, their ports, their volumes, and their `environment:` keys.
3. Walk `runtime-and-environment.md` §2 table to get the expected service list.
4. Walk §3 table for volumes, §4 for healthchecks, §6 for env vars.
5. Walk `.env.example` line-by-line to get the documented env keys.

### Checks

- `services-match` — Compose services = doc §2 services (by name)
- `ports-match` — each Compose port mapping appears in doc §2
- `volumes-match` — each declared volume appears in doc §3
- `healthchecks-present` — every service in doc §4 has a matching `healthcheck:` in Compose
- `env-keys-match` — every env key read by `api` per doc §6.1 appears in `.env.example` with a placeholder value
- `env-keys-no-orphans` — every key in `.env.example` is documented in §6.1/§6.2/§6.3

### Output

Per §2.2.

## 6. `scripts/check-pr-description.ts`

### Purpose

Enforce the PR description template requirements from `docs/ai-development-guardrails.md` §4.2.

### Input

- CLI arg `--body-file <path>` pointing at a file containing the PR body (GitHub Actions writes the PR body to a file in the workflow).
- CLI arg `--title <string>` the PR title.

### Algorithm

1. Read the title. Verify it matches `^(AC-[A-Z]+-\d+|CHORE|DOC|INFRA|SPIKE|fix):\s.+`.
2. Read the body. Verify these H2 (`##`) sections exist:
   - `## Summary`
   - `## AC IDs addressed` (may be "None — see PR title tag" if title is `CHORE:` / `DOC:` / `INFRA:` / `SPIKE:`)
   - `## Docs updated`
   - `## Testing`
3. If title starts with `AC-...`, the "AC IDs addressed" section MUST list at least one AC ID.
4. If any `apps/api/drizzle/*.sql` file changed in this PR (determined by an env var `CHANGED_FILES` set by the workflow), the "Docs updated" section MUST include `docs/data-model.md`.
5. If any `docs/adr/ADR-*.md` file was changed, the "Summary" must reference the ADR number.

### Output

Per §2.2.

## 7. `scripts/check-suppressions.ts`

### Purpose

Implement the "no new `eslint-disable` / `@ts-expect-error` / `as any` without issue link" rule from `docs/ai-development-guardrails.md` §5.1.

### Input

- CLI arg `--base <ref>` — git ref to compare against (default: `origin/main`).
- CLI arg `--head <ref>` — git ref for the head (default: `HEAD`).

### Algorithm

1. For each suppression pattern in `SUPPRESSION_PATTERNS`:
   ```
   eslint-disable
   eslint-disable-next-line
   eslint-disable-line
   @ts-ignore
   @ts-expect-error
   @ts-nocheck
   \bas any\b
   \bas unknown as\b
   ```
2. Count occurrences in each of base and head via `git grep -c <pattern> <ref>` across the repo (excluding `.lock`, `.generated.`, etc.).
3. Compare counts. If head > base for ANY pattern, the check fails and the script prints the delta plus the list of files where the count rose.
4. Separately: scan the diff between base and head for any NEW line (git-diff `+` lines) matching any pattern. For each such line, require the same line also contain `(#\d+)` or `TODO(#\d+)`. If missing, the check fails.

### Output

Per §2.2. Details include file:line for each offending new suppression.

### Why two-step (count + issue-link)

Count-only rejects any net-new suppression (stricter). Issue-link rejects any suppression without traceability (less strict). Running both gives defense in depth: the count check catches aggregate growth, and the issue-link check catches individual sloppiness even when the count happens to drop.

## 8. `scripts/check-test-substance.ts`

### Purpose

Implement the "Playwright tests MUST assert against a real HTTP call" rule from `docs/ai-development-guardrails.md` §5.6.

### Input

- No args. Reads every file under `e2e/specs/*.spec.ts`.

### Algorithm

Using ts-morph:

1. For each spec file, find every `test(...)` or `test.step(...)` block.
2. Within each block, collect:
   - count of `expect(...)` calls
   - whether any `expect` argument chain references a variable whose value originated from a `request.fetch(...)`, `page.goto(...)`, `page.click(...).then(...)` → response, or an `await fetch(...)` / `await request.get/post(...)` expression.
   - whether any assertion asserts against a tautology like `expect(true).toBe(true)`, `expect(1).toBeTruthy()`, `expect([]).toEqual([])`.
3. A block passes if:
   - it has at least 1 `expect` AND
   - at least one `expect` traces to an HTTP-response variable or a Playwright locator rooted in `page.goto(<app URL>)` AND
   - no assertion matches the tautology allowlist

### Output

Per §2.2. A failing block's details: `<file>:<line> <testName> — <reason>`.

### Limitations

ts-morph can only see what's statically evaluable. If a test uses indirection through a helper function, the helper is inlined by the checker up to 2 levels deep. Deeper indirection is treated as "cannot verify" and the test is allowed to pass with a warning (`status: "warn"`). Warnings do not fail CI but are reported.

## 9. `scripts/dev-bootstrap.sh`

### Purpose

One-shot "clone → running app" path for a new contributor or a fresh Claude Code session.

### Input

- Nothing. Reads the current working directory.

### Algorithm

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Prereq check — pnpm plus exactly one of podman/docker
command -v pnpm >/dev/null || { echo "pnpm missing. install: npm i -g pnpm"; exit 2; }

# Auto-detect container runtime unless CONTAINER_CLI already set.
CONTAINER_CLI="${CONTAINER_CLI:-$(command -v podman 2>/dev/null || command -v docker 2>/dev/null)}"
if [ -z "$CONTAINER_CLI" ]; then
  echo "podman or docker required. install one:"
  echo "  brew install podman && podman machine init && podman machine start"
  echo "  # OR Docker Desktop from https://docker.com"
  exit 2
fi
echo "Using container runtime: $CONTAINER_CLI"

# 2. Install deps
pnpm install --frozen-lockfile

# 3. .env.local — generate secrets on first run
if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  SESSION_SECRET=$(pnpm dlx tsx scripts/generate-secret.ts)
  CSRF_SECRET=$(pnpm dlx tsx scripts/generate-secret.ts)
  # Portable sed: BSD (macOS) requires '' after -i; GNU (linux) rejects it.
  if sed --version >/dev/null 2>&1; then
    sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SESSION_SECRET|" .env.local
    sed -i "s|^CSRF_SECRET=.*|CSRF_SECRET=$CSRF_SECRET|" .env.local
  else
    sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=$SESSION_SECRET|" .env.local
    sed -i '' "s|^CSRF_SECRET=.*|CSRF_SECRET=$CSRF_SECRET|" .env.local
  fi
  echo "Created .env.local with generated secrets."
fi

# 4. Start stack
"$CONTAINER_CLI" compose up -d

# 5. Wait for healthz
echo "Waiting for api to become healthy..."
for i in {1..30}; do
  if curl -sf http://localhost:3000/healthz >/dev/null 2>&1; then
    echo "healthz green after ${i}x2s"
    break
  fi
  sleep 2
done

# 6. Verify all services healthy
"$CONTAINER_CLI" compose ps

# 7. Seed (optional)
if [[ "${SEED:-1}" == "1" ]]; then
  pnpm --filter api db:seed || true
fi

echo "Ready: http://localhost:5173"
```

### Exit codes

- `0` — stack is healthy and seeded
- `2` — prereq missing (pnpm, or neither podman nor docker)
- any other — whatever underlying command failed

### Notes for podman on macOS

If podman is detected but `podman compose up -d` fails with a socket error, the podman machine probably isn't running. The script prints the remediation (`podman machine start`) rather than attempting to start the machine itself — we don't want the bootstrap script to silently modify VM state.

## 10. `scripts/generate-secret.ts`

### Purpose

Emit a cryptographically random 32-byte value in hex or base64, for populating `SESSION_SECRET` / `CSRF_SECRET` in `.env.local`.

### Input

- CLI arg `--bytes <n>` (default 32)
- CLI arg `--format hex|base64` (default `hex`)

### Algorithm

```ts
import { randomBytes } from 'node:crypto';
const bytes = parseInt(arg('--bytes') ?? '32', 10);
const format = arg('--format') ?? 'hex';
process.stdout.write(randomBytes(bytes).toString(format));
```

### Output

Writes the secret to stdout. No newline in `hex`; newline in `base64` only if the encoding includes one. Scripts calling this should NOT pipe through shells that might add quoting.

### Exit

Always `0` unless crypto is unavailable (exit `2`).

## 11. `scripts/_lib/` shared helpers

### `markdown.ts`

```ts
export function parseMarkdown(filepath: string): Root;
export function walkHeadings(ast: Root, depth: number): { text: string; line: number }[];
export function walkTableRows(ast: Root): { cells: string[]; line: number }[];
export function walkCodeLinks(ast: Root): { path: string; line: number }[];
```

### `source.ts`

```ts
export function parseProject(tsconfigPath: string): Project;
export function findFastifyRoutes(project: Project): { method: string; url: string; hasSchema: boolean; file: string; line: number }[];
export function findTypeBoxSchemas(project: Project): { name: string; file: string; kind: 'object' | 'union' | 'other' }[];
```

### `report.ts`

```ts
export type CheckResult = { name: string; status: 'pass' | 'fail' | 'warn'; details?: string };
export function report(script: string, checks: CheckResult[], opts: { json: boolean }): never; // process.exit
```

## 12. When a script is added or changed

The script MUST:

1. Follow the exit-code and output conventions in §2.
2. Have a corresponding entry in this document.
3. Have a unit test under `scripts/test/` for its checks (where the check logic is non-trivial). Happy path + one failure case minimum.
4. Be invocable from `pnpm <alias>` — update the root `package.json` scripts map in the same PR.

No exceptions. A script added without a spec is drift.
