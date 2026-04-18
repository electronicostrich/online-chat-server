# Repository Layout
## Online Chat Server

## 1. Purpose

Every file in this repository has a designated home. This document defines the layout so that:

- AI coding sessions know exactly where new code belongs without inventing structure.
- Reviewers can spot misplaced files on sight.
- Boundaries are machine-enforceable via ESLint `no-restricted-imports` rules.

If a file doesn't fit any section below, open an issue to extend the layout before placing it. Do not create new top-level directories ad hoc.

## 2. Top-level tree

```
online-chat-server/
├── CLAUDE.md                      # AI rules and quick reference (root)
├── README.md                      # Human-facing quickstart (root; single .md allowed)
├── compose.yaml             # Local runtime (see docs/runtime-and-environment.md)
├── compose.override.yaml    # (optional) developer overrides, gitignored
├── package.json                   # workspace root; scripts only, no deps except dev-tool-wide
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json             # strict TS options inherited by workspaces
├── tsconfig.json                  # solution file referencing all workspaces
├── eslint.config.js               # flat config, one file for the whole repo
├── prettier.config.js
├── .github/
│   └── workflows/                 # GitHub Actions (see docs/ci-pipeline.md)
├── apps/
│   ├── api/                       # Fastify backend (§3)
│   └── web/                       # React frontend (§4)
├── packages/
│   └── shared-schemas/            # TypeBox schemas + derived types + constants (§5)
├── e2e/                           # Playwright tests against full Compose stack (§6)
├── scripts/                       # Developer utilities (§7)
└── docs/                          # Design + engineering docs (this tree)
```

No other top-level entries are permitted. Add new apps under `apps/`, new libraries under `packages/`.

## 3. `apps/api/` — Backend

```
apps/api/
├── package.json
├── tsconfig.json                  # extends ../../tsconfig.base.json
├── drizzle.config.ts              # Drizzle Kit configuration
├── drizzle/                       # Generated + committed SQL migrations (ADR-011)
├── src/
│   ├── index.ts                   # Fastify server bootstrap; wires plugins and listens
│   ├── config/                    # Env var loading and validation (TypeBox schema for env)
│   ├── db/
│   │   ├── client.ts              # Drizzle client instantiation
│   │   ├── schema/                # One file per entity; re-exported from index.ts
│   │   │   ├── users.ts
│   │   │   ├── sessions.ts
│   │   │   ├── rooms.ts
│   │   │   ├── messages.ts
│   │   │   └── index.ts
│   │   └── seed/                  # Seed scripts (dev + test fixtures)
│   ├── modules/                   # Feature modules; one per capability
│   │   ├── auth/
│   │   │   ├── routes.ts          # Fastify routes; schemas from shared-schemas
│   │   │   ├── service.ts         # Business logic; pure-ish, no Fastify types
│   │   │   └── repository.ts      # DB queries via Drizzle
│   │   ├── rooms/
│   │   ├── messages/
│   │   ├── presence/
│   │   ├── read-state/
│   │   └── attachments/
│   ├── realtime/
│   │   ├── gateway.ts             # @fastify/websocket registration
│   │   ├── subscriptions.ts       # Per-chat subscription registry
│   │   ├── buffer.ts              # Bounded outbound buffer (architecture §20.4)
│   │   └── events.ts              # Event fan-out helpers (after-commit publishers)
│   ├── plugins/                   # Fastify plugins (auth, cors, csrf, swagger, errors)
│   ├── middleware/                # Re-usable pre-handlers (authz checks, rate limit)
│   ├── jobs/                      # Scheduled cleanup jobs (data-model §9)
│   └── lib/                       # Small pure utilities; no Fastify imports
└── test/                          # Vitest unit + integration tests (mirror src/ tree)
```

### Module discipline

A **module** under `apps/api/src/modules/<name>/` is expected to hold all code for a single capability in three files plus optional helpers:

- `routes.ts` — Fastify route definitions. Imports request/response TypeBox schemas from `@chat/shared-schemas`. Calls into `service.ts`. No direct DB access.
- `service.ts` — Business logic. Takes plain arguments; returns plain data. No Fastify-specific types. Calls `repository.ts` for persistence.
- `repository.ts` — Drizzle queries. Returns typed DB rows. No business rules.

This split is enforced by convention plus ESLint import rules (no `fastify` import in `service.ts` or `repository.ts`; no `drizzle-orm` import in `routes.ts`).

## 4. `apps/web/` — Frontend

```
apps/web/
├── package.json
├── tsconfig.json                  # extends ../../tsconfig.base.json
├── vite.config.ts
├── index.html
├── public/                        # Static assets copied as-is
└── src/
    ├── main.tsx                   # React entry
    ├── App.tsx
    ├── routes/                    # TanStack Router routes
    ├── features/                  # Feature-sliced UI (auth, rooms, chat, presence, etc.)
    │   ├── auth/
    │   ├── rooms/
    │   ├── chat/
    │   ├── read-state/
    │   └── presence/
    ├── realtime/                  # WebSocket client, reconnect, sync.request handling
    ├── api/                       # TanStack Query hooks + fetch wrappers; types from shared-schemas
    ├── ui/                        # Presentational components (design primitives)
    └── lib/                       # Small pure utilities
```

### Feature discipline

Each feature under `src/features/<name>/` typically contains:

- `components/` — React components specific to the feature
- `hooks/` — feature-specific hooks (calling TanStack Query layers from `src/api/`)
- `types.ts` — re-exports `import type` from `@chat/shared-schemas` for ergonomics; no runtime code

No feature may import from another feature directly. Shared code moves to `src/ui/`, `src/realtime/`, or `src/api/`. ESLint `import/no-restricted-paths` enforces this.

## 5. `packages/shared-schemas/` — Contract source of truth

See ADR-010 for the full contract.

```
packages/shared-schemas/
├── package.json                   # name: "@chat/shared-schemas"
├── tsconfig.json
└── src/
    ├── index.ts                   # Re-exports everything
    ├── schemas/
    │   ├── auth.ts
    │   ├── rooms.ts
    │   ├── messages.ts
    │   ├── read-state.ts
    │   ├── attachments.ts
    │   ├── events.ts              # WebSocket event payloads
    │   └── envelopes.ts           # ErrorEnvelope, PaginationEnvelope, EventEnvelope
    └── constants/
        ├── error-codes.ts         # Union of every error code (api-and-events.md §4.5)
        ├── limits.ts              # Size limits, timeouts
        └── roles.ts               # Room role enum values
```

**Allowed exports**: TypeBox schemas, derived TypeScript types, constants, pure utility functions.
**Forbidden exports**: any runtime module with side effects; any module that imports from `apps/*`; any ORM model.

## 6. `e2e/` — Playwright tests

```
e2e/
├── package.json                   # Playwright dev dep; no runtime deps
├── playwright.config.ts           # Base URL points at Compose api/web services
├── fixtures/                      # Test fixtures (users, rooms) created via __test/seed API
├── specs/                         # One file per AC, named AC-<ID>-<slug>.spec.ts
│   ├── AC-AUTH-01-registration.spec.ts
│   ├── AC-AUTH-02-duplicate-registration.spec.ts
│   └── ...
└── utils/                         # Shared test helpers (login, create-room, etc.)
```

File naming: `AC-<ID>-<kebab-slug>.spec.ts`. The `AC-<ID>` prefix is parsed by CI to assert coverage of every AC ID in `docs/acceptance-criteria-pack.md` (see `docs/traceability.md` and `docs/testing-strategy.md`).

## 7. `scripts/` — Developer utilities

```
scripts/
├── dev-bootstrap.sh               # One-shot: pnpm install → compose up → migrate → seed
├── doc-coverage.ts                # Checks traceability.md ↔ AC pack ↔ Playwright tests
├── schema-drift-check.ts          # Invoked by schema-drift.yml
└── lint-compose.ts                # Verifies compose.yaml matches runtime-and-environment.md
```

All scripts are TypeScript (`.ts`) executed via `pnpm dlx tsx` to avoid a separate build step. No shell scripts beyond `dev-bootstrap.sh`.

## 8. `docs/` — Documentation

Already established. See `docs/README.md` for the full index.

## 9. Import rules (ESLint-enforced)

The following rules live in `eslint.config.js` and fail the `pnpm lint` check:

1. **`apps/web/*` MUST NOT import from `apps/api/*`.** Enforced via `no-restricted-imports` pattern match.
2. **`apps/api/src/modules/*/service.ts` and `repository.ts` MUST NOT import from `fastify`.** Business logic is framework-agnostic.
3. **`apps/api/src/modules/*/routes.ts` MUST NOT import from `drizzle-orm` directly.** Queries go through `repository.ts`.
4. **Features in `apps/web/src/features/<a>` MUST NOT import from `apps/web/src/features/<b>`.** Cross-feature code moves to `src/ui/`, `src/api/`, or `src/realtime/`.
5. **No file outside `packages/shared-schemas` may define a wire-shape TypeScript interface.** The schema/type split is enforced by convention and a doc-consistency CI check.
6. **No file may import from `zod`, `joi`, `yup`, or `ajv` directly.** TypeBox is the only schema library (ADR-010).
7. **`apps/api/src/modules/*` MUST NOT import from `apps/api/src/db/schema/*` directly.** Schema imports go through the repository layer.

## 10. Naming conventions

- **Files**: kebab-case (`read-state.ts`), not camelCase.
- **Directories**: kebab-case, singular for feature names (`modules/room/` → no, use `modules/rooms/` because it's a capability with many rooms).
- **Tests**: co-located with code for Vitest units (`*.test.ts` next to the file), mirrored in `test/` for integration. Playwright tests live exclusively in `e2e/specs/` with the `AC-<ID>-` prefix.
- **Drizzle migrations**: auto-generated names from Drizzle Kit (`0001_<slug>.sql`); do not rename.

## 11. What goes in root README.md

- One-paragraph product description.
- Quickstart: clone → `pnpm install` → `docker compose up` → open `http://localhost:5173`.
- Link to `docs/README.md` for everything else.
- Nothing more. Long-form docs belong under `docs/`.
