# Product Requirements Document
## Online Chat Server

## 1. Product overview

Build a browser-based online chat application that delivers a classic web chat experience: public and private chat rooms, one-to-one direct messaging, friend lists, persistent message history, unread indicators, presence states, file and image sharing, active session management, and room moderation.

The system should be production-adjacent in behavior and architecture, self-contained for local deployment, and robust under moderate concurrent load. It should resemble a classic web chat application rather than a social network or collaboration suite.

## 2. Product goals

The product must:

- support up to 300 simultaneously connected users
- keep message delivery responsive, with low-latency realtime updates
- preserve long-lived chat history and attachment access rules
- maintain correct behavior across multiple tabs and active sessions
- enforce clear room, friendship, moderation, and access-control state transitions
- remain operable as a locally deployed, self-contained system

## 3. Product non-goals

The product does not include:

- email verification
- forced periodic password rotation
- message reactions
- typing indicators
- threaded conversations beyond message reply/reference
- advanced history search
- message recovery after deletion
- voice or video calling
- broader social-network or collaboration-suite behavior

## 4. Users and roles

Primary user roles:

- **Guest / visitor**: can access sign-in and registration flows
- **Registered user**: can join rooms, manage contacts, send messages, upload attachments, and manage sessions
- **Room admin**: can moderate messages and members within a room
- **Room owner**: has all admin permissions plus ownership-protected room control

Optional role if the XMPP/Jabber extension is implemented:

- **Platform admin for XMPP/Jabber extension**: can access XMPP-specific monitoring and federation screens

## 5. Core product scope

Core scope includes:

- self-registration and authentication
- persistent login and active session management
- password reset and password change
- account deletion
- online, AFK, and offline presence
- multi-tab presence behavior
- friend requests and friend list management
- user-to-user bans
- public room discovery and private room invitations
- room membership, moderation, and ban management
- room messaging and direct messaging
- replies, edits, deletions, and persistent history
- file and image attachments
- unread indicators
- classic chat UI layout and moderation dialogs

## 6. Deferred or optional capabilities

The following capability is optional and not required for the core product:

- XMPP/Jabber connectivity, federation, and related admin screens

## 7. Functional requirements

### 7.1 Identity and account management

#### 7.1.1 Registration

The system shall support self-registration using:

- email
- password
- unique username

#### 7.1.2 Registration rules

- Email must be unique.
- Username must be unique.
- Username is immutable after registration.
- Email verification is not required.

#### 7.1.3 Authentication

The system shall support:

- sign in with email and password
- sign out from the current browser session only
- persistent login across browser close and reopen

#### 7.1.4 Password management

The system shall support:

- password reset
- password change for authenticated users

Passwords must be stored securely in hashed form.

#### 7.1.5 Account deletion

The system shall provide a delete-account action.

If a user deletes their account:

- the account is removed
- chat rooms owned by that user are deleted
- all messages, files, and images in those deleted rooms are deleted permanently
- membership in other rooms is removed

### 7.2 Sessions, presence, and activity model

#### 7.2.1 Active sessions

Users shall be able to view a list of active sessions, including browser and IP details, and revoke selected sessions.

Logging out from the current browser invalidates only that browser session. Other active sessions remain valid until explicitly revoked or expired.

#### 7.2.2 Presence states

The system shall expose three presence states:

- online
- AFK
- offline

#### 7.2.3 Presence semantics

- A user is **online** if at least one live tab/session has recent activity.
- A user is **AFK** if tabs remain connected but no live tab has recent activity for more than one minute.
- A user is **offline** only when all tabs/sessions are disconnected or stale beyond the server-side liveness timeout.

#### 7.2.4 Activity signaling

Presence shall be derived from recent interaction signals and connection liveness, not from database polling.

Valid activity signals may include:

- pointer movement
- keyboard input
- scrolling
- window focus changes
- message composition activity
- explicit client activity heartbeat during ongoing interaction

Clients should debounce activity heartbeats and avoid excessive traffic.

#### 7.2.5 Browser tab hibernation

The system must not depend on clients sending an explicit inactive signal. Browsers may hibernate inactive tabs and suspend JavaScript execution. Server-side presence logic must therefore rely on recent activity timestamps plus connection liveness and stale-connection detection, not on reliable close or inactive events.

#### 7.2.6 No inactivity logout

The system shall not automatically log users out due to inactivity.

### 7.3 Contacts, friendship, and user blocking

#### 7.3.1 Friends

Each user shall have a personal friend list.

#### 7.3.2 Friend requests

A user shall be able to send a friend request:

- by username
- from the user list in a chat room

A friend request may include optional text.

#### 7.3.3 Friendship confirmation

Friendship requires recipient confirmation.

#### 7.3.4 Removing friends

A user may remove another user from their friend list.

#### 7.3.5 User-to-user ban

A user may ban another user.

Ban effects:

- the banned user cannot contact the user who banned them in any way
- new direct messaging between them is blocked
- existing direct message history remains visible but becomes read-only
- the friendship relationship is effectively terminated

#### 7.3.6 Direct messaging eligibility

Direct messaging is allowed only if:

- both users are friends
- neither user has banned the other

### 7.4 Room lifecycle and discovery

#### 7.4.1 Room creation

Any registered user may create a chat room.

#### 7.4.2 Room properties

A room shall have:

- name
- description
- visibility: public or private
- owner
- admins
- members
- banned users list

Room names must be globally unique across the system, including both public and private rooms.

#### 7.4.3 Public rooms

The system shall provide a catalog of public chat rooms showing:

- room name
- description
- current number of members

The catalog shall support simple search.

Public rooms can be joined freely by any authenticated user unless banned.

#### 7.4.4 Private rooms

Private rooms are not visible in the public catalog.

Users may join a private room only by invitation.

Invitations may be sent only to already registered users.

#### 7.4.5 Joining and leaving rooms

- Users may freely join public rooms unless banned.
- Users may leave rooms freely.
- The owner cannot leave their own room.
- The owner may only delete the room.

#### 7.4.6 Room deletion

If a room is deleted:

- all messages in the room are deleted permanently
- all files and images in the room are deleted permanently

### 7.5 Room moderation and administration

#### 7.5.1 Roles

Each room has exactly one owner.

The owner is always an admin and cannot lose admin privileges.

#### 7.5.2 Admin permissions

Admins may:

- delete messages in the room
- remove members from the room
- ban members from the room
- view the list of banned users
- view who banned each banned user
- remove users from the ban list
- remove admin status from other admins except the owner

#### 7.5.3 Owner permissions

The owner may:

- perform all admin actions
- remove any admin
- remove any member
- delete the room

#### 7.5.4 Removal as ban

If a user is removed from a room by an admin, the removal is treated as a ban:

- the user is removed from the room
- the user cannot rejoin unless explicitly unbanned

#### 7.5.5 Loss of access

If a user loses access to a room:

- room messages become inaccessible through the UI
- room files and images become inaccessible
- stored files remain retained unless the room itself is deleted

### 7.6 Invitations

Users may invite other registered users to private rooms.

Invitation flow:

- inviter selects a registered username
- recipient receives a notification
- recipient can accept or reject the invitation
- acceptance adds the recipient to the room
- rejection leaves room membership unchanged

### 7.7 Messaging

#### 7.7.1 Chat model

Room chats and direct chats shall behave the same way from the UI and feature perspective, except:

- direct chats always have exactly two participants
- direct chats do not have owner/admin roles
- room-only moderation permissions do not apply to direct chats

#### 7.7.2 Message content

Messages shall support:

- plain text
- multiline text
- UTF-8 text
- emoji
- attachments
- reply/reference to another message

Maximum text size per message: 3 KB.

#### 7.7.3 Replies

Users may reply to another message. The replied-to message must be visually quoted, outlined, or otherwise referenced in the UI.

#### 7.7.4 Editing

Users may edit their own messages. Edited messages must display an edited indicator.

#### 7.7.5 Deletion

Messages may be deleted:

- by the message author
- by room admins in room chats

Deleted messages are not required to be recoverable.

#### 7.7.6 Ordering and persistence

Messages shall be stored persistently and displayed in chronological order.

Users shall be able to scroll through very old history using infinite scroll.

Messages sent to offline users are persisted and become available when the recipient next opens the application.

### 7.8 Attachments

#### 7.8.1 Supported attachment types

Users shall be able to send:

- images
- arbitrary file types

#### 7.8.2 Upload methods

Attachments may be added by:

- explicit upload button
- copy and paste

#### 7.8.3 Metadata

The system shall preserve the original file name.

Users may add an optional comment to an attachment.

#### 7.8.4 Access control

Files and images may be downloaded only by current authorized participants of the chat.

If a user loses access to a room:

- the file remains stored
- the user can no longer see, download, or manage it

#### 7.8.5 Limits

- Maximum file size: 20 MB
- Maximum image size: 3 MB

### 7.9 Unread state and notifications

#### 7.9.1 Unread indicators

Unread indicators shall appear next to:

- room names
- direct contacts

#### 7.9.2 Clearing rule

Opening a chat clears unread state for that chat for the current user.

#### 7.9.3 Presence update speed

Presence updates should appear with low latency.

### 7.10 UI and navigation

The application shall provide a classic web chat layout with:

- top menu
- message area in the center
- message input at the bottom
- rooms and contacts list on the side

Additional UI requirements:

- room/contact list compacts after entering a room
- room members and their statuses are shown in a right-side context panel
- automatic scrolling to new messages occurs only when the user is already at the bottom
- forced autoscroll must not occur when the user is reading older messages
- older history loads through infinite scroll
- moderation actions are exposed through menus and modal dialogs

## 8. Realtime delivery and synchronization requirements

### 8.1 Hybrid transport model

The system shall use a hybrid communication model:

- HTTP APIs for authentication, discovery, settings, history retrieval, pagination, uploads, downloads, and administrative commands
- WebSockets for low-latency message delivery, presence updates, invitation updates, moderation events, unread-state propagation, membership changes, and session invalidation propagation

The system must not rely on REST polling for moderate-scale message update delivery.

The system must not use WebSockets as the sole source of authoritative state. Authoritative reads and reconciliation must remain available through HTTP APIs.

### 8.2 Durable history versus transient delivery

The system shall distinguish between:

- **durable history**, stored persistently and queryable by clients
- **transient delivery state**, used only to accelerate live delivery to currently connected clients

Any internal delivery queue, retry queue, or connection buffer must be bounded and garbage-collected.

The system must not retain unbounded transient delivery backlog for indefinitely inactive users.

Users who reconnect after a long absence must recover missed data through persisted history, not through infinite in-memory delivery queues.

### 8.3 Chat-local sequence numbers and watermarks

Each chat shall maintain a monotonically increasing persisted sequence number or watermark for messages.

Requirements:

- every persisted message in a chat receives the next incremental chat-local sequence number
- clients track the highest contiguous sequence number they have confirmed for each chat
- realtime delivery is treated as an acceleration layer over durable history
- if a client detects a gap between expected and received sequence numbers, it must requery authoritative history for reconciliation
- duplicate or out-of-order realtime events must not result in duplicate rendered messages

### 8.4 Reconnect and reconciliation

On reconnect, the client must:

- re-establish relevant realtime subscriptions
- reconcile latest chat watermark with server state
- fetch missing history for any detected gaps
- reconcile unread state and latest visible messages before marking the chat synchronized

## 9. Non-functional requirements

### 9.1 Capacity and scale

The system shall support:

- up to 300 simultaneously connected users
- up to 1000 participants in a single room
- unlimited rooms per user

Typical sizing assumptions:

- around 20 rooms per user
- around 50 contacts per user

### 9.2 Performance

The system should:

- deliver messages within 3 seconds after send
- propagate online status updates with latency below 2 seconds
- remain usable in rooms with at least 10,000 messages of history

### 9.3 Persistence

- Messages must be persistently stored and remain available for years.
- Older history must be retrievable incrementally through infinite scroll.
- Persistent data must survive process restarts when storage volumes are preserved.

### 9.4 Reliability and consistency

The system must preserve consistency of:

- room membership
- room bans
- user-to-user blocking
- file access rights
- message history
- admin and owner permissions
- active session revocation

### 9.5 Realtime resiliency

The system must treat realtime delivery as an acceleration layer over a durable history model, not as the sole source of truth.

## 10. Runtime and deployment constraints

### 10.1 Local runtime model

The system must run fully in a local Docker Compose environment from the repository root.

### 10.2 Dependency model

The system must not require external hosted services for core chat functionality.

### 10.3 Storage model

- Attachments must be stored on the local filesystem.
- Persistent application data must be mountable to local volumes.
- Local runtime behavior must preserve history and attachments across restarts when persistent volumes are retained.

### 10.4 Operational simplicity

The preferred system topology for the core product is a self-contained service set suitable for local deployment, predictable startup, and moderate-scale operation.

## 11. Explicit business rules and state transitions

### 11.1 Presence state boundaries

- recent activity in any live tab/session => online
- no recent activity for more than one minute, but at least one live tab/session remains => AFK
- no live tabs/sessions, or all live connections stale beyond timeout => offline

### 11.2 Friendship state boundaries

- no relationship
- pending outbound request
- pending inbound request
- friends
- blocked by one side
- mutually blocked

Blocked states override friendship and direct-message eligibility.

### 11.3 Room membership state boundaries

- not a member
- invited
- member
- admin
- owner
- banned

Ban overrides member and invitation state.

Owner is unique per room.

### 11.4 Attachment access rule

Attachment visibility depends on current chat authorization, not uploader identity.

A user who uploaded a file but later lost room access loses access to that file.

### 11.5 Direct-chat rule

Direct chats are allowed only between friends who are not blocked by either side.

Historical direct chats remain visible but read-only after a user-to-user ban.

## 12. Chosen default product decisions

The source material leaves some behavior unspecified. To prevent implementation drift, use these defaults unless explicitly changed later.

### 12.1 Direct chat creation

A direct chat thread is created on the first successful message between eligible users.

### 12.2 Account deletion attribution in surviving rooms

If a deleted user authored messages in rooms they did not own, those messages remain in history and are shown as authored by a deleted-account placeholder.

### 12.3 Room visibility changes

Owners may change room visibility between public and private.

- Existing members remain members.
- Public-to-private removes the room from public discovery.
- Private-to-public makes the room discoverable in the public catalog.
- Existing invitations remain valid unless explicitly revoked.

### 12.4 Password reset implementation for local deployment

For local deployment, password reset should use a token-based reset flow exposed through a local mail sink or equivalent local developer-visible mechanism.

### 12.5 Name normalization and uniqueness

Usernames and room names are compared for uniqueness using a canonical form that:

- trims leading and trailing whitespace
- normalizes Unicode to NFC
- collapses internal whitespace runs to a single space
- compares case-insensitively

The product should preserve a display form, but UI validation should prevent names that normalize to a conflicting canonical form.

### 12.6 Session transport and CSRF posture

The system uses server-managed revocable sessions carried by cookie-based authentication.

State-changing HTTP endpoints must enforce CSRF protection and origin checking. WebSocket handshakes must authenticate against the same session and validate allowed origin.

### 12.7 Unread semantics

Opening a chat clears unread only after the client has successfully synchronized that chat to the current server head and the server acknowledges the read-state advancement.

The server-side read state is authoritative across tabs. If one tab clears unread, all other tabs for that user update to match.

### 12.8 Friendship removal effect on direct chat

Removing a friend without blocking ends the friendship immediately and disables new direct messaging.

If a direct chat already exists, its history remains visible but becomes read-only until friendship is re-established and no block exists.

### 12.9 Attachment file-type and filename policy

The core product imposes no file-type restriction beyond the explicit size limits.

The original filename is preserved in metadata and UI. The storage path must never trust that filename. Files are stored under server-generated identifiers, and any filename used in download headers must be sanitized to remove control characters, null bytes, and path separators.

## 13. Optional XMPP/Jabber extension

If implemented, the system may add:

- XMPP/Jabber client connectivity
- federation between servers
- admin UI for connection dashboard
- federation traffic information and statistics
- optional federation load testing across two servers

This extension is outside the core product scope.
