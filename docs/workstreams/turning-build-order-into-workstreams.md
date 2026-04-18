# Turning Build Order into Workstreams

## Purpose

Build order answers **what should happen first**.
Workstreams answer **who can build what in parallel, what must stay sequential, where interfaces must be frozen early, and where integration risk sits**.

For this product, build order alone is not enough because the hard parts are not isolated features. They are shared contracts across authentication, sessioning, realtime delivery, message continuity, membership, unread state, and file authorization. A bad workstream split creates drift even if the build order is correct.

## What to think about before carving workstreams

## 1. Shared contracts versus isolated features

Do not split work purely by UI screens or PRD sections.

For this chat system, some capabilities look separate in the PRD but are technically coupled:

- auth, sessions, websocket auth, and session revocation
- messages, chat-local sequence numbers, history APIs, and reconnect recovery
- room membership, room bans, unread state, and attachment authorization
- friendship, user blocks, and direct-message eligibility
- presence, live connections, heartbeats, and multi-tab aggregation

Workstreams should be carved around **stable contracts and ownership**, not around superficial feature labels.

## 2. Sequential foundations versus parallelizable work

Some areas must be built first because many other streams depend on them.

Foundation work for this system:
- runtime skeleton and repo structure
- database migrations and base schema pattern
- auth/session model
- API/error conventions
- websocket envelope and auth handshake
- core entity model and shared type definitions
- sequence/watermark strategy

Once those are frozen, other streams can move in parallel with lower collision risk.

## 3. Contract-first boundaries

Before multiple agents build in parallel, freeze:

- REST endpoint shapes
- websocket event envelopes
- canonical IDs and naming
- message sequence/watermark fields
- read-state contract
- permission-check contract
- error format
- file metadata shape

Without this, agents will each build a slightly different backend/frontend contract and integration time will explode.

## 4. Ownership of shared state

For each workstream, identify which state it owns and which state it only consumes.

Example:
- **Sessions/Auth** owns session lifecycle and revocation state.
- **Realtime** consumes session validity but does not redefine it.
- **Messaging** owns message persistence and sequence numbers.
- **Unread** consumes message sequence state but owns read advancement.
- **Attachments** consume room/DM authorization but do not own membership rules.

If ownership is unclear, the same business rule will be implemented in two places.

## 5. Integration hotspots

These are the places where workstreams will collide and therefore need early coordination:

- login state shared by HTTP and WebSockets
- room/DM authorization used by messages, attachments, presence exposure, and UI visibility
- message creation path used by messaging, unread, realtime fan-out, and history APIs
- room removal / room ban effects used by room admin UI, message visibility, and attachment access
- friend/block changes used by contacts UI, DM creation, and existing DM freeze logic
- chat-open behavior used by history fetch and unread clearing

These hotspots should become explicit integration contracts, not informal assumptions.

## 6. Data migration and schema evolution strategy

Even in a new project, agents will be changing schema in parallel.

Decide early:
- migration tool and naming pattern
- whether each workstream may add migrations directly or through a schema owner
- naming conventions for tables, indexes, enums, and foreign keys
- seed-data strategy for local development

This avoids migration collisions and inconsistent naming.

## 7. Test ownership by workstream

Each workstream should own:
- unit tests for its own domain logic
- integration tests for its external contract
- fixtures for its critical state transitions

Cross-workstream flows need designated owners too.

Example:
- Messaging stream owns message create/edit/delete tests.
- Realtime stream owns websocket delivery tests.
- A separate integration owner should own “send message -> unread changes -> websocket event -> reconnect repair” tests.

## 8. Developer ergonomics and local independence

A good workstream plan lets agents work with minimal waiting.

That means providing:
- stubbed contract docs or generated schemas
- mock event payloads
- example fixtures
- seed users/rooms/chats
- a known local startup path

If one stream cannot run locally until three other streams finish, the split is wrong.

## 9. Definition of done for a workstream

A workstream is not done when its code exists. It is done when:
- its contract is documented
- its migrations are stable
- its tests pass
- it integrates cleanly with dependent streams
- its observability hooks are present
- its key edge cases are covered

## 10. Cross-cutting concerns that must not be orphaned

These tend to get ignored if no single stream owns them:

- authorization
n- audit/logging of destructive actions
- error shape consistency
- reconnect behavior
- stale websocket cleanup
- backpressure handling
- local seed data and test fixtures
- monitoring and diagnostics
- moderation action traceability

Assign owners explicitly.

## Recommended workstream design principles

## Principle 1: Foundations first, features second
Freeze runtime, auth/session, core contracts, and persistence conventions before parallel feature streams begin.

## Principle 2: Group by backend state ownership, not by UI pages
A “rooms page” and a “chat page” cut is weaker than a “room lifecycle” versus “messaging/realtime” cut.

## Principle 3: Keep realtime and durable history tightly coordinated
Do not put websocket delivery in one stream and message ordering/watermarks in another unless the event contract is already fixed.

## Principle 4: Keep authorization logic centralized
Do not let each feature invent its own access checks.

## Principle 5: Use one explicit integration stream or owner
Someone must own end-to-end flow validation across workstreams.

## Questions to answer before finalizing workstreams

1. Which workstream owns the canonical contract docs?
2. Which stream owns database migration review?
3. Which stream owns websocket protocol and reconnect semantics?
4. Which stream owns read/unread semantics?
5. Which stream owns authorization policy helpers?
6. Which stream owns end-to-end integration tests?
7. Which stream owns local developer seed data?
8. Which stream owns observability and health checks?

## Recommended planning artifacts for workstreams

Before parallel execution starts, create these:

- workstream charter for each stream
- dependency map
- interface ownership table
- integration test ownership table
- rollout order / merge order
- open-issues list specific to workstream collisions

## Practical rule for this product

If a capability depends on **sequence numbers, session validity, room membership, or authorization**, assume it is not an independent feature stream until the underlying contract is frozen.
