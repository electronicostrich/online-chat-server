# Glossary
## Online Chat Server

## 1. Purpose

This glossary defines the canonical vocabulary for product, BA, design, QA, and engineering documents. Use these terms consistently across PRD, architecture, API, UI, and test artifacts.

## 2. Canonical terms

### Active session
An authenticated browser/device session that is currently valid and has not been revoked or expired.

### Admin
A room role with moderation permissions defined by the room rules. Admin is lower than owner. The owner is always also an admin.

### AFK
Presence state meaning the user still has at least one live connection, but none of the live tabs has shown recent activity for more than one minute.

### Attachment
A file or image associated with a message. Metadata lives in durable storage; binary content is stored on the local filesystem.

### Authorization
The server-side decision about whether a user may perform an action or access a resource at the current moment.

### Ban, room
A room-scoped access denial. A user banned from a room cannot join or rejoin it until explicitly unbanned.

### Ban, user-to-user block
A user-scoped communication denial. When one user blocks another, new direct messaging is disallowed and existing direct-message history becomes read-only.

### Chat
Generic term for a message container. In this system, a chat is either a room chat or a direct chat.

### Chat-local sequence number
A monotonically increasing number assigned to each persisted message within a single chat. Used for authoritative ordering, gap detection, and reconciliation.

### Connection liveness
Whether a tab/socket is currently considered live by the server. It is derived from websocket connection state and heartbeat freshness.

### Contact / friend
A user with whom a friendship relationship has been established through accepted friend request.

### Direct chat / direct message / DM
A chat with exactly two participants. Direct messaging is allowed only between friends when neither side has blocked the other.

### Durable history
Persisted message history stored in the system of record and retrievable through authoritative APIs even after disconnects or long inactivity.

### Frozen direct chat
A direct chat whose history remains visible but whose composer is disabled because a user-to-user block exists.

### Guest
Unauthenticated visitor.

### Heartbeat
A periodic signal used to prove that a websocket/tab connection is still live.

### History reconciliation
The process of fetching authoritative message history after reconnect, sequence gap, or cache uncertainty in order to repair client state.

### Invitation
A private-room access offer sent to an already registered user. Acceptance grants room membership; rejection does not.

### Member
A user who currently belongs to a room.

### Offline
Presence state meaning the user has no live non-stale tabs/sessions remaining.

### Online
Presence state meaning at least one live tab/session has recent activity.

### Owner
The unique highest room role. Owner is always an admin, cannot leave their own room, and cannot lose admin privileges.

### Presence
The user-visible availability state derived from recent activity and connection liveness across a user's tabs/sessions.

### Public room
A room visible in the searchable public catalog and joinable by authenticated users unless they are banned from it.

### Private room
A room hidden from the public catalog and joinable only through invitation.

### Read-only direct chat
Same as frozen direct chat. History remains visible; new writes are blocked.

### Read state
The server-side record of how far a user has read within a given chat. Used to derive unread indicators.

### Registered user
An authenticated or authentically known product user account with persistent identity.

### Revoke session
Invalidate a specific authenticated session so it can no longer be used.

### Room
A named group chat with owner, admins, members, visibility, and room-scoped moderation state.

### Room membership
The relationship between a user and a room, including role and access status.

### Room removal
Administrative action that removes a user from a room. In this product, removal is treated as a room ban.

### Session
An authenticated browser/device context that persists across requests and may persist across browser restarts.

### Source of truth
The authoritative state store that determines correct system behavior. For durable business entities and message history, this is the primary database, not transient websocket delivery state.

### Stale connection
A connection that no longer sends heartbeats within the configured timeout window and therefore no longer counts as live for presence purposes.

### Transient delivery state
Short-lived in-memory or ephemeral-store state used only to accelerate delivery to currently connected clients. It is not durable and must remain bounded.

### Unban
Remove a user from a room's ban list. It does not automatically re-add them to the room.

### Unread indicator
UI marker showing that a chat has messages the user has not yet cleared by opening/synchronizing the chat.

### User activity signal
A client event indicating recent interaction, such as pointer movement, keyboard input, scrolling, focus regain, or composition activity.

### Watermark
In this documentation set, shorthand for the highest persisted or confirmed chat-local sequence number relevant to a client or chat state. Often discussed together with sequence numbers for gap detection.

### WebSocket acceleration layer
The realtime channel used for low-latency updates. It accelerates delivery but does not replace durable history or authoritative APIs.

## 3. Terms to avoid or use carefully

### "Delete from room"
Use carefully. In this product, administrative removal from room is treated as a ban, not a neutral removal.

### "Online session"
Avoid as ambiguous. Use **active session** for authenticated session and **live connection** for websocket/tab liveness.

### "Participant"
Allowed as a generic term for someone who currently has access to a chat. When precision matters, prefer **member**, **direct-chat participant**, **admin**, or **owner**.

### "Queue"
Use carefully. There is durable message history and there may be transient delivery buffers. Do not refer to durable history as a per-user delivery queue.

### "Status"
Avoid alone where ambiguity is possible. Prefer **presence state**, **membership state**, **session state**, or **invitation status**.
