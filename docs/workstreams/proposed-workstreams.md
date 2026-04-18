# Proposed Workstreams

## Purpose

This document turns the build order into concrete implementation workstreams for the Online Chat Server. It assumes one shared repository and a self-contained local runtime.

The goal is not to maximize theoretical parallelism. The goal is to maximize parallel progress **without allowing shared contracts to drift**.

**Authority note**: if this document disagrees with `docs/build-order.md`, this doc is authoritative for **who does what** (team assignment / ownership) and the build-order doc is authoritative for **what must come before what** (sequence / dependency).

## Workstream model

Use eight workstreams:

1. Platform and Runtime Foundations
2. Identity, Sessions, and Security
3. Core Chat Domain: Rooms, Membership, and Relationships
4. Messaging and Durable History
5. Realtime Gateway, Presence, and Synchronization
6. Attachments and File Access
7. Frontend Experience and Moderation UI
8. Integration, Seed Data, Observability, and Hardening

This split gives each stream a coherent ownership boundary while preserving a single integration path.

---

## WS-01 Platform and Runtime Foundations

### Mission
Create the runnable technical skeleton that all other workstreams will build on.

### Owns
- repository structure
- Docker Compose runtime
- environment configuration pattern
- backend application skeleton
- frontend application skeleton
- database connection and migration framework
- Redis connection and local wiring
- shared error envelope and API response conventions
- shared type/schema package if one is used
- health-check endpoints

### Deliverables
- working local startup with frontend, backend, database, Redis, and storage volume
- migration tooling and first baseline migration
- basic CI checks or local validation scripts
- shared configuration loading
- canonical error format
- request logging base

### Dependencies
None. This stream starts first.

### Blocks / unblocks
Blocks all streams if not completed to a usable skeleton level.

### Done when
- all services boot locally
- migrations can run from clean state
- backend and frontend can communicate
- storage volume mounts work
- health endpoints are available

---

## WS-02 Identity, Sessions, and Security

### Mission
Establish authentication, session lifecycle, and authorization foundations used by both HTTP and WebSocket flows.

### Owns
- registration
- login/logout
- session cookie strategy
- session storage and revocation
- active session listing with browser/IP metadata
- password hashing
- password reset token flow
- CSRF protections for cookie-authenticated requests
- auth middleware
- websocket authentication handshake
- shared authorization helpers / policy checks

### Deliverables
- register/login/logout endpoints
- session issuance and revocation
- current-session and session-list APIs
- session revocation propagation hook for websocket layer
- password reset request/confirm flow for local runtime
- centralized authorization policy helper package

### Consumes
- runtime skeleton from WS-01

### Provides to others
- authenticated user identity in backend requests
- websocket session validation
- reusable role and permission check helpers

### Key integration points
- WS-05 Realtime must consume websocket auth and session revocation
- WS-07 Frontend must use session APIs and CSRF conventions
- WS-08 Integration must test session revocation across tabs/sockets

### Done when
- login persists across browser reopen
- logout revokes only current session
- session list shows active sessions with details
- revoke-other-session works
- websocket connections reject revoked sessions

---

## WS-03 Core Chat Domain: Rooms, Membership, and Relationships

### Mission
Implement the durable domain rules for rooms, invitations, friendships, direct-message eligibility, user blocks, room bans, and membership transitions.

### Owns
- rooms
- room visibility
- public room catalog and search
- private-room invitation flow
- room membership states
- admin/owner role transitions
- room bans and member removal-as-ban behavior
- friendships and friend requests
- user blocks
- direct-message eligibility rules
- canonical permission matrix implementation for room/relationship decisions

### Deliverables
- room create/update/delete APIs
- join/leave APIs
- invitation create/accept/reject APIs
- room member/admin/ban management APIs
- friend request / accept / reject / remove APIs
- block / unblock APIs
- authorization checks for room membership and DM eligibility

### Consumes
- auth/session from WS-02
- migrations/runtime from WS-01

### Provides to others
- room/DM authorization rules for WS-04 Messaging
- permission checks for WS-06 Attachments
- room/member/admin data for WS-07 Frontend
- domain transition fixtures for WS-08 Integration

### Key integration points
- WS-04 cannot safely create messages without chat eligibility checks
- WS-06 must reuse current-membership authorization
- WS-05 emits invitation / membership / ban events from this domain

### Done when
- room lifecycle works with correct role restrictions
- friendship and block states enforce DM rules
- removing a room member behaves as a ban
- public/private room behaviors match requirements

---

## WS-04 Messaging and Durable History

### Mission
Own message persistence, ordering, history retrieval, edits/deletes, replies, read-state data model, and sequence/watermark integrity.

### Owns
- chat creation rules for direct chats on first successful message
- message persistence
- per-chat sequence number allocation
- reply references
- message edit/delete persistence behavior
- history pagination APIs
- read-state persistence model
- unread state server model
- gap-repair history query support

### Deliverables
- send message API/command path
- fetch latest / before / after / range history APIs
- edit and delete message APIs
- per-chat sequence/watermark support
- read-state advance API
- read-state query helpers
- DB schema and indexes for history performance

### Consumes
- room/DM authorization from WS-03
- auth/session from WS-02
- runtime/db from WS-01

### Provides to others
- realtime event source for WS-05
- unread state basis for WS-05 and WS-07
- history source of truth for reconnect repair

### Key integration points
- WS-05 depends on publish-after-commit event hooks
- WS-07 depends on history API shape and read advancement behavior
- WS-08 must own end-to-end message continuity tests across reconnects

### Done when
- messages persist in correct order
- history fetch supports infinite scroll and gap repair
- edits/deletes work with stable identity
- read state advances deterministically
- sequence gaps can be repaired through history APIs

---

## WS-05 Realtime Gateway, Presence, and Synchronization

### Mission
Deliver the websocket/event layer, presence aggregation, live updates, reconnect logic, and synchronization semantics that sit on top of durable state.

### Owns
- websocket server / gateway
- websocket auth handshake consumption
- subscription model for users/chats/rooms
- event envelope format
- publish-after-commit fan-out
- presence activity heartbeat handling
- stale socket detection
- online/AFK/offline aggregation across tabs
- readstate / invitation / membership / moderation event fan-out
- reconnect semantics and resubscription support
- slow-consumer/backpressure handling

### Deliverables
- websocket connect/auth flow
- heartbeat and activity handlers
- presence update broadcasting
- message / edit / delete event broadcasting
- invitation / membership / room-ban / session-revoked events
- bounded buffer policy and disconnect-on-overflow
- reconnect guidance implementation hooks

### Consumes
- auth/session validation from WS-02
- message event source and read state from WS-04
- room/membership changes from WS-03
- runtime/Redis from WS-01

### Provides to others
- low-latency updates for WS-07 frontend
- live event behavior for WS-08 integration tests

### Key integration points
- strongest coupling is with WS-04 because sequence numbers and history repair define sync correctness
- strong coupling with WS-02 because revoked sessions must drop live sockets

### Done when
- websocket clients receive live events after commit
- presence aggregation across multiple tabs matches rules
- stale tabs/sockets resolve to correct offline/AFK behavior
- reconnect after disconnect can recover via history APIs

---

## WS-06 Attachments and File Access

### Mission
Implement upload/download flows, filesystem storage, metadata persistence, and current-membership-based access control.

### Owns
- attachment upload API
- storage path generation
- metadata persistence
- attachment comment support
- download authorization
- file cleanup on room deletion
- filename sanitization strategy
- size-limit enforcement

### Deliverables
- attachment upload endpoint
- download endpoint
- filesystem write/read handling
- metadata records linked to messages/chats
- authorization on each download
- cleanup behavior for room deletion

### Consumes
- auth/session from WS-02
- room/DM authorization from WS-03
- message linkage from WS-04
- runtime/storage from WS-01

### Provides to others
- attachment metadata and URLs for WS-07 frontend
- attachment authorization behavior for WS-08 integration tests

### Key integration points
- if WS-03 membership logic is duplicated here, access control will drift
- if WS-04 message creation and attachment linkage are not coordinated, attachment messages will become inconsistent

### Done when
- upload and download work locally
- original filename preserved in UI metadata
- sanitized storage path is used server-side
- former members cannot download retained room files

---

## WS-07 Frontend Experience and Moderation UI

### Mission
Build the user-facing application on top of the stable backend contracts.

### Owns
- auth screens
- room catalog / room list / contact list
- chat window and composer
- reply/edit/delete UI
- unread indicators
- presence rendering
- session management screen
- friend request / block UX
- invite flows
- moderation dialogs
- attachment upload/download UX
- optimistic UI policy, if any, within backend contract limits

### Deliverables
- SPA routes/pages/components
- websocket client integration
- sequence-aware client merge logic
- gap detection and history repair triggers
- cross-tab read-state update consumption
- moderation and settings UI

### Consumes
- APIs from WS-02, WS-03, WS-04, WS-06
- websocket events from WS-05
- UX flow notes and permissions matrix from BA docs

### Provides to others
- user-visible validation of end-to-end experience
- client behavior for WS-08 integration hardening

### Key integration points
- must not invent its own business rules for unread, bans, or DM eligibility
- must implement sequence-aware reconciliation, not blind append-only websocket rendering

### Done when
- all primary flows are usable from the browser
- multi-tab and reconnect behavior works in the UI
- moderation surfaces reflect backend permissions
- unread/presence update correctly without polling

---

## WS-08 Integration, Seed Data, Observability, and Hardening

### Mission
Own the seams: end-to-end tests, seed data, diagnostics, local operability, and hardening of the whole system.

### Owns
- seed data and developer fixtures
- end-to-end integration test coverage
- cross-workstream regression suite
- structured logs and metrics wiring
- health checks and readiness checks
- performance sanity validation for moderate local load
- chaos/recovery scenarios such as reconnects, stale sockets, and revoked sessions
- final local developer workflow and bootstrap docs

### Deliverables
- seed command or seeded compose environment
- E2E tests for critical flows
- diagnostic logging baseline
- metrics surface or at least internal counters/log instrumentation
- scenario tests for reconnect/gap repair and membership loss

### Consumes
- all other workstreams

### Provides to others
- release confidence
- regression safety
- local test repeatability

### Done when
- core end-to-end flows pass reliably
- seed data allows rapid local validation
- logs/health checks exist
- major edge cases are covered by automated or scripted validation

---

## Merge and start order

### Phase A: must start first
- WS-01 Platform and Runtime Foundations
- WS-02 Identity, Sessions, and Security

### Phase B: starts once A contracts exist
- WS-03 Core Chat Domain
- WS-04 Messaging and Durable History

### Phase C: starts once WS-02/03/04 contracts are stable
- WS-05 Realtime, Presence, and Synchronization
- WS-06 Attachments and File Access
- WS-07 Frontend Experience and Moderation UI

### Phase D: starts early but becomes most active once features exist
- WS-08 Integration, Seed Data, Observability, and Hardening

---

## Workstream dependency summary

- WS-01 unblocks everything
- WS-02 is required before websocket auth and secure frontend flows
- WS-03 and WS-04 together define most domain correctness
- WS-05 depends heavily on WS-02 and WS-04
- WS-06 depends heavily on WS-03 and WS-04
- WS-07 depends on stable contracts from WS-02 through WS-06
- WS-08 spans everything and should start with scaffolding early

## Streams that must coordinate continuously

### Tightest coordination pair
- WS-04 Messaging and Durable History
- WS-05 Realtime, Presence, and Synchronization

Reason: sequence numbers, delivery semantics, gap repair, and reconnect correctness are one system even if implemented in separate code areas.

### Second tightest coordination pair
- WS-03 Core Chat Domain
- WS-06 Attachments and File Access

Reason: attachment authorization depends on current membership and ban state.

### Third tightest coordination pair
- WS-02 Identity, Sessions, and Security
- WS-05 Realtime, Presence, and Synchronization

Reason: websocket lifecycle and session revocation must align.

## Workstream anti-patterns to avoid

Do not split into:
- one stream per UI page
- one stream for “backend” and one for “frontend” only
- one stream for “websocket stuff” with no control over message history contracts
- one stream for “permissions” hidden inside each feature team

Those splits will create duplicated rules and brittle integration.
