# Testing Strategy
## Online Chat Server

## 1. Purpose

This document defines what gets tested, how, and where — for a project where nearly all code is AI-generated and tests are the load-bearing guarantee of correctness. The goals are:

1. Every acceptance criterion in `docs/acceptance-criteria-pack.md` has an automated, deterministic test.
2. Tests are cheap to run locally, fast in CI, and trustworthy enough that a green pipeline means a mergeable PR.
3. Humans — especially the non-technical PO — can read a test name and know which AC it verifies without reading the code.

## 2. Test pyramid (for this project specifically)

| Tier | Tool | Speed | Coverage target | Purpose |
|---|---|---|---|---|
| **Unit** | Vitest | ms | State-model transitions, pure business logic in `service.ts`, schema shape tests | Prove individual functions behave per spec |
| **Integration** | Vitest + Testcontainers (Postgres, Redis) | 100ms–1s per test | Every route handler, every repository query, every migration | Prove the backend wiring actually connects to a real database and yields correct stored state |
| **E2E** | Playwright + full Docker Compose | seconds per test | Every AC in `acceptance-criteria-pack.md` | Prove the whole system satisfies the product contract |

No other test tiers (component tests, snapshot tests, visual regression) are adopted for MVP. Reasoning: each added tier multiplies maintenance cost; the three above are sufficient to catch >95% of AI-introduced regressions.

## 3. Unit tests (Vitest)

### 3.1 What to cover

- Every function in `apps/api/src/modules/*/service.ts` that has more than one code path.
- Every state-model transition function (e.g., `computePresence(liveTabs, activityThresholds)`).
- Pagination cursor math.
- Sequence allocation correctness.
- Normalization functions (trim + NFC + whitespace + case-insensitive for usernames and room names).

### 3.2 What NOT to cover

- Fastify plugin internals (we don't own them).
- Drizzle query syntax (the integration tier covers behavior).
- Trivial getters/setters.
- React components' shallow render output. Use Playwright against the running app instead.

### 3.3 Conventions

- Test files live alongside their source: `service.ts` ↔ `service.test.ts`.
- One `describe` block per function, one `it` per branch.
- Vitest `vi.setSystemTime` is the canonical clock mock; never stub `Date.now` directly.
- Assertion style: `expect(x).toEqual(y)` — do not use `toBe` for object comparisons.

### 3.4 Running

```
pnpm --filter api test         # runs all api unit + integration tests
pnpm --filter api test:unit    # unit only (fast)
pnpm --filter web test         # web package unit tests (sparse; see §3.2)
```

## 4. Integration tests (Vitest + Testcontainers)

### 4.1 What to cover

- Every Fastify route. The route is called via an in-process test client (`fastify.inject`) against a real Postgres and Redis, and the assertion is on response body AND persisted DB state.
- Every Drizzle repository function with side effects.
- Every scheduled cleanup job (data-model §9 cleanup contract) — run the job handler, assert rows disappeared.
- Every migration (applied against an empty DB, then against a populated DB to prove forward-compatibility).

### 4.2 Infrastructure

- Testcontainers spins up ephemeral Postgres and Redis containers per test suite (NOT per test — that's too slow).
- Schema is reset between tests via `TRUNCATE ... CASCADE` rather than re-running migrations.
- Seed data is created via the same helpers E2E tests use (`e2e/utils/seed.ts`), calling the dev-only `POST /__test/seed` endpoint specified in §4.3 below.

### 4.3 `POST /__test/seed` contract

This is the canonical way Playwright and integration tests create fixtures. It is deliberately a real HTTP endpoint (not a DB-level hack) so tests exercise the same persistence paths production uses.

#### Registration guard

The route is registered ONLY when `process.env.NODE_ENV === 'test'`. In any other environment, Fastify returns 404. The guard is unit-tested in `apps/api/test/unit/plugins/test-seed.test.ts` with `NODE_ENV` flipped to `production` and `test`.

#### Production-image check

The production Docker image build script (`apps/api/Dockerfile`, `prod` stage) runs `grep -R __test dist/` after bundling. Any match fails the build. This prevents accidental leakage even if the env-var guard is bypassed.

#### Request body

```json
{
  "strategy": "truncate",
  "users": [
    { "username": "alice", "email": "alice@test.local", "password": "TestPassword1!" }
  ],
  "rooms": [
    { "name": "engineering", "ownerUsername": "alice", "visibility": "public" }
  ],
  "memberships": [
    { "roomName": "engineering", "username": "bob", "role": "member" }
  ],
  "friendships": [
    { "userA": "alice", "userB": "bob" }
  ],
  "blocks": [
    { "blocker": "charlie", "blocked": "dave" }
  ],
  "messages": [
    { "chatRef": { "roomName": "engineering" }, "authorUsername": "alice", "bodyText": "hello" }
  ]
}
```

Top-level fields:

| Field | Type | Meaning |
|---|---|---|
| `strategy` | `"truncate" \| "upsert"` | `truncate`: wipe DB before inserting (integration tests); `upsert`: insert only if not already present by natural key (E2E shared state). Default: `truncate`. |
| `users` | array | Users created. Password is hashed normally. |
| `rooms` | array | Rooms created. `ownerUsername` must match a user already created (or in the same request). |
| `memberships` | array | Extra memberships on existing rooms. |
| `friendships` | array | Symmetric friendships. |
| `blocks` | array | Directed blocks. |
| `messages` | array | Messages appended in the order given. `chatRef` is either `{ roomName }` or `{ dm: [userA, userB] }`. |

All arrays are optional; absent = empty.

#### Response

```json
{
  "createdIds": {
    "users": { "alice": "uuid-1", "bob": "uuid-2" },
    "rooms": { "engineering": "chat-uuid-1" },
    "messages": ["msg-uuid-1"]
  }
}
```

Wrapped per §5.0 of `api-and-events.md`: `{ "data": { "createdIds": {...} } }`.

#### Error handling

Any reference to a non-existent natural key (e.g., `ownerUsername` that wasn't created) → `VALIDATION_ERROR` with `details.unresolvedRefs` listing each.

#### TypeBox schemas

Live at `packages/shared-schemas/src/schemas/test-seed.ts`. The request schema is the source of truth; any test helper in `e2e/utils/seed.ts` MUST derive its argument type from `Static<typeof TestSeedRequestSchema>`.

#### Out-of-scope for seed

- User sessions: the seed creates users but does NOT create sessions. Tests log in via the real `/auth/login` endpoint. This keeps the session-cookie path exercised.
- Attachments: the seed does NOT create attachment binaries. Tests upload via `/chats/{id}/attachments`.
- Presence state: ephemeral by design.

### 4.3 Conventions

- Test files live under `apps/api/test/integration/` mirroring the source tree.
- Each test file beats a single route or a single repository function.
- Never skip a test due to flake — fix or delete it.

### 4.4 Running

```
pnpm --filter api test:integration   # spins up Testcontainers, runs suite
```

## 5. End-to-end tests (Playwright)

### 5.1 The AC-to-test mapping

**Every acceptance criterion MUST have at least one Playwright test**, named `AC-<ID>-<slug>.spec.ts` (e.g., `AC-AUTH-03-login-session.spec.ts`). This is the PO's contract. The `docs/traceability.md` table encodes the mapping; `scripts/doc-coverage.ts` verifies it in CI.

An AC MAY have additional tests (edge cases, regressions) in the same file, but the file name must begin with the canonical AC ID.

### 5.2 What Playwright tests verify

For each AC the test:

1. Seeds the required state (users, rooms, memberships) via `POST /__test/seed`.
2. Drives the browser through the user flow using Playwright locators.
3. Asserts user-visible behavior (text in DOM, URL changes, toasts).
4. Asserts persisted backend state where the AC requires it (by hitting a read API, not by peeking into the DB — the goal is to validate the contract, not implementation details).

### 5.3 Structure

```
e2e/
├── playwright.config.ts
├── fixtures/
│   ├── test-users.ts            # factory helpers wrapping seed API
│   └── test-rooms.ts
├── utils/
│   ├── login.ts                 # page.goto + form submit + wait for post-login state
│   ├── create-room.ts
│   ├── wait-for-ws-event.ts
│   └── seed.ts
└── specs/
    ├── AC-AUTH-01-registration.spec.ts
    ├── AC-AUTH-02-duplicate-registration.spec.ts
    ├── ...
    └── AC-UI-04-moderation-ui.spec.ts
```

### 5.4 Conventions

- No hard-coded `page.waitForTimeout(…)`. Use `expect.poll` or Playwright's auto-waiting locators.
- No cross-test dependencies. Each test seeds its own state and cleans up after itself (or uses `test.beforeEach` with DB truncation).
- Exactly one browser context per test. Multi-context tests (multi-tab, multi-user) use `browser.newContext()` explicitly.
- Selectors prefer `data-testid` attributes for anything ambiguous. Rule: if a test is flaky because of selector ambiguity, add a `data-testid` to the UI — don't fight it with complex selectors.
- Network interception is rarely used; tests run against the real backend. If the test requires something the backend can't easily produce, extend `POST /__test/seed`.

### 5.5 Multi-tab and WebSocket tests

Tests that assert real-time behavior (e.g., AC-UNREAD-04, AC-RT-01) open multiple browser contexts:

```ts
const ctxAlice = await browser.newContext();
const ctxAliceTab2 = await browser.newContext({ storageState: ctxAlice.storageState });
const ctxBob = await browser.newContext();
// ...
```

The shared `storageState` carries Alice's session cookie to her second tab. `utils/wait-for-ws-event.ts` provides a helper to await a specific WebSocket event in a page.

### 5.6 Running

```
# Local (requires docker compose up first)
pnpm e2e                         # runs all specs headless
pnpm e2e --ui                    # Playwright UI mode
pnpm e2e AC-AUTH-01              # filters by prefix

# CI
# Runs automatically on every PR (see docs/ci-pipeline.md → ci.yml)
```

## 6. Contract tests

The TypeBox schemas in `packages/shared-schemas` ARE the contract. No additional contract-testing framework (Pact, etc.) is used. The CI enforces contract correctness by:

1. **Type check**: frontend and backend both compile against the same schemas → drift is a compile error.
2. **Schema-drift check** (`docs/ci-pipeline.md` → `schema-drift.yml`): comparing committed Drizzle schema against freshly generated migrations.
3. **Doc-consistency check**: verifying every route file declares a schema property, every AC ID maps to a test, every error code appears in both the doc and the TypeScript constant.

## 7. Accessibility testing

Playwright tests MAY assert basic accessibility invariants using `@axe-core/playwright`. Specifically, any test for a UI AC (`AC-UI-*`) includes an axe scan on the page under test, failing the test if there are any errors of severity `serious` or higher.

This is not a comprehensive accessibility audit; it is a regression gate. A proper accessibility review happens separately if the product ships to real users.

## 8. Performance testing

Out of scope for MVP. No load tests, no latency budgets. The `WEBSOCKET_BUFFER_SIZE` and stale-socket thresholds are asserted indirectly by AC-RT-06.

## 9. What makes a good AI-written test (for this project)

When AI writes a test, reviewers and CI look for:

- **Name starts with the AC ID.** If it doesn't, the test does not count toward AC coverage.
- **Seeds its own state.** No reliance on a previous test's side effects.
- **Asserts behavior, not implementation.** "The user sees X" is good; "method Y was called with Z" is bad outside of unit tests.
- **Fails loudly on the first regression.** Don't catch and ignore errors. Don't wrap assertions in retries.
- **Deterministic.** No dependence on wall-clock, no dependence on random UUIDs sneaking into assertions.

When AI-written tests break these rules, the PR review rejects them. `docs/ai-development-guardrails.md` codifies the rejection criteria.

## 10. Coverage expectations

- **Unit**: no line-coverage floor. Focus is on branch coverage for business logic. Coverage reports are informational.
- **Integration**: every route handler has at least one happy path test and one unauthorized-failure test.
- **E2E**: 1-to-1 with ACs. Missing an AC's E2E test fails CI.

## 11. What this document enforces

- CI rejects PRs that introduce new ACs without matching Playwright tests.
- CI rejects PRs that remove Playwright tests without an accompanying AC removal in `acceptance-criteria-pack.md` AND a row removal in `traceability.md`.
- CI rejects PRs that add a new Fastify route without a response schema in `packages/shared-schemas`.
- `docs/ai-development-guardrails.md` §3 "Test-first preference" codifies the TDD-lite rhythm Claude Code sessions are expected to follow.
