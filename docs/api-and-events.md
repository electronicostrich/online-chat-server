# API and Events
## Online Chat Server

## 1. Purpose

This document defines the external contract shape for the system:

- REST endpoints for authoritative reads and mutations
- WebSocket events for low-latency state propagation
- event ordering, idempotency, and reconciliation rules
- reconnect and gap-repair behavior

This is a technical contract recommendation aligned to the PRD and architecture. It is not a user-facing API guarantee until implementation adopts it.

## 2. Design rules

1. REST is authoritative.
2. WebSocket is acceleration, not the sole source of truth.
3. Every message has a chat-local sequence number.
4. Client must tolerate duplicate, delayed, or missing events.
5. Any detected gap is repaired through REST history fetch.
6. Authorization is checked server-side for every request and command.

## 3. Authentication model

Recommended default:
- browser uses httpOnly server-managed session cookie
- `SameSite=Lax` by default
- `Secure` whenever HTTPS is in use, with development-only override for local plain HTTP
- REST and WebSocket both authenticate against the same revocable server-managed session
- state-changing REST endpoints require CSRF token validation plus Origin and/or Referer validation

## 4. Common conventions

### 4.1 IDs

Use UUIDs for durable entity identifiers:
- `userId`
- `sessionId`
- `chatId`
- `roomId` where room chat ID is reused
- `messageId`
- `attachmentId`
- `invitationId`

### 4.2 Timestamps

Use ISO 8601 UTC timestamps in API payloads.

### 4.3 Pagination

History APIs paginate by chat-local sequence number. Cursors are integer sequence numbers, NOT opaque tokens.

- `beforeSequence` (integer, optional) — return messages strictly before this sequence, newest-first
- `afterSequence` (integer, optional) — return messages strictly after this sequence, oldest-first (for gap repair)
- `limit` (integer, optional, default 50, max 100) — maximum items returned

Rules:
- `beforeSequence` and `afterSequence` are mutually exclusive; if both provided, server returns `VALIDATION_ERROR`
- If neither is provided, the endpoint returns the latest page (newest-first)
- If a cursor points to a deleted message, the message is still included (with `deletedAt` set) so gap repair stays contiguous
- Server response always includes current `headSequence` so the client can detect whether more history exists
- Clients must not construct cursors from any value other than a `sequence` they previously received from the server

Listing endpoints that are not per-chat history (e.g., `GET /rooms/public`) use opaque cursor tokens (`cursor`, `limit`) and do not expose internal sequence numbers.

### 4.4 Error shape

Recommended error payload:

```json
{
  "error": {
    "code": "ROOM_BANNED",
    "message": "User is banned from this room.",
    "details": {}
  }
}
```

### 4.5 Error code catalogue and HTTP status mapping

Every error response uses the envelope in 4.4 with one of the codes below. The HTTP status is determined by the code. Implementations MUST NOT pick a different status for a given code.

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | No valid session cookie present |
| `SESSION_REVOKED` | 401 | Session existed but was revoked; client must re-authenticate |
| `CSRF_FAILED` | 403 | CSRF token or Origin/Referer validation failed on a state-changing request |
| `FORBIDDEN` | 403 | Authenticated, but caller lacks the role/ownership for this action |
| `NOT_A_MEMBER` | 403 | Caller is not a member of the room/chat required for this action |
| `ROOM_BANNED` | 403 | Caller is banned from this room |
| `DM_NOT_ALLOWED` | 403 | Direct message blocked by friendship or block state |
| `NOT_FOUND` | 404 | Resource does not exist OR caller has no visibility into it (ambiguous by design) |
| `CONFLICT` | 409 | State conflict such as duplicate username, duplicate room name (after normalization), or stale edit |
| `INVITATION_INVALID` | 410 | Invitation expired, already consumed, or revoked |
| `VALIDATION_ERROR` | 400 | Malformed request body, invalid query param, or constraint violation not covered above |
| `PAYLOAD_TOO_LARGE` | 413 | Attachment exceeds size limit |
| `RATE_LIMITED` | 429 | Too many requests from this session/IP |
| `MESSAGE_GAP_DETECTED` | 409 | Client-reported sequence mismatch; client must re-sync via history |
| `INTERNAL_ERROR` | 500 | Unhandled server failure; client may retry with backoff |
| `SERVICE_UNAVAILABLE` | 503 | Dependency (DB, Redis) unreachable; client may retry with backoff |

Clients must treat unknown codes as `INTERNAL_ERROR` semantics. Servers must not introduce new codes without updating this table and `docs/error-envelope-and-conventions.md`.

## 5. REST API

For the mapping between each endpoint and its acceptance-criteria IDs, see `docs/traceability.md`. Every endpoint in this section is expected to be exercised by at least one Playwright test named after the AC it satisfies.

## 5.0 Envelope convention for the examples below

Every JSON example in §5 shows the **inner payload only**. The real on-the-wire response is wrapped per `docs/error-envelope-and-conventions.md`:

- Successful responses: `{ "data": <example> }`
- Collection responses: `{ "data": [ ... ], "pagination": {...} }`
- Error responses: `{ "error": { "code": "...", "message": "...", "details": {...}, "traceId": "..." } }`

For example, the §5.1 `POST /auth/register` example below shows:

```json
{ "user": { "id": "uuid", "email": "...", "username": "..." } }
```

The real response body is:

```json
{
  "data": {
    "user": { "id": "uuid", "email": "...", "username": "..." }
  }
}
```

The examples omit the wrapper for readability. Handlers and clients MUST use the real envelope shape — never the example as-is. The TypeBox schemas in `packages/shared-schemas/src/schemas/` are the authoritative wire shapes.

## 5.1 Auth and account

### POST `/auth/register`

Creates a new account AND establishes a session in one round trip.

#### Request

```json
{
  "email": "alice@example.com",
  "username": "alice",
  "password": "StrongPassword123!"
}
```

Field constraints (see §11 "Validation constants"):
- `email`: RFC 5321 syntactic validation, max 254 chars
- `username`: 3–30 chars, `[a-zA-Z0-9._-]`, canonical-normalized
- `password`: 12–128 chars, must contain at least 3 of {lowercase, uppercase, digit, non-alphanumeric}

#### Response

```json
{
  "user": {
    "id": "uuid",
    "email": "alice@example.com",
    "username": "alice"
  },
  "session": {
    "id": "uuid",
    "createdAt": "2026-04-18T12:00:00Z"
  }
}
```

Also sets the session cookie (`Set-Cookie: chat_sid=...; HttpOnly; SameSite=Lax`).

#### Rules

- email unique (`CONFLICT` with `details.field = "email"`)
- username unique after canonical normalization (`CONFLICT` with `details.field = "username"`)
- username immutable after creation
- **registration auto-logs-in**: the response includes a session and sets the cookie; no separate `/auth/login` call is needed after successful registration
- if any validation fails → `VALIDATION_ERROR` with `details.fieldErrors` keyed by JSON pointer

---

### POST `/auth/login`

Authenticates and creates session.

#### Request

```json
{
  "email": "alice@example.com",
  "password": "StrongPassword123!"
}
```

#### Response

```json
{
  "user": {
    "id": "uuid",
    "username": "alice"
  },
  "session": {
    "id": "uuid",
    "createdAt": "2026-04-18T12:00:00Z"
  }
}
```

---

### POST `/auth/logout`

Revokes current session only.

#### Response

```json
{
  "ok": true
}
```

---

### GET `/sessions`

Lists active sessions for current user.

#### Response

```json
{
  "sessions": [
    {
      "id": "uuid",
      "current": true,
      "userAgent": "Chrome on macOS",
      "ipAddress": "203.0.113.10",
      "createdAt": "2026-04-18T12:00:00Z",
      "lastSeenAt": "2026-04-18T12:40:00Z"
    }
  ]
}
```

---

### POST `/auth/logout-session`

Revokes a selected session.

#### Request

```json
{
  "sessionId": "uuid"
}
```

#### Response

```json
{
  "ok": true
}
```

---

### POST `/auth/password-reset/request`

Initiates password reset.

#### Request

```json
{
  "email": "alice@example.com"
}
```

#### Response

```json
{
  "ok": true
}
```

---

### POST `/auth/password-reset/confirm`

Consumes reset token and sets new password.

#### Request

```json
{
  "token": "raw-reset-token",
  "newPassword": "NewStrongPassword123!"
}
```

#### Response

```json
{
  "ok": true
}
```

#### Rules

- `newPassword` must pass the password constraints in §11
- a successful reset also revokes all active sessions for the user
- the reset token is single-use; any subsequent attempt with the same token → `INVITATION_INVALID`

---

### POST `/auth/password-change`

Changes the current user's password while authenticated. Distinct from `/auth/password-reset/confirm` in that it requires a valid session plus the current password.

#### Request

```json
{
  "currentPassword": "OldStrongPassword123!",
  "newPassword": "NewStrongPassword123!"
}
```

#### Response

```json
{
  "ok": true
}
```

#### Rules

- requires a valid session (`UNAUTHENTICATED` otherwise)
- `currentPassword` must match the stored hash (`FORBIDDEN` with `details.reason = "currentPasswordInvalid"` otherwise)
- `newPassword` must pass the constraints in §11
- `newPassword` must differ from `currentPassword` (`VALIDATION_ERROR`)
- on success, all OTHER active sessions for the user are revoked; the current session is preserved so the caller stays logged in on this browser
- the caller receives a `session.revoked` event on their WebSocket for each other session that was terminated

Linked to AC-AUTH-07.

---

### DELETE `/users/me`

Deletes the caller's account. Irreversible from the user's perspective; internally soft-deletes per the retention policy in `docs/data-model.md` §9.

#### Request

```json
{
  "password": "CurrentPassword123!"
}
```

#### Response

```json
{
  "ok": true
}
```

#### Side effects (single transaction)

- `User.status` → `deleted`; `User.deleted_at` → now
- all Sessions for this user revoked
- Rooms owned by this user soft-deleted (cascaded Chat/Message/Attachment soft-deletes per `data-model.md` §9)
- Friendships removed (hard-delete)
- Open friend requests cancelled
- UserBlocks involving this user removed
- Non-owned room memberships set to `left`
- Messages authored in surviving chats preserved with the author rendered as "deleted user"

#### Rules

- requires a valid session
- `password` must match the stored hash (`FORBIDDEN` otherwise)
- returns `200` as soon as the transaction commits; the cleanup job performs hard-purge later

Linked to AC-AUTH-09.

## 5.2 Friends and blocks

### POST `/friends/requests`

Create friend request.

#### Request

```json
{
  "recipientUsername": "bob",
  "message": "Let's connect."
}
```

#### Response

```json
{
  "request": {
    "id": "uuid",
    "status": "open"
  }
}
```

---

### POST `/friends/requests/{requestId}/accept`

Accept incoming friend request.

#### Response

```json
{
  "friendship": {
    "friendUserId": "uuid"
  }
}
```

---

### POST `/friends/requests/{requestId}/reject`

Reject incoming friend request.

#### Response

```json
{
  "ok": true
}
```

---

### DELETE `/friends/{userId}`

Remove friendship.

#### Side effects

- disables new DM creation and new DM sends immediately
- if an existing direct chat exists, it remains visible but read-only until friendship is re-established and neither side is blocked

#### Response

```json
{
  "ok": true
}
```

---

### POST `/blocks/{userId}`

Block another user.

#### Response

```json
{
  "ok": true
}
```

#### Side effects

- disables new DM creation and new DM sends
- existing direct chat becomes read-only

---

### DELETE `/blocks/{userId}`

Remove block.

#### Response

```json
{
  "ok": true
}
```

## 5.3 Rooms

### GET `/rooms/public`

Lists searchable public rooms. Private rooms are excluded at the SQL
layer so name-based probing cannot surface them — see AC-ROOM-04.

#### Query params

- `q` optional case-insensitive substring match against `rooms.name`
- `limit` integer, `[1, PAGINATION_CURSOR_MAX_LIMIT]`, default `PAGINATION_CURSOR_DEFAULT_LIMIT`
- `cursor` opaque base64url token returned in a prior response's `nextCursor`

#### Response

```json
{
  "data": {
    "rooms": [
      {
        "chatId": "uuid",
        "name": "general",
        "description": "General discussion",
        "memberCount": 42,
        "createdAt": "2026-04-20T12:34:56Z"
      }
    ],
    "nextCursor": "base64url-token-or-null"
  }
}
```

---

### POST `/rooms`

Create room.

#### Request

```json
{
  "name": "engineering",
  "description": "Backend and frontend discussion",
  "visibility": "public"
}
```

#### Response

```json
{
  "room": {
    "chatId": "uuid",
    "name": "engineering",
    "visibility": "public",
    "ownerUserId": "uuid"
  }
}
```

---

### GET `/rooms/{roomId}`

Fetch room metadata and current viewer-specific authorization state.

#### Response

```json
{
  "room": {
    "chatId": "uuid",
    "name": "engineering",
    "description": "Backend and frontend discussion",
    "visibility": "public",
    "ownerUserId": "uuid"
  },
  "viewer": {
    "role": "member",
    "isBanned": false
  }
}
```

---

### PATCH `/rooms/{roomId}`

Update room metadata or visibility.

#### Request

```json
{
  "description": "Updated description",
  "visibility": "private"
}
```

#### Response

```json
{
  "room": {
    "chatId": "uuid",
    "visibility": "private"
  }
}
```

---

### DELETE `/rooms/{roomId}`

Deletes room and its messages and attachments.

#### Response

```json
{
  "ok": true
}
```

---

### POST `/rooms/{roomId}/join`

Join public room.

#### Response

```json
{
  "membership": {
    "role": "member"
  }
}
```

---

### POST `/rooms/{roomId}/leave`

Leave room if not owner.

#### Response

```json
{
  "ok": true
}
```

## 5.4 Invitations

### POST `/rooms/{roomId}/invitations`

Create private-room invitation for a registered user.

#### Request

```json
{
  "inviteeUsername": "bob"
}
```

#### Response

```json
{
  "invitation": {
    "id": "uuid",
    "status": "open"
  }
}
```

---

### POST `/rooms/{roomId}/invitations/{invitationId}/accept`

Accept invite.

#### Response

```json
{
  "membership": {
    "role": "member"
  }
}
```

---

### POST `/rooms/{roomId}/invitations/{invitationId}/reject`

Reject invite.

#### Response

```json
{
  "ok": true
}
```

## 5.5 Membership and moderation

### POST `/rooms/{roomId}/members/{userId}/make-admin`

#### Response

```json
{
  "ok": true
}
```

---

### POST `/rooms/{roomId}/members/{userId}/remove-admin`

#### Response

```json
{
  "ok": true
}
```

---

### POST `/rooms/{roomId}/members/{userId}/remove`

Removes member and treats removal as a ban.

#### Response

```json
{
  "ok": true
}
```

---

### POST `/rooms/{roomId}/bans/{userId}`

Ban a user from room.

#### Response

```json
{
  "ok": true
}
```

---

### DELETE `/rooms/{roomId}/bans/{userId}`

Unban a user.

#### Response

```json
{
  "ok": true
}
```

---

### GET `/rooms/{roomId}/bans`

List banned users and who banned them.

#### Response

```json
{
  "bans": [
    {
      "userId": "uuid",
      "username": "eve",
      "bannedByUserId": "uuid",
      "bannedByUsername": "alice",
      "createdAt": "2026-04-18T13:25:00Z"
    }
  ]
}
```

## 5.6 Chats and messages

### GET `/chats/{chatId}/messages`

Fetch message history.

#### Query params

- `beforeSequence`
- `afterSequence`
- `limit`

Recommended usage:
- initial load: no cursor, fetch latest page
- infinite scroll: use `beforeSequence`
- repair gap: use `afterSequence` plus `limit` or specific range endpoint if implemented

#### Response

```json
{
  "chatId": "uuid",
  "headSequence": 105,
  "messages": [
    {
      "id": "uuid",
      "chatId": "uuid",
      "sequence": 105,
      "authorUserId": "uuid",
      "authorDisplay": "alice",
      "bodyText": "hello",
      "replyToMessageId": null,
      "createdAt": "2026-04-18T13:00:00Z",
      "editedAt": null,
      "deletedAt": null,
      "attachments": []
    }
  ]
}
```

---

### POST `/chats/{chatId}/messages`

Create message.

#### Request

```json
{
  "bodyText": "Hello team",
  "replyToMessageId": "uuid"
}
```

#### Response

```json
{
  "message": {
    "id": "uuid",
    "chatId": "uuid",
    "sequence": 106,
    "authorUserId": "uuid",
    "bodyText": "Hello team",
    "replyToMessageId": "uuid",
    "createdAt": "2026-04-18T13:00:05Z"
  }
}
```

---

### PATCH `/messages/{messageId}`

Edit own message.

#### Request

```json
{
  "bodyText": "Updated text"
}
```

#### Response

```json
{
  "message": {
    "id": "uuid",
    "editedAt": "2026-04-18T13:02:00Z"
  }
}
```

---

### DELETE `/messages/{messageId}`

Delete own message or room message as admin.

#### Response

```json
{
  "ok": true
}
```

## 5.6.1 Direct-chat creation and sending

Direct chats have a chicken-and-egg problem: `POST /chats/{chatId}/messages` requires a `chatId`, but the DM is supposed to be created ONLY on the first successful message (per AC-DM-05). This section resolves it.

### POST `/dm/{userId}/messages`

Sends a direct message to the given user, creating the direct chat on first successful send.

#### Request

```json
{
  "bodyText": "Hey, wanted to ask you something",
  "replyToMessageId": null
}
```

#### Response

```json
{
  "chat": {
    "id": "uuid",
    "created": true
  },
  "message": {
    "id": "uuid",
    "chatId": "uuid",
    "sequence": 1,
    "authorUserId": "uuid",
    "bodyText": "Hey, wanted to ask you something",
    "createdAt": "2026-04-18T13:00:00Z"
  }
}
```

- `chat.created` is `true` when this call created the DM, `false` when the DM already existed and this call appended to it.

#### Rules

- requires a valid session
- `userId` must resolve to an active registered user
- caller and target must be friends AND neither may have blocked the other (`DM_NOT_ALLOWED` otherwise)
- `bodyText` must satisfy the message size constraint in AC-MSG-02
- this endpoint is the ONLY path that creates a direct chat; once a DM exists, subsequent sends use `POST /chats/{chatId}/messages` with the returned `chatId`
- the client should cache the `chatId` for the duration of the user's session and prefer the chat-scoped send endpoint thereafter
- first send allocates `sequence = 1`; all standard message-send behaviors apply (idempotency, event fan-out)

Linked to AC-DM-05.

## 5.7 Read state

### POST `/chats/{chatId}/read`

Advance read state.

#### Request

```json
{
  "readUpToSequence": 106
}
```

#### Response

```json
{
  "chatId": "uuid",
  "lastReadSequence": 106
}
```

#### Rules

- client should call this only after chat history is synchronized to the current server head
- server may clamp to current chat head
- server remains authoritative for final stored value

### GET `/chats/{chatId}/read-state`

Fetch read state for current user.

#### Response

```json
{
  "chatId": "uuid",
  "lastReadSequence": 106,
  "headSequence": 110,
  "hasUnread": true
}
```

## 5.8 Attachments

### POST `/chats/{chatId}/attachments`

Upload attachment. Multipart form upload (`multipart/form-data`).

#### Request fields

- `file` (required) — the binary; the `filename` and `content-type` parameters
  are preserved in metadata but never trusted for the storage path.
- `commentText` (optional) — text that becomes the sibling message's body.

Pre-message draft staging (attaching to a previously-drafted message) is
not supported by this slice: every successful upload atomically creates a
new `kind='attachment'` message row in the same chat, and the returned
`message.sequence` is the chat's new head.

#### Rules

- Caller must currently have write access to the chat (active room
  membership OR active DM with both sides friends and unblocked).
- Size limits (see §12.6): 3 MiB for `image/*` MIME types, 20 MiB
  otherwise. Oversize uploads are rejected with `PAYLOAD_TOO_LARGE`
  (AC-ATT-02). No file-type restriction beyond that (AC-ATTACH-05).
- `originalFilename` is preserved as the caller supplied it (minus
  stripped control characters and truncated to 255 bytes).

#### Response (wrapped in `data`)

```json
{
  "attachment": {
    "id": "uuid",
    "chatId": "uuid",
    "messageId": "uuid",
    "originalFilename": "spec-v3.pdf",
    "sizeBytes": 123456,
    "mimeType": "application/pdf",
    "commentText": "latest requirements",
    "createdAt": "2026-04-19T12:34:56.000Z"
  },
  "message": { "...": "MessagePublic, kind='attachment'" }
}
```

#### Side effects

- Allocates the chat's next sequence and inserts a `kind='attachment'`
  message row with the attachment linked via `attachments.message_id`.
- Publishes `message.created` to every subscribed socket on this chat
  (WS-05 fan-out).
- Writes the binary to
  `<ATTACHMENT_ROOT_DIR>/<chatId>/<attachmentId>` on the host
  filesystem.

---

### GET `/attachments/{attachmentId}/download`

Downloads an attachment if the caller currently has read access to the
containing chat (AC-ATT-03). Ex-members, banned users, users whose DM has
been frozen/deleted, and callers hitting a soft-deleted chat (AC-ATT-04)
all receive `404 NOT_FOUND` with no information leak.

#### Response

Binary stream. Headers:

- `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<rfc5987>`
  (AC-ATTACH-06 — the ASCII fallback is sanitized; the `filename*` form
  carries the original filename).
- `Content-Type`: the stored `mime_type`, or `application/octet-stream`
  if none was recorded.
- `Cache-Control: private, no-store` — every download re-evaluates
  access at request time.
- `X-Content-Type-Options: nosniff`.

## 5.9 Bootstrap endpoints

### GET `/me/bootstrap`

Recommended convenience endpoint to hydrate app shell after page load.

#### Response

```json
{
  "user": {
    "id": "uuid",
    "username": "alice"
  },
  "presence": "online",
  "rooms": [],
  "contacts": [],
  "sessions": [],
  "pendingInvitations": [],
  "pendingFriendRequests": []
}
```

## 5.10 Health and operations

### GET `/healthz`

Un-authenticated liveness + readiness probe. Used by Docker healthchecks and CI service-container waits.

#### Response (healthy)

HTTP 200:

```json
{
  "status": "ok",
  "checks": {
    "db": "ok",
    "redis": "ok",
    "attachments": "ok"
  },
  "version": "0.1.0"
}
```

#### Response (degraded)

HTTP 503:

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "One or more dependencies are unhealthy.",
    "details": {
      "failing": ["db"],
      "checks": {
        "db": "down",
        "redis": "ok",
        "attachments": "ok"
      }
    },
    "traceId": "..."
  }
}
```

Per §5.0, the happy response body is wrapped: `{ "data": { "status": "ok", ... } }`. The degraded body is wrapped as an `error` envelope.

#### Rules

- no authentication required; no CSRF enforcement
- not rate-limited (hit by healthchecks every few seconds)
- check semantics:
  - `db`: `SELECT 1` against PostgreSQL (fail fast with 250ms timeout)
  - `redis`: `PING` expecting `PONG` (250ms timeout)
  - `attachments`: `ATTACHMENT_ROOT_DIR` exists, is a directory, is writable
- if any check fails → 503 with `error.code = "SERVICE_UNAVAILABLE"`; `details.failing` lists the failing check names
- `version` is read from `package.json` at startup; do not call it per-request

Linked to AC-BOOT-00.

## 6. WebSocket contract

## 6.1 Endpoint

Recommended endpoint:

`GET /ws`

Uses session cookie authentication during handshake.

## 6.2 Client -> server commands

Recommended command envelope:

```json
{
  "id": "client-command-id",
  "type": "presence.heartbeat",
  "payload": {}
}
```

### Command types

- `presence.heartbeat`
- `presence.activity`
- `chat.subscribe`
- `chat.unsubscribe`
- `sync.request`
- optional `message.send` if sending over websocket is preferred for low-latency UX

### Example: activity heartbeat

```json
{
  "id": "cmd-1",
  "type": "presence.activity",
  "payload": {
    "tabId": "tab-123",
    "activityAt": "2026-04-18T13:00:00Z"
  }
}
```

### Example: chat subscribe

```json
{
  "id": "cmd-2",
  "type": "chat.subscribe",
  "payload": {
    "chatId": "uuid"
  }
}
```

### `sync.request`

Sent by the client on reconnect (or on demand when a gap is detected) to reconcile per-chat state with the server.

#### Command

```json
{
  "id": "cmd-3",
  "type": "sync.request",
  "payload": {
    "chats": [
      {
        "chatId": "uuid",
        "lastKnownContiguousSequence": 104,
        "lastKnownReadSequence": 100
      }
    ]
  }
}
```

#### Server reply (`sync.response` event)

```json
{
  "eventId": "uuid",
  "type": "sync.response",
  "occurredAt": "2026-04-18T13:10:00Z",
  "payload": {
    "replyToCommandId": "cmd-3",
    "chats": [
      {
        "chatId": "uuid",
        "headSequence": 110,
        "serverReadSequence": 100,
        "advice": "fetch-history",
        "rangeHint": { "fromSequence": 105, "toSequence": 110 }
      }
    ]
  }
}
```

#### Rules

- Client MAY include at most 200 chats per request. Over limit → `VALIDATION_ERROR`.
- Server computes per-chat advice:
  - `in-sync` → client's `lastKnownContiguousSequence` equals `headSequence`
  - `fetch-history` → a gap exists; client must call `GET /chats/{chatId}/messages` with `afterSequence = lastKnownContiguousSequence` until head is reached
  - `chat-inaccessible` → caller has lost access (ban, removal, deletion); client must drop local state for this chat
- Server de-duplication: if the same session sends overlapping `sync.request` commands, the server may coalesce them and reply once with the latest state. Client must rely on `replyToCommandId` to match requests to replies.
- Until the client has received the `sync.response` for a chat, it MUST NOT mark new incoming events for that chat as contiguous.

## 6.3 Server -> client event envelope

```json
{
  "eventId": "uuid",
  "type": "message.created",
  "occurredAt": "2026-04-18T13:00:05Z",
  "payload": {}
}
```

## 6.4 Event types

### `message.created`

```json
{
  "eventId": "uuid",
  "type": "message.created",
  "occurredAt": "2026-04-18T13:00:05Z",
  "payload": {
    "chatId": "uuid",
    "headSequence": 106,
    "message": {
      "id": "uuid",
      "sequence": 106,
      "authorUserId": "uuid",
      "bodyText": "Hello team",
      "replyToMessageId": null,
      "createdAt": "2026-04-18T13:00:05Z"
    }
  }
}
```

### `message.edited`

```json
{
  "eventId": "uuid",
  "type": "message.edited",
  "occurredAt": "2026-04-18T13:02:00Z",
  "payload": {
    "chatId": "uuid",
    "messageId": "uuid",
    "sequence": 106,
    "bodyText": "Updated text",
    "editedAt": "2026-04-18T13:02:00Z"
  }
}
```

### `message.deleted`

```json
{
  "eventId": "uuid",
  "type": "message.deleted",
  "occurredAt": "2026-04-18T13:03:00Z",
  "payload": {
    "chatId": "uuid",
    "messageId": "uuid",
    "sequence": 106,
    "deletedAt": "2026-04-18T13:03:00Z"
  }
}
```

### `presence.updated`

```json
{
  "eventId": "uuid",
  "type": "presence.updated",
  "occurredAt": "2026-04-18T13:01:00Z",
  "payload": {
    "userId": "uuid",
    "presence": "afk"
  }
}
```

### `readstate.updated`

```json
{
  "eventId": "uuid",
  "type": "readstate.updated",
  "occurredAt": "2026-04-18T13:04:00Z",
  "payload": {
    "chatId": "uuid",
    "userId": "uuid",
    "lastReadSequence": 106
  }
}
```

### `room.invitation.created`

```json
{
  "eventId": "uuid",
  "type": "room.invitation.created",
  "occurredAt": "2026-04-18T13:05:00Z",
  "payload": {
    "invitationId": "uuid",
    "room": {
      "chatId": "uuid",
      "name": "engineering"
    }
  }
}
```

### `room.membership.updated`

```json
{
  "eventId": "uuid",
  "type": "room.membership.updated",
  "occurredAt": "2026-04-18T13:06:00Z",
  "payload": {
    "chatId": "uuid",
    "userId": "uuid",
    "membershipState": "member",
    "role": "member"
  }
}
```

### `room.ban.updated`

```json
{
  "eventId": "uuid",
  "type": "room.ban.updated",
  "occurredAt": "2026-04-18T13:07:00Z",
  "payload": {
    "chatId": "uuid",
    "userId": "uuid",
    "isBanned": true
  }
}
```

### `session.revoked`

```json
{
  "eventId": "uuid",
  "type": "session.revoked",
  "occurredAt": "2026-04-18T13:08:00Z",
  "payload": {
    "sessionId": "uuid"
  }
}
```

## 7. Ordering, idempotency, and repair

## 7.1 Message ordering

Authoritative order is by:
1. `chatId`
2. `sequence`

Never order by client time.

## 7.2 Event idempotency

Client must deduplicate by:
- `eventId` for event replay protection
- `message.id` for message entity deduplication

## 7.3 Gap detection

Client stores, per chat:
- `highestContiguousSequence`
- `headSequence`
- reconciliation-in-progress flag

If client expects `n + 1` and receives `n + 2`, it:
1. marks gap detected
2. suspends trust in local stream completeness
3. calls REST history repair endpoint or range fetch
4. merges missing messages
5. updates contiguous sequence
6. clears gap state

## 7.4 Reconnect procedure

On websocket reconnect:

1. authenticate session
2. resubscribe to active chats
3. send sync request containing last known contiguous sequence per visible chat
4. server may respond with current heads or advise history fetch
5. client calls REST history endpoints as needed
6. client resumes normal stream processing only after reconciliation

## 7.5 Slow consumer handling

If socket cannot keep up:
- server may disconnect it
- client reconnects and repairs through REST

This is preferred over unbounded memory growth.

## 8. Sequence-aware history repair

Recommended optional endpoint:

### GET `/chats/{chatId}/messages/range`

#### Query params

- `fromSequence`
- `toSequence`

#### Response

```json
{
  "chatId": "uuid",
  "messages": [
    {
      "id": "uuid",
      "sequence": 104
    },
    {
      "id": "uuid",
      "sequence": 105
    }
  ]
}
```

If this endpoint is not implemented, repair can be done with `afterSequence` + `limit`.

## 9. Authorization matrix summary

| Operation | Must be authenticated | Must be member | Must be admin | Must be owner | Must be friends | Must be unblocked |
|---|---:|---:|---:|---:|---:|---:|
| join public room | yes | no | no | no | no | n/a |
| invite to private room | yes | yes | no | no | no | n/a |
| accept private invite | yes | no | no | no | no | n/a |
| send room message | yes | yes | no | no | no | n/a |
| delete own message | yes | author | no | no | no | n/a |
| delete room message as moderator | yes | yes | yes | no | no | n/a |
| ban room member | yes | yes | yes | owner for owner-targeted changes | no | n/a |
| promote member to admin | yes | yes | yes (admin-or-owner, per PO 2026-04-18) | no | no | n/a |
| demote non-owner admin | yes | yes | yes (admin-or-owner; never owner) | no | no | n/a |
| create DM / send DM | yes | n/a | no | no | yes | yes |
| download attachment | yes | authorized chat participant | no | no | if DM | yes if DM |

## 10. Suggested implementation split: REST write vs websocket write

Two acceptable patterns:

### Option A: REST creates messages, WebSocket broadcasts results
- simplest consistency model
- easiest auditability
- slightly higher request latency path

### Option B: WebSocket command sends message, server persists, WebSocket broadcasts persisted result
- lower latency feel
- more complexity in command/reply handling

Recommended default: **Option A** unless there is a strong reason to move message creation to websocket commands. In either case, persisted result and sequence allocation rules stay the same.

## 11. Validation constants

These are the binding field-level constraints referenced from §5 endpoint rules. They live in TypeBox form at `packages/shared-schemas/src/constants/limits.ts` and are imported by every schema that validates these fields.

### 12.1 Username

| Rule | Value |
|---|---|
| Min length (characters) | 3 |
| Max length (characters) | 30 |
| Allowed character class | `[a-zA-Z0-9._-]` |
| Canonical normalization | trim → Unicode NFC → collapse internal whitespace → case-insensitive comparison (see PRD §12.5) |
| Mutability | immutable after registration |
| Uniqueness | global, after canonical normalization |

### 12.2 Password

| Rule | Value |
|---|---|
| Min length (characters) | 12 |
| Max length (characters) | 128 |
| Character-class requirement | must contain at least 3 of: {lowercase letter, uppercase letter, digit, non-alphanumeric} |
| Storage | Argon2id hash only; never logged, never returned in any response |
| Comparison | constant-time against stored hash |

Rationale: 12 chars + 3/4 character classes blocks trivial brute-force against an Argon2id work factor without pushing into paranoid territory. If a future compliance requirement raises the bar, update this table and `packages/shared-schemas/src/constants/limits.ts` together.

### 12.3 Email

| Rule | Value |
|---|---|
| Format | RFC 5321 syntactic validation |
| Max length (characters) | 254 |
| Uniqueness | global, case-insensitive |
| Canonical form for uniqueness | lowercase the entire address |

### 12.4 Room name

| Rule | Value |
|---|---|
| Min length (characters) | 2 |
| Max length (characters) | 50 |
| Canonical normalization | same as username (trim + NFC + whitespace collapse + case-insensitive) |
| Uniqueness | global, after canonical normalization |

### 12.5 Message body

| Rule | Value |
|---|---|
| Max size (bytes) | 3072 (3 KiB) |
| Encoding | UTF-8 |
| Allowed content | arbitrary text, emoji, embedded newlines |
| Enforcement | both UI validation and Fastify schema validation |

### 12.6 Attachment

| Rule | Value |
|---|---|
| Max file size (bytes) | 20,971,520 (20 MiB) |
| Max image size (bytes) | 3,145,728 (3 MiB) |
| File-type restriction | none beyond size limits (see AC-ATTACH-05) |
| Original filename | preserved in metadata; sanitized on download (see AC-ATTACH-06) |

### 12.7 Pagination limits

| Rule | Value |
|---|---|
| Default `limit` for history endpoints | 50 |
| Max `limit` for history endpoints | 100 |
| Default `limit` for opaque-cursor listings | 25 |
| Max `limit` for opaque-cursor listings | 100 |

### 12.8 Session lifecycle

| Rule | Value |
|---|---|
| Default session TTL | 30 days (`SESSION_TTL_SECONDS = 2592000`) |
| Session cookie name | `chat_sid` (configurable via `SESSION_COOKIE_NAME`) |
| Last-seen touch cadence | at most once per 60 seconds per session |

### 12.9 Rate limits

See `docs/error-envelope-and-conventions.md` §7. The defaults listed there are binding.

---

## 12. Minimum contract acceptance checklist

Before implementation starts, confirm the contract supports:

- active-session listing and revocation
- public room search
- private-room invitations
- room moderation
- message history pagination
- message sequence-based gap repair
- read-state sync
- attachment upload/download with authorization
- websocket presence and message updates
- session revocation propagation
