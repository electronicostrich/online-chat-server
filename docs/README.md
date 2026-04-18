# Online Chat Server Documentation Pack

## Contents

The pack is split into **product/design docs** (what to build) and **engineering docs** (how to build it). Read in this order the first time.

### Product and design (read first)

1. `product-requirements.md`
2. `requirements-decisions.md`
3. `architecture-overview.md`
4. `state-model.md`
5. `data-model.md`
6. `api-and-events.md`
7. `permissions-matrix.md`
8. `acceptance-criteria-pack.md`
9. `edge-cases-and-business-rules.md`
10. `ux-flow-notes.md`
11. `glossary.md`
12. `registers.md`
13. `traceability.md`

### Engineering (read before implementing)

14. `adr/` — architecture decision records (ADR-001 through ADR-011)
15. `repo-layout.md`
16. `runtime-and-environment.md`
17. `error-envelope-and-conventions.md`
18. `testing-strategy.md`
19. `ai-development-guardrails.md`
20. `ci-pipeline.md`
21. `git-workflow.md` — branching, commits, release gates
22. `hooks.md` — three-layer enforcement (Claude Code / pre-commit / CI)
23. `script-specs.md` — concrete specs for every CI/enforcement script
24. `stage-0-bootstrap.md` — exact artifacts for the first PR

### Workstream planning

25. `workstreams/proposed-workstreams.md`
26. `workstreams/turning-build-order-into-workstreams.md`
27. `workstreams/workstream-dependency-and-interface-map.md`

## Purpose

This pack turns the PRD into an implementation-ready technical and BA baseline for a production-adjacent chat system that runs locally via Docker Compose. It is designed to be sufficient for AI-driven implementation (Claude Code) with minimal human handholding and strong drift detection.

## Document map

### Product and design

- **product-requirements.md** — Source-backed product scope, functional requirements, non-functional requirements, realtime constraints, and chosen default product decisions.
- **requirements-decisions.md** — Finalized requirement-level decisions that were previously open or fuzzy, including normalization, session transport, unread semantics, DM lifecycle, and attachment policy.
- **architecture-overview.md** — System shape, runtime topology, component responsibilities, synchronization model, security model, recovery behavior, and binding operational thresholds (timeouts, buffer sizes).
- **state-model.md** — Explicit state machines and transitions for sessions, presence, friendship, blocks, rooms, invitations, bans, messages, attachments, and unread state.
- **data-model.md** — Persistent entities, fields, constraints, indexes, retention and deletion policy, and foreign-key cascade behaviors.
- **api-and-events.md** — REST contract, WebSocket contract, payload shapes, error code/HTTP status mapping, pagination rules, ordering/idempotency, and reconnect/gap-repair protocol.
- **permissions-matrix.md** — Role/action matrix covering account, sessions, rooms, DMs, moderation, attachments, unread state, and information visibility.
- **acceptance-criteria-pack.md** — Capability-level acceptance criteria for every product capability. Every AC has a matching Playwright test.
- **edge-cases-and-business-rules.md** — Expected outcomes for high-risk transition scenarios and frozen business rules for QA and development.
- **ux-flow-notes.md** — Behavioral notes for ambiguous screens and interaction flows.
- **glossary.md** — Canonical vocabulary and term definitions.
- **registers.md** — Risk register, assumption register, decision register, and open issues register.
- **traceability.md** — The anti-drift keystone. Maps every AC ID to API endpoints, WebSocket events, state transitions, data-model entities, permissions rows, and Playwright test filenames.

### Engineering

- **adr/** — Architecture Decision Records for major technical choices. ADR-001 through ADR-008 cover the design baseline. ADR-009 locks the implementation stack. ADR-010 locks TypeBox as the schema source of truth. ADR-011 locks Drizzle as the ORM/migration tool.
- **repo-layout.md** — Directory structure, import rules, module discipline, naming conventions. Every file in the repo has a designated home.
- **runtime-and-environment.md** — Docker Compose services, ports, volumes, full environment variable reference, bootstrap steps.
- **error-envelope-and-conventions.md** — Canonical HTTP response / error / pagination envelopes and WebSocket event/command envelope shapes.
- **testing-strategy.md** — Three-tier test pyramid (Vitest unit + integration, Playwright E2E), AC-to-test mapping rules, conventions. Includes the `POST /__test/seed` contract.
- **ai-development-guardrails.md** — The rulebook every AI coding session must obey, paired with the enforcement mechanism for each rule.
- **ci-pipeline.md** — GitHub Actions workflows, required status checks, branch protection, doc consistency and schema drift checks.
- **git-workflow.md** — Branching model (Git-Flow-light: `main` ← `develop` ← `feature/*`), commit hygiene, PR contract, release gates, rollback policy.
- **hooks.md** — Three-layer enforcement: Claude Code hooks in `.claude/settings.json`, pre-commit hooks in `lefthook.yml`, CI in `.github/workflows/`. The who-catches-what matrix.
- **script-specs.md** — Concrete input/output/exit-code contracts for every CI and enforcement script (`doc-coverage.ts`, `schema-drift-check.ts`, `lint-compose.ts`, `check-pr-description.ts`, etc.).
- **stage-0-bootstrap.md** — Exact artifacts the first PR creates: `package.json`, `tsconfig.base.json`, `eslint.config.js`, `compose.yaml`, first migration, the AC-BOOT-00 Playwright test.

### Workstream planning

- **workstreams/proposed-workstreams.md** — Eight workstreams for implementation with dependencies and ownership.
- **workstreams/turning-build-order-into-workstreams.md** — Conversion of the stage-based build order into parallel workstreams.
- **workstreams/workstream-dependency-and-interface-map.md** — Dependency graph across workstreams.

## Source alignment

This pack is aligned to:
- the formal requirements document
- the kickoff transcript and organizer clarifications
- the finalized PRD decisions already made for this project

Where a behavior was not fully specified by source material, the documents mark it as a **chosen default**, **recommended default**, or **owner-controlled default** rather than treating it as a source requirement.

## For Claude Code sessions

Before writing any code, read `CLAUDE.md` at the repo root for the entry-point rules, then the ADRs in the engineering section above, then `ai-development-guardrails.md`. The `traceability.md` table is the fastest way to locate everything relevant to a specific AC.
