# Architecture Overview
## Online Chat Server

## 1. Purpose

This document defines the target solution architecture for the Online Chat Server. It translates the product requirements into a concrete runtime model, component layout, data ownership model, synchronization strategy, security model, and recovery behavior so implementation agents do not invent incompatible designs.

This architecture is driven by the following hard constraints:

- classic web-chat behavior
- persistent history
- public and private rooms
- direct messages
- file sharing
- moderation
- multi-tab presence
- active session management
- support for up to 300 simultaneous users
- support for rooms up to 1000 members
- message delivery within 3 seconds
- presence updates within 2 seconds
- local filesystem storage for attachments
- local self-contained runtime via Docker Compose

## 2. Architectural goals

The architecture must optimize for the following qualities, in this order:

1. **Correctness of state transitions**
2. **Durable, queryable message history**
3. **Reliable realtime synchronization**
4. **Simple local operability**
5. **Moderate-scale performance**
6. **Clear extensibility for optional XMPP/Jabber**

The hardest part of this system is not page rendering. It is keeping these state machines consistent under reconnects, multi-tab use, bans, room removal, unread tracking, and attachment authorization:

- sessions
- presence
- friendship
- user-to-user bans
- room membership
- room bans
- invitations
- message continuity
- file access

## 3. Selected architecture summary

The selected architecture is a **self-contained modular monolith** deployed as a small local service set:

- **Web client**: browser-based single-page application
- **Application server**: one backend service exposing REST APIs and WebSocket endpoints
- **PostgreSQL**: system of record for durable entities and message history
- **Redis**: ephemeral state and fast coordination layer for presence, socket fan-out support, and short-lived synchronization state
- **Local filesystem volume**: attachment storage
- **Docker Compose**: local deployment and composition

This architecture is intentionally not microservice-first. At the target scale, splitting into many services adds failure modes and coordination cost without solving a real requirement.

## 4. Architectural principles

1. **Persist first, publish second**
2. **REST is authoritative; WebSocket is acceleration**
3. **Use per-chat sequence numbers for message integrity**
4. **Never maintain unbounded offline delivery queues**
5. **Presence is server-derived from activity plus liveness**
6. **Session revocation must be immediate**
7. **Attachment access must be authorized against current room access**
8. **Client must always be able to repair itself from durable history**
9. **Core functionality must run locally without external hosted dependencies**

## 5. Why this architecture shape was chosen

### 5.1 Why not REST-only

A REST-only design forces clients to poll for new messages and presence changes. That conflicts with the latency targets and the organizer guidance that simple REST update loops are not a good fit for 100+ user message updates.

### 5.2 Why not WebSocket-only

A WebSocket-only design makes every screen and state recovery path dependent on live connection state, which complicates reconnects, history fetch, initial page loads, and deterministic repair after delivery gaps.

### 5.3 Why hybrid REST + WebSocket

The chosen split is:

- **REST** for authoritative reads and mutations
- **WebSocket** for low-latency change propagation

This preserves deterministic recovery and simple initial page loading while delivering responsive chat behavior.

### 5.4 Why PostgreSQL + Redis + filesystem

- **PostgreSQL** is the durable source of truth.
- **Redis** holds only ephemeral, bounded, coordination-oriented state.
- **Filesystem storage** satisfies the explicit local file-storage requirement.

This division prevents transient delivery state from becoming the system of record.

## 6. Runtime topology

### 6.1 Containers

Default deployment topology:

1. **frontend**
   - serves the browser application
   - may proxy API/WebSocket traffic to backend

2. **backend**
   - exposes REST API
   - exposes WebSocket endpoint
   - executes all business logic

3. **postgres**
   - stores users, rooms, memberships, bans, messages, sessions, invitations, attachments metadata, read state

4. **redis**
   - stores ephemeral presence, socket routing metadata, and short-lived coordination structures

5. **shared storage volume**
   - holds attachment binaries

### 6.2 Optional supporting container

A local mail sink or equivalent local-only password-reset viewer should be used for local password-reset development so the reset flow remains self-contained.

## 7. System context

### 7.1 Primary actors

- anonymous visitor
- authenticated user
- room admin
- room owner
- optional XMPP/Jabber admin

### 7.2 Primary interaction modes

- browser loads pages and initial data through HTTP
- browser receives low-latency updates through WebSockets
- backend persists durable changes before publishing realtime events
- clients recover missed state from authoritative HTTP history endpoints

## 8. Component model

## 8.1 Frontend application

### Responsibilities

- authentication flows
- room and contact navigation
- chat rendering
- message composition
- reply/edit/delete UX
- attachment selection and upload
- session-management screens
- moderation dialogs
- unread indicator rendering
- presence indicator rendering
- reconnect and resynchronization logic
- client-side gap detection using per-chat sequence numbers

### Frontend rules

- never assumes websocket stream is complete
- treats HTTP APIs as authoritative for initial state and recovery
- tracks the highest contiguous message sequence seen per chat
- requests missing history when sequence gaps are detected
- clears unread state only through explicit supported server operations

## 8.2 Backend application server

The backend is one deployable service containing internal modules.

### Internal modules

#### Identity and Auth
- registration
- login
- logout
- password hashing
- password change
- password reset token issuance and validation

#### Session Management
- create and revoke sessions
- list active sessions with browser/IP details
- distinguish current session from other sessions
- propagate session revocation to live sockets

#### Presence and Connection Tracking
- track live sockets by user and tab
- accept activity heartbeats
- aggregate presence across multiple tabs
- mark stale sockets offline after timeout
- compute user presence as online / AFK / offline

#### Relationship Service
- friend requests
- friendship acceptance / rejection
- friend removal
- user-to-user bans

#### Room Service
- create rooms
- enforce globally unique room names
- discover public rooms
- manage private invitations
- join/leave rules
- visibility changes
- room ownership/admin rules
- room bans
- member removal

#### Messaging Service
- persist messages
- assign per-chat sequence numbers
- persist replies and edits
- delete messages
- expose paginated history APIs
- publish message-created / edited / deleted events after commit

#### Attachment Service
- validate upload limits
- persist metadata
- store binaries on mounted filesystem
- enforce authorization on every access
- delete files when room deletion requires it

#### Read State and Notifications
- maintain unread state
- maintain last-read position per user per chat
- clear unread state when a chat is opened
- emit unread-indicator changes

#### Realtime Gateway
- authenticate websocket connections
- subscribe sockets to user and chat channels
- publish low-latency events after durable commit
- support reconnect and resync flows
- drop slow/stale sockets when backpressure limits are exceeded

## 8.3 PostgreSQL

PostgreSQL is the **system of record** for:

- users
- password reset tokens
- sessions
- friendships
- friend requests
- user blocks
- rooms
- room memberships
- room invitations
- room bans
- messages
- message edits / metadata
- attachments metadata
- unread / read state
- audit metadata where needed

## 8.4 Redis

Redis is the **ephemeral coordination layer**, not the durable system of record.

It stores only short-lived state such as:

- mapping of user -> live socket IDs
- mapping of chat -> live subscribed sockets
- per-socket transient outbound buffer metadata
- recent activity timestamps
- stale-connection tracking support
- pub/sub or stream fan-out for backend internal event dispatch
- short-lived cache entries where useful

Redis must not hold the only copy of any message or any state required for long-term correctness.

## 8.5 Filesystem storage

Attachment binaries are stored on a mounted local directory structure, for example:

`/data/attachments/{chat_id}/{attachment_id}/{sanitized_original_name}`

Metadata needed for authorization and retrieval lives in PostgreSQL. The filesystem stores binaries and path references only.

## 9. Communication model

## 9.1 REST responsibilities

REST handles:

- sign up
- sign in
- sign out
- password reset / change
- active session listing / revocation
- room list retrieval
- public-room search
- room create/update/delete
- invitation accept/reject
- friend request actions
- chat history retrieval
- attachment upload/download
- moderation commands
- unread clear/update commands where needed
- initial page-state hydration after refresh or reconnect

REST responses are authoritative and replayable.

## 9.2 WebSocket responsibilities

WebSockets handle low-latency fan-out of:

- new messages
- message edits
- message deletions
- presence changes
- room invitation notifications
- membership changes
- room ban changes
- unread state changes
- session revocation notifications
- room-admin changes where needed

No websocket event may be treated as the only source of truth. Every significant state must remain recoverable through REST APIs.

## 10. Message model and continuity strategy

## 10.1 Core decision

Every persisted message within a chat receives a **monotonically increasing chat-local sequence number**.

This sequence number is the authoritative ordering key for synchronization and gap detection.

## 10.2 Why chat-local sequence numbers are required

Relying on timestamps is insufficient because:

- clocks are not authoritative
- websocket events may arrive late
- websocket events may arrive out of order
- reconnects may miss events
- edits and deletes may race with late deliveries

Per-chat sequence numbers create deterministic ordering and gap detection.

## 10.3 Message write flow

When a user sends a message:

1. client sends command to backend
2. backend authenticates user and verifies membership or DM eligibility
3. backend persists the message in PostgreSQL
4. backend allocates the next chat-local sequence number
5. backend commits the transaction
6. backend emits realtime event containing the persisted message and its sequence number
7. subscribed sockets receive the event
8. clients merge the event into local state only if it fits the expected sequence model
9. if a gap is detected, client triggers history reconciliation

The key rule is: **persist first, publish second**.

## 10.4 Message edits and deletes

Edits and deletes do not change the original message sequence number. They emit separate events referencing the original message ID.

Clients must merge these updates idempotently.

## 10.5 Duplicate and out-of-order event handling

Clients must tolerate:

- duplicate events
- out-of-order events
- reconnect replay

Client merge logic must use:

- message ID
- chat ID
- chat sequence number
- event version or updated timestamp where applicable

## 10.6 Gap detection rule

Client tracks, per chat:

- highest contiguous sequence received
- highest sequence fetched from authoritative history
- whether a reconciliation is already in progress

If the client expects `N + 1` and receives `N + 2`, it marks a gap and fetches authoritative history covering the missing range.

## 10.7 Offline user handling

The system does **not** maintain an unbounded per-user transient delivery backlog for absent users.

Instead:

- durable history persists every message
- transient delivery targets only connected clients
- reconnecting users recover missed state from history APIs

## 11. History retrieval model

## 11.1 Pagination strategy

History retrieval is chat-scoped and sequence-aware.

Recommended API shapes:

- fetch latest page for chat
- fetch before sequence `X`
- fetch after sequence `Y`
- fetch range `A..B` for repair

Infinite scroll pages backward through older history.

## 11.2 Authoritative history rule

Whenever there is disagreement between:

- local client cache
- websocket stream
- unread indicator
- reconnect assumptions

the REST history and current read-state APIs are authoritative.

## 12. Presence architecture

## 12.1 Core principles

Presence is derived from three separate facts:

1. **session validity**
2. **connection liveness**
3. **recent user activity**

Presence is not identical to authentication and not identical to socket presence.

## 12.2 Definitions

### Session
Authenticated browser/device record that survives page reloads and browser restarts according to login persistence rules.

### Tab connection
One live browser tab with one websocket connection.

### Recent activity
Timestamp updated when the user interacts with the UI through supported signals such as pointer movement, keyboard input, scrolling, focus changes, or message composition.

### Presence state
Aggregate per-user state across all currently live tab connections.

## 12.3 Server-side presence rules

Binding values (not recommendations). Implementations MUST use these unless an ADR supersedes them.

| Parameter | Value | Notes |
|---|---|---|
| Client → server socket heartbeat interval | 15 seconds | Client sends `presence.heartbeat` every 15s |
| Socket stale timeout | 45 seconds without heartbeat | Server marks socket stale and drops it |
| Tab "recently active" window | 60 seconds since last activity signal | Debounce client activity to at most 1 signal per 5 seconds |
| AFK threshold | >60 seconds with no active tab across all live tabs | Satisfies the source requirement "AFK after more than one minute" |

Derived aggregate rules:

- user is **online** if any non-stale tab is recently active
- user is **AFK** if at least one non-stale tab exists but none are recently active within the AFK threshold
- user is **offline** if no non-stale tab exists

Tuning these values requires an ADR update; hard-coding them in code is a drift source.

## 12.4 Why server-side stale detection is required

Browsers may suspend JavaScript execution in inactive tabs. That means:

- no explicit “inactive” event may fire
- no reliable close event may fire
- sockets may disappear without graceful shutdown

The server must infer offline from missing heartbeats and stale connection expiry.

## 12.5 Activity signal sources

Frontend should treat the following as valid activity:

- mouse / pointer movement
- keyboard events
- scrolling
- focus regained
- composition or input activity
- message send
- attachment interactions

The frontend should debounce activity events so it does not flood the backend.

## 13. Session architecture

## 13.1 Session model choice

Use **server-managed sessions with revocable session records**, not self-contained long-lived JWT-only auth.

This fits the need to:

- list active sessions
- show browser/IP details
- revoke selected sessions
- invalidate only the current browser on logout
- support immediate removal of access where needed

## 13.2 Session transport

Recommended browser auth mechanism:

- secure session cookie
- httpOnly
- sameSite protection appropriate to deployment mode
- CSRF protection for cookie-authenticated state-changing endpoints

## 13.3 Session lifecycle

Session record stores:

- session ID
- user ID
- created at
- last seen at
- browser/user-agent details
- IP address
- revoked flag / revoked at

Revocation must:

- invalidate future API requests
- propagate to live websocket connections for that session
- remove that session from active-session listings

## 14. Friendship, blocking, and DM architecture

## 14.1 Friendship rules

Direct messages are allowed only when:

- both users are friends
- neither side has banned the other

## 14.2 Direct message modeling

Model direct messages as chats with:

- `type = direct`
- exactly two participants
- no owner/admin role

## 14.3 User block effects

A user-to-user ban must:

- terminate new DM ability
- freeze existing DM history into read-only visibility
- functionally terminate friendship

## 15. Room architecture

## 15.1 Room types

Rooms are either:

- public
- private

Public rooms appear in searchable catalog and may be joined freely unless banned. Private rooms are hidden and invite-only.

## 15.2 Room naming

Room names are globally unique across all rooms.

Enforce this with a database unique index against a canonical form built from trim + Unicode NFC normalization + internal whitespace collapse + case-insensitive comparison.

## 15.3 Membership and bans

Important room-state rules:

- owner cannot leave own room
- owner can only delete room
- member removal by admin is equivalent to a ban
- banned users cannot rejoin until explicitly unbanned

## 15.4 Invitations

Private-room invitations target only registered users and follow accept/reject flow.

## 16. Attachment architecture

## 16.1 Storage rules

- binaries stored on local filesystem
- metadata stored in PostgreSQL
- authorization checked on every download request
- loss of room access immediately removes attachment access
- room deletion cascades to attachment deletion

## 16.2 Upload flow

1. client requests upload
2. backend authenticates and verifies chat authorization
3. backend validates size and upload mode
4. backend writes binary to target path
5. backend persists metadata record
6. backend emits attachment-created message/event as needed

Recommended safeguard:

- write file to temp path first
- finalize/move only after metadata transaction succeeds
- if transaction fails, delete temp file

## 16.3 Download authorization

Every download request must verify:

- current user identity
- current room membership or DM authorization
- room not banned for this user
- access not revoked since upload time

Authorization must never rely on uploader identity alone.

## 17. Read state and unread architecture

## 17.1 Model choice

Maintain **per-user, per-chat read state** using at least:

- `last_read_sequence`
- unread flag or derived unread count support
- `last_opened_at` if useful

## 17.2 Why read state is sequence-based

Sequence-based read state aligns with:

- chat-local ordering
- gap recovery
- clear unread-on-open rule
- efficient unread derivation

## 17.3 Clearing rule

When a user opens a chat, the backend advances `last_read_sequence` only after the client has synchronized that chat to the current server head and the server acknowledges the advancement. This clears unread state for that user in that chat.

## 17.4 Multi-tab behavior

Multiple live tabs for the same user may exist.

The authoritative read state is server-side. Tabs must subscribe to read-state changes so unread indicators stay consistent across tabs. If one tab clears unread, every other tab for that user must update to the same cleared state.

## 18. Security architecture

## 18.1 Authentication security

- passwords hashed with a strong adaptive hashing algorithm
- reset tokens short-lived and one-time-use
- session cookies httpOnly
- session revocation enforced server-side

## 18.2 Authorization model

Every state-changing endpoint and every attachment access path must enforce authorization against current server state.

Required checks include:

- user identity
- session validity
- room membership
- room ban status
- friendship / DM eligibility
- ownership/admin privileges where required

## 18.3 Input validation

- normalize usernames and room names according to uniqueness rules
- cap message size at 3 KB text
- enforce attachment sizes: 20 MB files, 3 MB images
- sanitize filenames for storage-path safety

## 19. Data ownership model

## 19.1 Durable source of truth

PostgreSQL owns all durable business state.

## 19.2 Ephemeral coordination state

Redis owns only ephemeral coordination state whose loss is acceptable because it can be rebuilt from:

- new websocket connections
- session checks
- REST rehydration
- PostgreSQL durable records

## 19.3 Client cache

Client cache is an optimization only. It is never authoritative.

## 20. Failure and recovery behavior

## 20.1 Backend restart

Expected effects:

- live sockets disconnect
- Redis ephemeral state may be lost or rebuilt
- clients reconnect
- clients rehydrate current view from REST
- unread and history recover from PostgreSQL

No durable data loss should occur if PostgreSQL and filesystem volumes persist.

## 20.2 Redis restart

Expected effects:

- ephemeral presence state lost
- socket-channel routing reset
- backend rebuilds mappings from active websocket connections
- clients may briefly appear offline or AFK incorrectly until heartbeat refresh

Redis loss must not lose messages, room state, attachment metadata, or session validity.

## 20.3 Network interruption

Expected effects:

- client websocket disconnects
- client enters reconnect loop
- on reconnect, client fetches current chat state and repairs gaps using sequence-aware history calls

## 20.4 Slow consumer and backpressure

Binding values:

| Parameter | Value | Notes |
|---|---|---|
| Per-socket outbound event buffer | 500 events | In-memory queue on the gateway process |
| High-water mark | 400 events | Above this, server stops fan-out to the socket and schedules disconnect |
| Overflow action | Disconnect + signal reconnect-must-resync | Client will receive a close frame and then use `sync.request` on reconnect (see `docs/api-and-events.md` §6.2) |
| Max `sync.request` chat count | 200 chats per command | Over-limit → `VALIDATION_ERROR` |

Rules:

- No per-user offline backlog is retained. A user who is not currently connected receives no events; they recover state via durable history on reconnect.
- Buffer memory is bounded by `buffer_size × concurrent_connected_sockets`. An ADR is required to raise the per-socket limit.
- Disconnect-on-overflow is strictly preferred to latency-inducing throttling. Latency reliability matters more than delivery-to-slow-client optimization.

## 20.5 Long-term inactivity

If a user disappears for a year:

- no transient queue is retained for them
- all durable history remains in PostgreSQL
- on return, history is loaded from durable storage
- unread/read state is recalculated or resumed from `last_read_sequence`

## 21. Database design guidance

## 21.1 Core tables

Recommended core tables:

- `users`
- `sessions`
- `password_reset_tokens`
- `friend_requests`
- `friendships`
- `user_blocks`
- `rooms`
- `room_memberships`
- `room_invitations`
- `room_bans`
- `messages`
- `attachments`
- `chat_read_state`

## 21.2 Important constraints

- unique `users.email`
- unique `users.username`
- unique normalized `rooms.name`
- single owner per room
- unique membership per `(room_id, user_id)`
- unique block relation per ordered user pair
- monotonically increasing per-chat message sequence

## 21.3 Important indexes

- messages by `(chat_id, sequence desc)`
- memberships by `(user_id, room_id)`
- read state by `(user_id, chat_id)`
- sessions by `(user_id, revoked, last_seen_at)`
- invitations by `(room_id, invitee_user_id, status)`
- bans by `(room_id, user_id)`

## 22. API design guidance

## 22.1 REST endpoints to define explicitly

At minimum:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/logout-session`
- `GET /sessions`
- `POST /auth/password-reset/request`
- `POST /auth/password-reset/confirm`

- `GET /rooms/public`
- `POST /rooms`
- `GET /rooms/{roomId}`
- `PATCH /rooms/{roomId}`
- `DELETE /rooms/{roomId}`
- `POST /rooms/{roomId}/join`
- `POST /rooms/{roomId}/leave`
- `POST /rooms/{roomId}/invitations`
- `POST /rooms/{roomId}/invitations/{invitationId}/accept`
- `POST /rooms/{roomId}/invitations/{invitationId}/reject`

- `POST /friends/requests`
- `POST /friends/requests/{requestId}/accept`
- `POST /friends/requests/{requestId}/reject`
- `DELETE /friends/{userId}`
- `POST /blocks/{userId}`
- `DELETE /blocks/{userId}`

- `GET /chats/{chatId}/messages`
- `POST /chats/{chatId}/messages`
- `PATCH /messages/{messageId}`
- `DELETE /messages/{messageId}`
- `POST /chats/{chatId}/read`
- `POST /chats/{chatId}/attachments`
- `GET /attachments/{attachmentId}/download`

## 22.2 WebSocket event families to define explicitly

- `message.created`
- `message.edited`
- `message.deleted`
- `presence.updated`
- `readstate.updated`
- `room.invitation.created`
- `room.membership.updated`
- `room.ban.updated`
- `session.revoked`

Every event payload should include:
- event ID
- event type
- actor user ID where relevant
- chat ID or room ID where relevant
- message ID and sequence where relevant
- server timestamp
- version or monotonic change key where useful

## 23. Observability and diagnostics

## 23.1 Logs

Backend should emit structured logs for:

- auth events
- session creation/revocation
- room create/delete
- invitation decisions
- membership changes
- bans/unbans
- message create/edit/delete
- attachment upload/download authorization failures
- reconnect/gap-repair flows
- websocket connect/disconnect

## 23.2 Metrics

At minimum collect:

- active sessions
- active websocket connections
- online / AFK / offline counts
- message create rate
- websocket event fan-out rate
- reconnect rate
- history repair rate
- attachment upload rate
- authorization failure counts
- slow-consumer disconnect count

## 23.3 Health checks

Expose:

- backend liveness
- backend readiness
- database connectivity
- Redis connectivity
- writable attachment volume check

## 24. Optional XMPP/Jabber extension boundary

The optional XMPP/Jabber capability is outside core scope and should be designed as an adapter boundary, not fused into baseline room/messaging code from day one.

If later implemented, add:

- XMPP gateway module
- federation transport handling
- admin monitoring screens
- federation metrics

Core chat state, message sequencing, room membership, and durable history should remain owned by the baseline backend and database.

## 25. Follow-on documents this architecture should feed

This overview should be followed by:

- `state-model.md`
- `data-model.md`
- `api-and-events.md`
- ADRs for major technical choices
- `registers.md`
