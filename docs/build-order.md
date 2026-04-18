# Build Order
## Online Chat Server

## 1. Purpose

This document defines the recommended implementation sequence for the Online Chat Server.

The order is optimized for:
- reducing architecture rework
- validating the hardest state transitions early
- keeping the application runnable end to end as soon as possible
- giving implementation agents a strict dependency order
- avoiding late discovery of realtime, session, and authorization problems

This is not a staffing plan. It is a technical dependency plan.

## 2. Build strategy

The system should be built in **vertical slices on top of a stable platform foundation**, not as isolated frontend and backend tracks and not as a late-stage “wire realtime on at the end” effort.

Two rules govern the sequence:

1. Build the **durable data and state model first**.
2. Introduce **realtime delivery early enough to validate sequencing, unread, presence, and reconnect behavior before feature volume grows**.

The most expensive mistakes in this product happen when teams:
- build UI flows before state rules are locked
- implement direct messaging and rooms as unrelated systems
- add WebSockets after CRUD flows are already baked
- treat presence as a simple field instead of an aggregate state model
- postpone read-state, sequence, or reconnect logic until the end

## 3. Delivery stages

## Stage 0 — Repo and runtime foundation

### Goal
Create a stable local runtime and repository shape before feature work begins.

### Deliverables
- repository structure finalized
- Docker Compose booting all core services
- backend service boots and connects to database and Redis
- frontend service boots and reaches backend
- persistent volumes mounted for database and attachments
- environment variable strategy established
- health endpoints implemented
- seed/dev bootstrap strategy decided

### Why this is first
The product is explicitly intended to run locally as a self-contained system. A shaky runtime foundation causes noise in every later phase.

### Exit criteria
- `docker compose up` starts the full stack successfully
- frontend can call a backend health endpoint
- backend confirms database and Redis readiness
- attachment storage path is writable

## Stage 1 — Core domain skeleton and persistence model

### Goal
Freeze the core entities, constraints, and migrations before implementing business flows.

### Deliverables
- database schema for users, sessions, friendships, blocks, rooms, memberships, invitations, bans, messages, attachments, read state
- migration strategy established
- normalized uniqueness rules implemented for usernames, emails, and room names
- message table includes chat-local sequence field
- direct chats and room chats share the same chat/message model
- repository/data-access layer established

### Why this is first
Everything in the product sits on these entities. If these shapes drift later, every module breaks.

### Exit criteria
- migrations run from empty database
- unique and foreign-key constraints enforced
- test data can create a room, membership, and message history correctly
- chat-local sequence allocation strategy is implemented and tested

## Stage 2 — Authentication and session management

### Goal
Get user identity, persistence of login, and active-session control working before building social or chat features.

### Deliverables
- registration
- login/logout
- persistent session cookies
- password hashing
- current-user endpoint
- session listing endpoint with browser/IP details
- revoke-selected-session endpoint
- websocket authentication strategy aligned with session model

### Why this comes early
Most other flows depend on a stable authenticated user identity. Session revocation also needs to be compatible with websocket lifecycle and multi-tab behavior.

### Exit criteria
- user can register and log in
- login persists across browser restart
- current session can be identified
- user can list and revoke another active session
- revoked session loses API access and live websocket access

## Stage 3 — Shared chat model and room foundation

### Goal
Implement the base chat abstraction and room lifecycle before direct messages.

### Deliverables
- room entity flows
- room creation
- public-room catalog and search
- public-room join/leave
- private-room visibility rules
- owner/admin/member model
- room details API
- room membership list API

### Why rooms before DMs
Rooms exercise more of the shared model: chat history, membership, moderation, visibility, and authorization. Once room-backed chat is solid, DMs become a constrained specialization.

### Exit criteria
- authenticated user can create a room
- public room appears in catalog
- users can join/leave according to rules
- owner restrictions are enforced
- room names are globally unique

## Stage 4 — Message persistence before live fan-out

### Goal
Implement durable messaging and history retrieval before realtime delivery.

### Deliverables
- post message endpoint/command
- fetch latest chat history
- fetch paginated older history
- message replies
- message edits
- message deletes
- attachment metadata reference in messages
- read-state persistence model initialized

### Why before WebSockets
Persisted message correctness must exist before live delivery is introduced. Realtime without durable message correctness creates hard-to-debug inconsistency.

### Exit criteria
- messages persist and appear in order
- replies, edits, and deletes work against durable history
- history pagination works by chat-local sequence or equivalent deterministic order
- authorization is enforced correctly for room access

## Stage 5 — Realtime transport and message fan-out

### Goal
Introduce WebSockets early enough to validate event propagation without waiting for every feature.

### Deliverables
- websocket connect/auth
- socket subscription model
- message-created event fan-out
- message-edited event fan-out
- message-deleted event fan-out
- per-socket bounded outbound buffer strategy
- reconnect flow foundation

### Why here
This is the earliest point where realtime can be layered on a correct durable model. Waiting longer increases rework.

### Exit criteria
- two users in same room receive low-latency message updates
- duplicate events do not render duplicate messages
- slow or disconnected sockets recover using durable history
- message publish occurs only after durable commit

## Stage 6 — Sequence, watermark, and reconciliation logic

### Goal
Make the live system self-healing under disconnects, gaps, duplicates, and out-of-order delivery.

### Deliverables
- client tracks highest contiguous sequence per chat
- gap detection logic
- fetch-missing-history repair flow
- reconnect handshake includes latest known sequence/read state
- idempotent message merge logic

### Why this must be early
The architecture depends on durable history being authoritative and realtime being accelerative. That only becomes true when reconciliation exists.

### Exit criteria
- forced dropped event produces detectable gap
- client repairs from history without manual refresh
- duplicate or out-of-order events do not corrupt chat UI
- reconnect after absence restores consistent message history

## Stage 7 — Read state, unread indicators, and multi-tab consistency

### Goal
Implement unread behavior once message persistence and reconciliation are stable.

### Deliverables
- per-user per-chat read-state persistence
- clear unread on open behavior
- unread indicator propagation
- cross-tab read-state synchronization
- reconnect/read-state reconciliation

### Why after sequence/reconciliation
Unread is only trustworthy if message continuity is trustworthy.

### Exit criteria
- unread appears when message arrives in unopened chat
- opening chat clears unread for that user
- second tab updates to match server read state
- reconnect does not resurrect already-cleared unread state incorrectly

## Stage 8 — Presence, connection liveness, and active tab aggregation

### Goal
Implement online/AFK/offline correctly across multiple tabs and hibernation-prone browsers.

### Deliverables
- websocket heartbeat / liveness tracking
- client activity heartbeats
- per-tab live connection tracking
- aggregate user presence logic
- online/AFK/offline transitions
- presence update events

### Why not earlier
Presence is important, but it depends on authenticated sessions, live sockets, and multi-tab server tracking. It should not block core messaging.

### Exit criteria
- one active tab keeps user online
- all live tabs idle > 1 minute causes AFK
- all live connections stale/disconnected causes offline
- hibernated tab does not keep user online forever

## Stage 9 — Friendship, friend requests, and user blocking

### Goal
Implement the relationship model that gates direct messaging.

### Deliverables
- send/accept/reject friend request
- friend list
- remove friend
- block/unblock user
- enforce DM eligibility from friendship + block state
- freeze existing DM on block

### Why after core rooms/messaging
These flows are important but do not need to block the room system. They should be built after the shared chat stack is proven.

### Exit criteria
- users can become friends only through explicit acceptance
- blocked users cannot initiate or continue new DMs
- existing DM remains visible but read-only after block

## Stage 10 — Direct messaging

### Goal
Add direct chats as a constrained specialization of the shared chat model.

### Deliverables
- create/open direct chat subject to friendship rules
- two-participant chat rendering
- DM history retrieval
- DM message send/edit/delete/reply
- DM unread behavior

### Why here
By this point, the shared chat model, sequence logic, and relationship constraints are already proven.

### Exit criteria
- eligible friends can create and use DMs
- ineligible users cannot create DMs
- DM behavior matches room chat behavior except for moderation differences

## Stage 11 — Private-room invitations and moderation features

### Goal
Layer invitation and moderation behavior on the proven room model.

### Deliverables
- private-room invite flow
- accept/reject invite flow
- ban/unban user
- remove member as ban
- manage admins
- banned-users list with “banned by” visibility
- room deletion cascade

### Why here
These are high-privilege, state-heavy flows. They should be built after base room and chat correctness is stable.

### Exit criteria
- registered users can be invited to private rooms
- invite acceptance adds membership
- member removal blocks rejoin until unban
- admin actions are permission-gated correctly
- room deletion removes room history and attachments

## Stage 12 — Attachments

### Goal
Add binary handling and access-controlled downloads.

### Deliverables
- upload endpoint
- local filesystem persistence
- attachment metadata persistence
- attachment rendering in chat
- comment support
- secure download endpoint
- post-removal access denial

### Why after core messaging
Attachments complicate storage and authorization but should reuse proven chat authorization rules.

### Exit criteria
- authorized participant can upload and download within limits
- unauthorized former member cannot access file after losing room access
- room deletion removes underlying files

## Stage 13 — Sessions UI, moderation UI, and full UX hardening

### Goal
Expose all backend capabilities cleanly in the UI and resolve screen-level behavior.

### Deliverables
- sessions screen
- manage-room dialogs
- banned-users UI
- invitation UI
- friend-request UI
- deleted/edited message rendering
- frozen-DM rendering
- attachment failure states

### Exit criteria
- all major flows can be executed through the UI
- UI behavior matches UX flow notes and acceptance criteria

## Stage 14 — Resilience, observability, and hardening

### Goal
Turn a feature-complete system into a robust one.

### Deliverables
- structured logging
- metrics
- health checks
- retry/backoff behavior
- slow-consumer handling
- reconnect stress tests
- stale-session / stale-socket cleanup jobs if needed
- data cleanup for expired reset tokens and obsolete ephemeral state

### Exit criteria
- restart/reconnect behavior is predictable
- transient failures self-heal via reconnect and resync
- logs and metrics support debugging

## Stage 15 — Optional XMPP/Jabber extension

### Goal
Only after core product stability, add the optional protocol extension.

### Deliverables
- protocol adapter
- admin monitoring views
- federation rules if pursued
- extension-level test coverage

### Exit criteria
- optional extension does not degrade baseline chat correctness

## 4. Recommended implementation order by subsystem

If multiple agents or people work in parallel, use these dependency lanes.

### Lane A — Platform and persistence
1. Docker/runtime foundation
2. migrations and schema
3. auth/session base
4. core repositories/data access

### Lane B — Shared chat engine
1. room model
2. message persistence
3. history APIs
4. websocket transport
5. sequence/gap repair
6. read state/unread

### Lane C — State-heavy business rules
1. presence aggregation
2. friendship and blocks
3. direct messages
4. invitations/moderation
5. attachments authorization edge cases

### Lane D — UX integration
1. auth screens
2. room list and chat shell
3. live chat rendering
4. unread/presence updates
5. moderation screens
6. session management screens

## 5. What must be validated earliest

These are the highest-risk areas and should be tested long before the app is feature-complete:

### 5.1 Message continuity
- missing event detection
- duplicate event handling
- reconnect repair
- late event merge

### 5.2 Presence correctness
- multiple tabs
- active + idle tabs
- tab hibernation
- abrupt disconnect

### 5.3 Authorization transitions
- room removal while viewing room
- room ban while connected
- block applied to active DM
- attachment access after membership loss

### 5.4 Session control
- current-session logout
- revoke-other-session
- revoked websocket disconnect

## 6. What should not be postponed

Do **not** postpone these until the end:
- chat-local sequence numbers / watermarks
- reconnect and gap repair
- server-side read state
- session revocation compatibility with websockets
- stale-socket presence handling
- authorization on attachment download

These are architectural features, not polish.

## 7. What can be deferred safely

These can be moved later without distorting the architecture:
- polish of room-management UI
- attachment preview richness
- better public-room search UX
- admin convenience features beyond required actions
- optional XMPP/Jabber extension

## 8. Finalized requirement decisions already frozen

The following requirement decisions are now frozen and should be implemented as written:

### Identity and naming
- usernames and room names use canonical normalization: trim, Unicode NFC, internal whitespace collapse, case-insensitive comparison
- uniqueness must be enforced against that canonical form in both UI validation and database constraints

### Sessions and request protection
- use server-managed revocable session cookies
- use CSRF protection plus origin checking on state-changing HTTP requests
- authenticate WebSocket handshakes against the same session model

### Room visibility
- owners may switch rooms between public and private after creation
- existing members remain members
- public-to-private removes the room from the public catalog immediately
- private-to-public makes the room joinable through the public catalog immediately

### Unread semantics
- unread clears only after successful chat synchronization and server acknowledgement of read-state advancement
- server-side read state is authoritative across tabs
- when one tab clears unread, other tabs must update to match

### Direct-message lifecycle
- a direct chat is created only on the first successful direct message
- removing a friend disables new direct messaging immediately
- an existing direct chat remains visible but becomes read-only until friendship is re-established and no block exists

### Attachments
- no file-type restriction beyond explicit size limits
- original filename is preserved in metadata and UI
- original filename is never trusted as a storage path
- download/header filenames must be sanitized for unsafe characters

## 9. Recommended overall rule

At any point in development, the system should remain in a runnable state with:
- a bootable Docker environment
- working migrations
- a browser shell
- at least one end-to-end happy path exercised through the stack

Do not build this as a long series of disconnected backend features followed by a late frontend integration phase.

## 10. Build order summary

If a single team is working sequentially, use this order:

1. Runtime foundation
2. Core schema and migrations
3. Authentication and sessions
4. Room model and public-room flows
5. Durable message persistence and history
6. WebSocket transport
7. Sequence numbers, gap repair, reconnect
8. Read state and unread indicators
9. Presence and multi-tab aggregation
10. Friendship and blocks
11. Direct messaging
12. Private invitations and moderation
13. Attachments
14. UI hardening and admin screens
15. Observability and resilience hardening
16. Optional XMPP/Jabber extension

This is the recommended dependency-safe order for implementation.
