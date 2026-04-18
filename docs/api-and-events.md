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

History APIs should support cursoring by sequence:
- `beforeSequence`
- `afterSequence`
- `limit`

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

### 4.5 Common authorization failure codes

- `UNAUTHENTICATED`
- `SESSION_REVOKED`
- `FORBIDDEN`
- `ROOM_BANNED`
- `NOT_A_MEMBER`
- `DM_NOT_ALLOWED`
- `INVITATION_INVALID`
- `MESSAGE_GAP_DETECTED`
- `VALIDATION_ERROR`

## 5. REST API

## 5.1 Auth and account

### POST `/auth/register`

Creates a new account.

#### Request

```json
{
  "email": "alice@example.com",
  "username": "alice",
  "password": "StrongPassword123!"
}
```

#### Response

```json
{
  "user": {
    "id": "uuid",
    "email": "alice@example.com",
    "username": "alice"
  }
}
```

#### Rules

- email unique
- username unique
- username immutable after creation

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

Lists searchable public rooms.

#### Query params

- `q` optional search text
- `limit`
- `cursor`

#### Response

```json
{
  "rooms": [
    {
      "chatId": "uuid",
      "name": "general",
      "description": "General discussion",
      "memberCount": 42
    }
  ]
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

Upload attachment.

Recommended default: multipart form upload.

#### Request fields

- `file`
- `commentText` optional
- `messageId` optional if attaching to existing draft flow

#### Response

```json
{
  "attachment": {
    "id": "uuid",
    "originalFilename": "spec-v3.pdf",
    "sizeBytes": 123456,
    "commentText": "latest requirements"
  }
}
```

---

### GET `/attachments/{attachmentId}/download`

Downloads attachment if currently authorized.

#### Response

Binary stream.

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

## 11. Minimum contract acceptance checklist

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
