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
| email | text | yes | unique |
| username | text | yes | unique, immutable |
| password_hash | text | yes | adaptive hash |
| display_name | text | no | optional UI label if ever needed |
| status | enum(`active`,`deleted`) | yes | effective account status |
| deleted_at | timestamptz | no | null unless deleted |
| created_at | timestamptz | yes | |
| updated_at | timestamptz | yes | |

### Constraints

- unique normalized `email`
- unique normalized `username` where normalization = trim + Unicode NFC + internal whitespace collapse + case-insensitive comparison

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

Persistent chat message.

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

Attachment metadata. Binary lives on filesystem.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| id | UUID | yes | primary key |
| chat_id | UUID FK -> chats.id | yes | |
| message_id | UUID FK -> messages.id | no | null if supporting pre-message upload staging |
| uploaded_by_user_id | UUID FK -> users.id | yes | |
| original_filename | text | yes | preserved filename |
| storage_path | text | yes | absolute or rooted relative path |
| mime_type | text | no | |
| size_bytes | bigint | yes | |
| comment_text | text | no | optional attachment comment |
| created_at | timestamptz | yes | |
| deleted_at | timestamptz | no | for room deletion or cleanup |

### Constraints

- size limit enforced by app:
  - files <= 20 MB
  - images <= 3 MB

### Indexes

- `(chat_id, created_at desc)`
- `(message_id)`
- `(uploaded_by_user_id)`

## 4.16 ChatReadState

Per-user read position per chat.

### Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| chat_id | UUID FK -> chats.id | yes | |
| user_id | UUID FK -> users.id | yes | |
| last_read_sequence | bigint | yes | defaults to 0 |
| last_opened_at | timestamptz | no | |
| updated_at | timestamptz | yes | |

### Constraints

- primary key `(chat_id, user_id)`
- `last_read_sequence >= 0`

### Indexes

- `(user_id, updated_at desc)`

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

## 9. Soft delete vs hard delete guidance

### Required hard deletes

- room deletion must permanently delete room messages and room attachments
- account deletion must delete rooms owned by that user and their contents

### Recommended implementation choice for message deletion within active chats

Keep the message row and mark it deleted rather than physically removing it immediately. Reasons:

- preserves sequence continuity
- preserves reply references
- simplifies reconciliation
- aligns better with durable history semantics

This is a technical recommendation, not a source requirement.

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
