# Data Model
## Online Chat Server

## 1. Purpose

This document defines the persistent data model, key constraints, indexes, and lifecycle notes needed to implement the product and architecture.

The model is deliberately relational because the system requires strong consistency around:
- unique identities
- room ownership/admin rules
- bans
- membership
- message ordering
- attachment authorization
- session revocation
- long-lived history

## 2. Modeling principles

1. PostgreSQL is the source of truth for durable business state.
2. Redis is not used as the system of record.
3. Every entity that affects authorization or durable history is persisted.
4. Realtime delivery metadata must be reconstructable from durable state.
5. Message ordering is authoritative by chat-local sequence number.

### 2.1 Implementation notes

- User §4.1 adds two canonical-form columns alongside the human-facing values:
  `email_canonical` and `username_canonical`. Both carry the unique index so
  case-insensitive collisions are enforced at the DB layer, not only in
  application code. Normalization lives in `apps/api/src/modules/auth/normalize.ts`;
  the two fields use deliberately different rules:
  - `normalizeEmail(raw)` — NFC + trim + lowercase. No internal-whitespace
    collapse because RFC 5321 local parts cannot contain whitespace to begin
    with, so collapsing there would hide a validation failure.
  - `normalizeUsername(raw)` — NFC + trim + internal-whitespace collapse
    (runs of whitespace → a single space) + lowercase.
  WS-02 migration `apps/api/drizzle/0002_auth.sql` is the first to create
  these tables.

## 3. Entity overview

Core durable entities:

- User
- Session
- PasswordResetToken
- FriendRequest
- Friendship
- UserBlock
- Chat
- Room
- DirectChatParticipant
- RoomMembership
- RoomInvitation
- RoomBan
- Message
- MessageEditAudit (optional but recommended)
- Attachment
- ChatReadState

## 4. Logical entity details

## 4.1 User

Represents a registered account.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| email | text | yes | human-facing value; also carries a unique index as a belt-and-braces guard |
| email_canonical | text | yes | normalized form (NFC + trim + lowercase); unique index — the canonical-form collision check |
| username | text | yes | human-facing value, immutable; uniqueness is enforced via `username_canonical` |
| username_canonical | text | yes | normalized form (NFC + trim + whitespace collapse + lowercase); unique-index target |
| password_hash | text | yes | adaptive hash |
| display_name | text | no | optional UI label if ever needed |
| status | enum(`active`,`deleted`) | yes | effective account status |
| deleted_at | timestamptz | no | null unless deleted |
| created_at | timestamptz | yes | |
| updated_at | timestamptz | yes | |

### Constraints

- unique normalized `email`
- unique normalized `username` where normalization = trim + Unicode NFC + internal whitespace collapse + case-insensitive comparison

Implementation (see §2.1): normalization is performed entirely in the
application layer (`apps/api/src/modules/auth/normalize.ts` applies
NFC + trim + whitespace-collapse + lowercase). The DB enforces byte-level
uniqueness on the canonical columns via plain unique indexes — it does
not fold case or normalize inside the index. The `email` column also
carries a unique index so raw duplicates are rejected even if the
canonical form were ever computed wrong; `username` relies only on
`username_canonical` because usernames are case-preserving for display
but match case-insensitively.

### Lifecycle notes

- account deletion does not necessarily remove historical messages in non-owned rooms
- deleted users should remain referentially resolvable for surviving history

## 4.2 Session

Represents one authenticated browser/device session.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| user_id | UUID FK -> users.id | yes | |
| session_token_hash | text | yes | if using opaque server sessions |
| user_agent | text | no | browser/device details |
| ip_address | inet or text | no | shown in active sessions UI |
| created_at | timestamptz | yes | |
| last_seen_at | timestamptz | yes | |
| revoked_at | timestamptz | no | null if active |
| expires_at | timestamptz | no | optional server policy |
| current_label | text | no | optional derived display field |

### Constraints

- session token hashes unique
- one row per browser/device session instance

### Indexes

- `(user_id, revoked_at, last_seen_at desc)`

## 4.3 PasswordResetToken

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| user_id | UUID FK -> users.id | yes | |
| token_hash | text | yes | store hash, not raw token |
| issued_at | timestamptz | yes | |
| expires_at | timestamptz | yes | |
| consumed_at | timestamptz | no | null until used |
| revoked_at | timestamptz | no | |

### Indexes

- `(user_id, expires_at desc)`
- unique `token_hash`

## 4.4 FriendRequest

Represents a pending friend request.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| requester_user_id | UUID FK -> users.id | yes | |
| recipient_user_id | UUID FK -> users.id | yes | |
| message | text | no | optional note |
| status | enum(`open`,`accepted`,`rejected`,`cancelled`,`expired`) | yes | |
| created_at | timestamptz | yes | |
| responded_at | timestamptz | no | |

### Constraints

- requester != recipient
- at most one open request per ordered pair or unordered pair, depending on implementation strategy

### Indexes

- `(recipient_user_id, status, created_at desc)`
- `(requester_user_id, status, created_at desc)`

## 4.5 Friendship

Represents a symmetric friendship relationship.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| user_low_id | UUID FK -> users.id | yes | ordered pair lower UUID |
| user_high_id | UUID FK -> users.id | yes | ordered pair higher UUID |
| created_at | timestamptz | yes | |
| ended_at | timestamptz | no | nullable if active |

### Constraints

- `user_low_id < user_high_id`
- unique active friendship per pair

### Indexes

- `(user_low_id, ended_at)`
- `(user_high_id, ended_at)`

## 4.6 UserBlock

Represents a user-to-user ban.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| blocker_user_id | UUID FK -> users.id | yes | |
| blocked_user_id | UUID FK -> users.id | yes | |
| created_at | timestamptz | yes | |
| removed_at | timestamptz | no | nullable if active |

### Constraints

- blocker != blocked
- one active block per directed pair

### Indexes

- `(blocker_user_id, removed_at)`
- `(blocked_user_id, removed_at)`

## 4.7 Chat

Top-level chat container shared by rooms and direct chats.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| type | enum(`room`,`direct`) | yes | |
| current_sequence | bigint | yes | latest assigned chat-local message sequence |
| created_at | timestamptz | yes | |
| deleted_at | timestamptz | no | only if chat itself removed |

### Constraints

- `current_sequence >= 0`

### Notes

- sequence is chat-local and monotonically increasing
- rooms and direct chats extend this base chat

## 4.8 Room

Room-specific metadata for a chat of type `room`.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| chat_id | UUID PK FK -> chats.id | yes | one-to-one with chat |
| name | text | yes | globally unique |
| normalized_name | text | yes | unique canonical form: trim + NFC + whitespace collapse + case-insensitive |
| description | text | no | |
| visibility | enum(`public`,`private`) | yes | |
| owner_user_id | UUID FK -> users.id | yes | unique owner |
| created_at | timestamptz | yes | |
| updated_at | timestamptz | yes | |
| deleted_at | timestamptz | no | |

### Constraints

- unique `normalized_name`
- owning chat must be type `room`

### Indexes

- `(visibility, normalized_name)`
- `(owner_user_id)`

## 4.9 DirectChatParticipant

Participant rows for chats of type `direct`.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| chat_id | UUID FK -> chats.id | yes | |
| user_id | UUID FK -> users.id | yes | |
| created_at | timestamptz | yes | |

### Constraints

- exactly two rows per direct chat
- unique `(chat_id, user_id)`

### Notes

- enforce exactly two participants through transaction logic or DB constraint strategy

## 4.10 RoomMembership

Membership and role within a room.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| room_chat_id | UUID FK -> rooms.chat_id | yes | |
| user_id | UUID FK -> users.id | yes | |
| role | enum(`owner`,`admin`,`member`) | yes | |
| joined_at | timestamptz | yes | |
| left_at | timestamptz | no | nullable while active |
| removed_by_user_id | UUID FK -> users.id | no | audit field if removed |

### Constraints

- unique active membership per `(room_chat_id, user_id)`
- only one active `owner` per room

### Indexes

- `(user_id, left_at)`
- `(room_chat_id, role, left_at)`

## 4.11 RoomInvitation

Private-room invitation.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| room_chat_id | UUID FK -> rooms.chat_id | yes | |
| inviter_user_id | UUID FK -> users.id | yes | |
| invitee_user_id | UUID FK -> users.id | yes | |
| status | enum(`open`,`accepted`,`rejected`,`revoked`,`expired`) | yes | |
| created_at | timestamptz | yes | |
| responded_at | timestamptz | no | |

### Constraints

- invitee must be a registered user
- unique open invitation per `(room_chat_id, invitee_user_id)`

### Indexes

- `(invitee_user_id, status, created_at desc)`
- `(room_chat_id, status)`

## 4.12 RoomBan

Represents room-level ban status.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| room_chat_id | UUID FK -> rooms.chat_id | yes | |
| user_id | UUID FK -> users.id | yes | |
| banned_by_user_id | UUID FK -> users.id | yes | |
| created_at | timestamptz | yes | |
| removed_at | timestamptz | no | nullable if active |

### Constraints

- unique active room ban per `(room_chat_id, user_id)`

### Indexes

- `(room_chat_id, removed_at)`
- `(user_id, removed_at)`

## 4.13 Message

Persistent chat message. Landed by WS-04 in migration `0004_ws04_messaging.sql`; the schema matches this section verbatim (bigint `sequence`, `(chat_id, sequence)` unique, `kind` enum default `text`, reply FK `ON DELETE SET NULL`, nullable edit/delete audit columns).

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| chat_id | UUID FK -> chats.id | yes | |
| sequence | bigint | yes | chat-local monotonically increasing |
| author_user_id | UUID FK -> users.id | yes | may reference deleted user |
| kind | enum(`text`,`system`,`attachment`) | yes | extensible |
| body_text | text | no | up to 3 KB for user text |
| reply_to_message_id | UUID FK -> messages.id | no | optional |
| created_at | timestamptz | yes | |
| updated_at | timestamptz | yes | |
| edited_at | timestamptz | no | |
| deleted_at | timestamptz | no | |
| deleted_by_user_id | UUID FK -> users.id | no | |
| metadata_json | jsonb | no | reserved for future fields |

### Constraints

- unique `(chat_id, sequence)`
- `sequence > 0`
- text-size validation enforced in app and optionally DB check
- reply target should belong to same chat

### Indexes

- `(chat_id, sequence desc)`
- `(chat_id, created_at desc)`
- `(author_user_id, created_at desc)`
- `(reply_to_message_id)`

## 4.14 MessageEditAudit (optional but recommended)

Keeps audit history for edits.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| message_id | UUID FK -> messages.id | yes | |
| previous_body_text | text | yes | |
| edited_at | timestamptz | yes | |
| edited_by_user_id | UUID FK -> users.id | yes | |

### Notes

- optional from product perspective
- useful for moderation/admin forensics
- can be omitted if simplicity is prioritized

## 4.15 Attachment

Attachment metadata. Binary lives on filesystem under
`<ATTACHMENT_ROOT_DIR>/<chat_id>/<attachment_id>`. Landed by WS-06 in
`apps/api/drizzle/0005_ws06_attachments.sql`.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key; DEFAULT `gen_random_uuid()` but overridden by the upload service so the on-disk filename matches |
| chat_id | UUID FK -> chats.id | yes | ON DELETE CASCADE |
| message_id | UUID FK -> messages.id | yes | ON DELETE CASCADE. Every upload creates a sibling `kind='attachment'` message row in the same transaction; pre-message staging is out of scope for the MVP |
| uploaded_by_user_id | UUID FK -> users.id | no | ON DELETE SET NULL so account deletion preserves the historical row |
| original_filename | text | yes | preserved as supplied, minus stripped control chars; truncated to 255 chars |
| storage_path | text | yes | absolute path on disk |
| mime_type | text | no | caller-declared, used only for the media-class size branch and the download `Content-Type` |
| size_bytes | bigint | yes | measured server-side after the buffer is read |
| comment_text | text | no | optional attachment comment; if present, is also the sibling message's `body_text` |
| created_at | timestamptz | yes | `DEFAULT NOW()` |
| deleted_at | timestamptz | no | for room deletion or cleanup (WS-08 hard-purge) |

### Constraints

- size limit enforced in `apps/api/src/modules/attachments/service.ts`:
  - `image/*` MIME types: <= 3 MiB (`ATTACHMENT_MAX_IMAGE_BYTES`)
  - everything else: <= 20 MiB (`ATTACHMENT_MAX_FILE_BYTES`)
- the multipart parser's `fileSize` cap is set to `ATTACHMENT_MAX_FILE_BYTES`
  so the image-specific cap is a second check after the buffer is in memory.

### Indexes

- `(chat_id, created_at desc)` — per-chat listings and cleanup scans
- `(message_id)` — back-reference from a message to its attachment
- `(uploaded_by_user_id)` — uploader histories

## 4.16 ChatReadState

Per-user read position per chat. A row is created lazily on first read-state advancement; absence of a row means the user has never opened this chat. Landed by WS-04 in migration `0004_ws04_messaging.sql`: composite PK `(chat_id, user_id)`, `last_read_sequence BIGINT NOT NULL DEFAULT 0` with a `>= 0` CHECK, and a `(user_id, updated_at DESC)` index for cross-chat read-state queries.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| chat_id | UUID FK -> chats.id | yes | |
| user_id | UUID FK -> users.id | yes | |
| last_read_sequence | bigint | yes | `0` when row is first created by the server on read-state advance |
| last_opened_at | timestamptz | no | |
| updated_at | timestamptz | yes | |

### Constraints

- primary key `(chat_id, user_id)`
- `last_read_sequence >= 0`

### Indexes

- `(user_id, updated_at desc)`

### Initial-value rules

- No row exists for a chat a user has never opened. Queries that derive "unread" MUST LEFT JOIN and treat the missing row as `last_read_sequence = 0`.
- A never-opened chat with any messages has `hasUnread = true`. A never-opened chat with no messages (e.g., an empty newly-joined room) has `hasUnread = false`.
- The first successful `POST /chats/{chatId}/read` for a user/chat pair INSERTs the row; subsequent calls UPDATE it.
- `last_read_sequence` is clamped server-side to `min(requested, chat.current_sequence)`. Client-provided values exceeding head are silently clamped, not rejected, so clients can advance eagerly.

## 5. Derived or ephemeral models

These may live in Redis or in-memory structures and do not require durable storage.

### 5.1 LiveConnection

| Field | Notes |
|---|---|
| socket_id | unique live socket key |
| session_id | owning session |
| user_id | owning user |
| tab_id | optional browser-tab identifier |
| connected_at | connection time |
| last_heartbeat_at | liveness signal |
| last_activity_at | interaction signal |

### 5.2 PresenceAggregate

| Field | Notes |
|---|---|
| user_id | aggregate key |
| effective_presence | online / afk / offline |
| live_connection_count | count of non-stale sockets |
| last_effective_activity_at | latest recent activity across sockets |

### 5.3 OutboundSocketBuffer

| Field | Notes |
|---|---|
| socket_id | target socket |
| queued_event_count | bounded |
| oldest_event_at | age monitoring |

## 6. Relationship diagram (logical)

```text
User
 ├─< Session
 ├─< PasswordResetToken
 ├─< FriendRequest (requester / recipient)
 ├─< Friendship (paired)
 ├─< UserBlock (blocker / blocked)
 ├─< RoomMembership
 ├─< RoomInvitation (inviter / invitee)
 ├─< RoomBan (banned_by / banned_user)
 ├─< Message (author)
 ├─< Attachment (uploader)
 └─< ChatReadState

Chat
 ├─1 Room
 ├─< DirectChatParticipant
 ├─< Message
 ├─< Attachment
 └─< ChatReadState

Room
 ├─< RoomMembership
 ├─< RoomInvitation
 └─< RoomBan

Message
 ├─0..1 reply_to Message
 └─0..* Attachment (if linked by message)
```

## 7. Important consistency rules

## 7.1 Room ownership

- exactly one owner membership must exist for every active room
- owner must also be represented as an active room member
- owner may not leave the room without deleting it

## 7.2 Room-name uniqueness

- `normalized_name` must be globally unique across all active rooms
- normalization strategy is fixed as trim + Unicode NFC + internal whitespace collapse + case-insensitive comparison and must be consistent between UI validation and database constraint

## 7.3 Chat sequence integrity

- `chats.current_sequence` must never decrease
- message insertion and sequence assignment must occur in the same transaction
- no two messages in the same chat may share the same sequence

## 7.4 Read-state integrity

- `last_read_sequence` may not exceed current chat head sequence unless explicitly allowed for optimistic updates and then reconciled
- unread derivation is `chat.current_sequence > chat_read_state.last_read_sequence`

## 7.5 Ban and membership integrity

- active room ban implies user may not hold active membership
- acceptance of private invite must fail if active room ban exists
- join of public room must fail if active room ban exists

## 7.6 Block and DM integrity

- new DM message send must fail if any active block exists between participants
- if a direct chat already exists and a block is created, chat remains visible but new writes fail

## 7.7 Foreign-key cascade behaviors

Every FK in this model uses one of three behaviors. This table is binding for migration authors.

| Relationship | On parent delete |
|---|---|
| Session.user_id → users.id | `CASCADE` |
| PasswordResetToken.user_id → users.id | `CASCADE` |
| FriendRequest.requester_user_id / recipient_user_id → users.id | `RESTRICT` (must cancel/expire request before user hard-delete) |
| Friendship.user_low_id / user_high_id → users.id | `CASCADE` |
| UserBlock.blocker_user_id / blocked_user_id → users.id | `CASCADE` |
| Room.chat_id → chats.id | `CASCADE` |
| Room.owner_user_id → users.id | `RESTRICT` (owned rooms hard-delete before user hard-delete; see retention table) |
| DirectChatParticipant.chat_id → chats.id | `CASCADE` |
| DirectChatParticipant.user_id → users.id | `CASCADE` |
| RoomMembership.room_chat_id → rooms.chat_id | `CASCADE` |
| RoomMembership.user_id → users.id | `CASCADE` |
| RoomMembership.removed_by_user_id → users.id | `SET NULL` |
| RoomInvitation.room_chat_id → rooms.chat_id | `CASCADE` |
| RoomInvitation.inviter_user_id / invitee_user_id → users.id | `CASCADE` |
| RoomBan.room_chat_id → rooms.chat_id | `CASCADE` |
| RoomBan.user_id → users.id | `CASCADE` |
| RoomBan.banned_by_user_id → users.id | `SET NULL` (preserve "banned by unknown" history if the admin account is gone) |
| Message.chat_id → chats.id | `CASCADE` |
| Message.author_user_id → users.id | `RESTRICT` (soft-delete the user; messages survive with placeholder resolution) |
| Message.reply_to_message_id → messages.id | `SET NULL` |
| Message.deleted_by_user_id → users.id | `SET NULL` |
| MessageEditAudit.message_id → messages.id | `CASCADE` |
| MessageEditAudit.edited_by_user_id → users.id | `SET NULL` |
| Attachment.chat_id → chats.id | `CASCADE` |
| Attachment.message_id → messages.id | `CASCADE` |
| Attachment.uploaded_by_user_id → users.id | `SET NULL` |
| ChatReadState.chat_id → chats.id | `CASCADE` |
| ChatReadState.user_id → users.id | `CASCADE` |

Rationale: `CASCADE` where the child row is meaningless without the parent; `RESTRICT` where application-level cleanup must run first; `SET NULL` where audit attribution is nice-to-have but not required.

## 8. Suggested transaction boundaries

## 8.1 Send message

Single transaction:
1. verify authorization
2. lock chat head or otherwise safely allocate next sequence
3. insert message
4. update chat current_sequence
5. update unread/read side effects as required
6. commit
7. publish realtime event after commit

## 8.2 Accept invitation

Single transaction:
1. verify invitation open
2. verify no active room ban
3. create room membership
4. mark invitation accepted
5. commit
6. publish membership event

## 8.3 Remove member / ban member

Single transaction:
1. verify actor authorization
2. deactivate membership if present
3. create room ban if not present
4. commit
5. publish membership and ban events

## 8.4 Clear unread on open

Single transaction:
1. read current chat head sequence
2. upsert chat_read_state with head sequence
3. commit
4. publish read-state event if needed

## 9. Retention and deletion policy

Every entity uses one of four deletion strategies. This table is binding; implementations MUST match it.

| Entity | Strategy | TTL / trigger | Notes |
|---|---|---|---|
| User | Soft → hard | Soft on self-delete; hard purge 90 days after soft-delete if no surviving-room attribution is needed | On soft-delete, owned rooms are hard-deleted immediately; non-owned messages remain with author placeholder |
| Session | Hard | On logout, revoke, expiry, or user hard-delete | No soft state; once gone, gone |
| PasswordResetToken | Hard | On consume, revoke, expiry, or nightly cleanup ≥ 24h past `expires_at` | Hashes never linger |
| FriendRequest | Hard | On accept/reject/cancel/expire; expire-sweep runs nightly with 30-day TTL on `open` | |
| Friendship | Hard | On removal by either side | No audit row kept; removal is final |
| UserBlock | Hard | On unblock | |
| Chat | Soft | On room delete / direct-chat hard-disable | Hard-purged by cleanup job 30 days after `deleted_at` together with its Messages and Attachments |
| Room | Soft (follows Chat) | On owner delete | Same 30-day hard-purge window as its Chat |
| DirectChatParticipant | Hard (follows Chat lifecycle) | On chat hard-purge | |
| RoomMembership | Hard (row retained, `left_at` set) | On leave/remove/ban | Row stays so history can resolve "former member" attribution; physically purged with the room on hard-purge |
| RoomInvitation | Hard | On accept/reject/revoke/expire; expire-sweep runs nightly with 30-day TTL on `open` | |
| RoomBan | Hard (row retained, `removed_at` set) | On unban | Row stays so "banned by" history resolves; physically purged with the room |
| Message | Soft | On author delete / moderator delete | `deleted_at` set; body cleared from API responses; sequence preserved; row hard-purged 30 days after `deleted_at` by cleanup job |
| MessageEditAudit | Hard (follows Message) | On message hard-purge | |
| Attachment | Soft (follows Message) | On parent message delete or room delete | Binary file on disk is deleted at the same time the row is hard-purged, not at soft-delete time |
| ChatReadState | Hard | On chat hard-purge or user hard-delete | |

### Cleanup job contract

A scheduled cleanup job runs at least daily and:

1. Hard-purges Chats (and their Messages, Attachments, Memberships, Bans, ReadStates, Invitations) whose `deleted_at` is older than 30 days.
2. Hard-purges Messages individually soft-deleted more than 30 days ago, even if their parent Chat is still active.
3. Hard-deletes `FriendRequest` and `RoomInvitation` rows in `open` status older than 30 days (setting them to `expired` is redundant once deleted).
4. Hard-deletes `PasswordResetToken` rows where `expires_at` is more than 24h in the past OR `consumed_at IS NOT NULL`.
5. Hard-purges `User` rows soft-deleted more than 90 days ago and has no surviving-room attribution obligation (all their authored messages in surviving chats are already fully anonymized by placeholder resolution — the row itself is no longer needed).

### Attachment file binary lifecycle

- File binary on local disk is written at upload time under a server-generated identifier.
- Soft-delete of the Attachment row does NOT delete the file binary.
- Hard-purge of the Attachment row triggers deletion of the file binary in the same job step.
- If the file binary is missing at download time but the row is still active, return `INTERNAL_ERROR` (not `NOT_FOUND`) — this is a cleanup bug, not a user-facing state.

### Message-delete semantics (within the 30-day soft window)

- `deleted_at` set, `body_text` replaced with empty string in API responses (but retained in DB for audit until hard purge)
- `sequence` preserved so history reconciliation stays contiguous
- reply-target references still resolve (client renders "deleted message" placeholder)

## 10. Migration and schema evolution guidance

- use forward-only migrations
- never repurpose sequence fields
- treat enums carefully; prefer append-only changes where possible
- document any chosen normalization strategy for usernames and room names
- if optional XMPP is implemented later, model it as extension tables or separate bounded-context tables rather than modifying core chat semantics

## 11. Minimum schema acceptance checklist

Before implementation starts, confirm the schema supports:

- unique email and username
- immutable username at application layer
- global room-name uniqueness
- one owner per room
- active sessions with IP/browser details
- friend requests and friendships
- user blocks
- public/private rooms
- invitation accept/reject
- room bans
- per-chat message sequence
- reply-to references
- attachment metadata with local path
- per-user read state
