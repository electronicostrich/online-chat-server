# ADR-009: Lock the Implementation Stack on TypeScript + Node + Fastify + React

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

The documentation pack is tech-stack-agnostic by design (see PRD, architecture overview, and ADR-007 "Modular Monolith"). But before any implementation can begin, the stack must be locked to a single choice so that Claude Code sessions and human contributors do not independently invent different stacks across workstreams.

The project has the following constraints that shape the choice:

- **Modular monolith, PostgreSQL + Redis, local Docker Compose MVP** (ADR-007, ADR-008).
- **Hybrid REST + WebSocket transport** with strict contract discipline and sequence-aware sync (ADR-001, ADR-003).
- **AI-first development**: nearly all code is expected to be written by Claude Code. The stack must maximise training-data prevalence, static type enforcement, and schema-driven contracts so that drift is cheap to detect.
- **Playwright-first testing preference.**
- **GitHub Actions for CI.**
- **Single-language stack preferred** to reduce cross-boundary type drift and review surface for a non-technical PO.

## Decision

Lock the following stack:

### Language and runtime

| Layer | Choice | Version target |
|---|---|---|
| Language (backend and frontend) | **TypeScript** | strict mode, project references |
| Backend runtime | **Node.js** | **24 LTS** (current active LTS line; upgrade on annual LTS cycle) |
| Package manager | **pnpm** | latest stable |
| Monorepo layout | **pnpm workspaces** | no Turborepo/Nx unless ADR update |

### Backend

| Concern | Choice |
|---|---|
| HTTP framework | **Fastify** (schema-driven; strong performance; built-in type provider) |
| Schema source of truth | **TypeBox** (see ADR-010) |
| Database driver / ORM | **Drizzle** (see ADR-011) |
| Ephemeral state | **Redis** (ADR-008) |
| Session auth | **Server-managed revocable cookie sessions** (see architecture overview §13) |
| WebSocket | **`@fastify/websocket`** |
| Password hashing | **`@node-rs/argon2`** (argon2id) |
| File uploads | **`@fastify/multipart`** streamed to local volume (ADR-006) |
| OpenAPI | **`@fastify/swagger`** + `@fastify/swagger-ui` generated from route schemas |

### Frontend

| Concern | Choice |
|---|---|
| Framework | **React 19** |
| Build tool | **Vite 8** |
| Server-state client | **TanStack Query v5** |
| Routing | **TanStack Router** (aligned with TanStack Query; avoids React-Router magic) |
| WebSocket | **Native `WebSocket` API** wrapped in a thin reconnecting client in `apps/web/src/realtime/` |
| Styling | **Vanilla CSS modules** for MVP (no UI framework locked-in; design system deferred) |
| Forms | Plain React forms + TypeBox-derived validators; no global form framework |

### Testing and quality

| Concern | Choice |
|---|---|
| Unit/integration tests | **Vitest** |
| E2E tests | **Playwright** (the canonical AC verification surface — see `docs/testing-strategy.md`) |
| Linting | **ESLint** with `@typescript-eslint/strict-type-checked` + `eslint-plugin-import` + `eslint-plugin-playwright` |
| Formatting | **Prettier** (single config at repo root) |
| TS config | **`strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, project references between workspaces** |

### Deployment (MVP)

| Concern | Choice |
|---|---|
| Packaging | **Compose v2** (`compose.yaml`) for local-only MVP |
| Container runtime | **Podman OR Docker** — any OCI-compatible runtime with Compose v2 support |
| Node container image | **`node:24-alpine`** pinned by digest |
| Postgres image | **`postgres:17-alpine`** pinned by digest |
| Redis image | **`redis:7-alpine`** pinned by digest |
| Mail sink (dev) | **`axllent/mailpit`** pinned by digest |

Production / cloud deployment is out of MVP scope and will be addressed in a future ADR.

#### Runtime neutrality

The PO develops with **rootless podman** on macOS (via `podman-machine-default`). Future collaborators and GitHub Actions use **rootful Docker**. Both read the same `compose.yaml` and `Dockerfile`. Scripts use a `CONTAINER_CLI` env var with auto-detection (see `docs/runtime-and-environment.md` §1.1). Digest-pinning, health-check semantics, and bind-mount behaviour are runtime-agnostic. The stack intentionally avoids:

- `docker build`-only features (BuildKit extensions not yet in podman) — stick to Compose Spec + stable Dockerfile syntax
- `docker-compose` v1 syntax (`version: "3.x"`) — use Compose v2 (no top-level `version:` needed)
- Rootful-only capabilities in containers — run as non-root where possible so rootless podman matches rootful docker

## Explicit non-choices

These are **not** locked in and must be re-decided if ever adopted:

- **No shared runtime-object package.** `packages/shared-schemas` exports only TypeBox schemas, derived types, constants, and pure utilities. It MUST NOT export runtime services, ORM models, business logic, or side-effectful modules.
- **No frontend imports of backend internals.** Frontend may import from `packages/shared-schemas` and nothing else from the backend. ESLint's `no-restricted-imports` enforces this.
- **No Zod as a co-equal schema system.** Mixing Zod and TypeBox creates two sources of truth (see ADR-010 for rationale).
- **No tRPC.** The contract is REST + WebSocket with TypeBox/OpenAPI. tRPC's RPC-style coupling undercuts the hybrid-transport model.
- **No Prisma.** Drizzle is chosen for SQL-first explicit migration semantics (see ADR-011).
- **No CSS-in-JS runtime (styled-components, emotion).** CSS modules are sufficient for MVP; revisit if a design system is adopted.

## Consequences

### Positive

- One language across the stack → one mental model, one linter, one package manager, one type system.
- Fastify + TypeBox + OpenAPI → a single artefact (route schema) is the source of truth for request validation, response shape, TypeScript types on both sides, and published API documentation.
- AI-friendly: TypeScript has the largest public-code training corpus and catches the majority of AI-invented bad type shapes at compile time.
- Strict linting, strict TS config, and schema-derived types force AI-generated code to conform or fail fast.
- Playwright aligns with the "most tests run automatically and against real browsers" goal from the PO.

### Negative

- Node.js single-threaded model requires care for CPU-bound tasks. Acceptable for chat workloads at MVP scale.
- React 19 and Vite 8 are current but young; minor ecosystem churn is expected. Pinning exact versions in `package.json` mitigates this.
- Drizzle, while stable, is less broadly adopted than Prisma; AI may produce Prisma-flavoured code that must be corrected by lint or review. `docs/ai-development-guardrails.md` codifies this.
- `@fastify/websocket` is well-maintained but not as broadly discussed as socket.io; deliberate simplicity here is preferred over transport abstractions.

## Review triggers

Re-open this ADR if any of these occur:

- Node.js 24 LTS reaches end-of-life (expected 2027-04).
- Fastify, React, or Vite release a major version with breaking migration cost.
- A production deployment target is selected that requires stack changes (e.g., a serverless platform that doesn't support persistent WebSocket cleanly).
- The team adds a second backend service whose workload doesn't fit Node (e.g., heavy signal processing).
