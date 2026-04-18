# State Model
## Online Chat Server

## 1. Purpose

This document defines the explicit state machines and transitions that control the system. It exists because the product is dominated by stateful rules: presence, sessions, friendship, blocks, room membership, room bans, invitations, message visibility, unread state, and file access.

Unless noted otherwise, transitions are server-authoritative.

## 2. Modeling conventions

- **State**: stable condition of an entity or relationship
- **Trigger**: event or command that attempts to change state
- **Guard**: condition that must be true for the transition to be allowed
- **Side effect**: additional work required by the transition
- **Terminal state**: no further business transitions expected for that record

## 3. Session state

### 3.1 Purpose

Session state tracks authenticated browser/device access. It is distinct from socket connection state and distinct from user presence.

### 3.2 States

- `created`
- `active`
- `revoked`
- `expired`

### 3.3 State meanings

- **created**: session record exists but has not yet completed first authenticated use
- **active**: session may authenticate API and WebSocket requests
- **revoked**: session was explicitly invalidated
- **expired**: session aged out according to server policy

### 3.4 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| none | successful login | credentials valid | created | session record inserted |
| created | first authenticated request or websocket connect | session not revoked | active | last_seen updated |
| active | explicit logout from current browser | session matches current browser | revoked | cookie invalidated, websocket disconnected |
| active | revoke selected session | requester owns session | revoked | live websocket for that session disconnected |
| active | server expiry policy | session idle or aged beyond policy | expired | reject future use |
| created | server expiry policy | session unused or aged beyond policy | expired | reject future use |

### 3.5 Invariants

- revoked or expired sessions may not authenticate further requests
- logout from one browser must not revoke other active sessions
- active-session listing only includes non-revoked, non-expired sessions

## 4. Tab connection state

### 4.1 Purpose

Tracks the lifecycle of one browser tab's live socket connection.

### 4.2 States

- `connecting`
- `connected`
- `stale`
- `disconnected`

### 4.3 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| none | websocket connect attempt | session valid | connecting | provisional connection record |
| connecting | handshake success | auth accepted | connected | subscribe channels |
| connected | missed heartbeats beyond stale threshold | none | stale | suppress as live connection |
| stale | reconnect from same tab identity | session valid | connected | refresh last_seen, rebuild subscriptions |
| connected | graceful close | none | disconnected | clean up socket mapping |
| stale | cleanup worker | none | disconnected | remove stale mapping |
| connected | session revoked | matching session | disconnected | server closes socket |

### 4.4 Invariants

- stale connections do not count as live for presence
- disconnected connections do not receive fan-out
- tab identity is optional; if not implemented, reconnect creates a new connection record

## 5. Presence state

### 5.1 Purpose

Presence is an aggregate user state derived from:
- live non-stale connections
- recent interaction timestamps across tabs

### 5.2 States

- `online`
- `afk`
- `offline`

### 5.3 Input signals

- pointer movement
- keyboard input
- scroll activity
- focus regained
- message composition activity
- message send
- attachment interaction
- socket heartbeat
- connection stale timeout

### 5.4 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| offline | first live connection with recent activity | none | online | publish presence.updated |
| offline | first live connection without recent activity window | none | afk | publish presence.updated |
| online | no recent activity for all live tabs > AFK window | at least one live connection remains | afk | publish presence.updated |
| afk | activity observed on any live tab | none | online | publish presence.updated |
| online | all tabs disconnected or stale | none | offline | publish presence.updated |
| afk | all tabs disconnected or stale | none | offline | publish presence.updated |

### 5.5 Invariants

- presence is computed per user, not per session
- if any live tab is active, user is online
- AFK only applies when all live tabs have no recent activity
- offline only applies when no live non-stale tab remains

## 6. Friendship state

### 6.1 Purpose

Tracks the relationship required for direct messaging.

### 6.2 States

Represent friendship as an ordered pair state from the perspective of the user pair:

- `none`
- `pending_ab`
- `pending_ba`
- `friends`

Blocking is modeled separately and overrides friendship behavior.

### 6.3 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| none | A sends friend request to B | neither user blocked by the other | pending_ab | create friend request |
| none | B sends friend request to A | neither user blocked by the other | pending_ba | create friend request |
| pending_ab | B accepts | request open | friends | create friendship, close request |
| pending_ba | A accepts | request open | friends | create friendship, close request |
| pending_ab | B rejects | request open | none | close request |
| pending_ba | A rejects | request open | none | close request |
| friends | A removes B | none | none | delete or inactivate friendship |
| friends | B removes A | none | none | delete or inactivate friendship |
| pending_ab | A cancels request | request open | none | close request |
| pending_ba | B cancels request | request open | none | close request |

### 6.4 Invariants

- at most one open friend request may exist per user pair
- friendship is symmetric
- if a block exists in either direction, new friendship requests may not be created

## 7. User block state

### 7.1 Purpose

Tracks user-to-user bans that override friendship and DM behavior.

### 7.2 States

For a user pair, effective block state is one of:

- `unblocked`
- `blocked_by_a`
- `blocked_by_b`
- `blocked_both`

### 7.3 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| unblocked | A blocks B | none | blocked_by_a | disable new DMs, freeze existing DM read/write |
| unblocked | B blocks A | none | blocked_by_b | disable new DMs, freeze existing DM read/write |
| blocked_by_a | B blocks A | none | blocked_both | same |
| blocked_by_b | A blocks B | none | blocked_both | same |
| blocked_by_a | A unblocks B | none | unblocked | DM remains disabled unless friendship still exists or is recreated |
| blocked_by_b | B unblocks A | none | unblocked | same |
| blocked_both | A unblocks B | none | blocked_by_b | same |
| blocked_both | B unblocks A | none | blocked_by_a | same |

### 7.4 Invariants

- any non-unblocked state prohibits new direct messaging
- existing direct chat history remains visible but read-only in any blocked state
- friendship behavior is effectively terminated while any block exists

## 8. Direct chat lifecycle state

### 8.1 Purpose

Tracks existence and mutability of a direct chat.

### 8.2 States

- `not_created`
- `active`
- `frozen`

### 8.3 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| not_created | first successful DM send | users are friends and unblocked | active | create direct chat and membership rows |
| active | user block introduced by either side | existing chat exists | frozen | reject new messages, keep history visible |
| active | friendship removed by either side | existing chat exists | frozen | reject new messages, keep history visible |
| frozen | all blocks removed and friendship restored or recreated | friendship exists and neither side is blocked | active | re-enable existing chat for writing |
| active | chat history retained indefinitely | none | active | no automatic deletion |
| frozen | chat history retained indefinitely | none | frozen | no automatic deletion |

### 8.4 Invariants

- direct chat always has exactly two participants
- direct chat has no owner/admin role
- direct chat cannot exist for non-friends unless created historically and later frozen
- a frozen direct chat may result from either user-to-user block or friendship removal

## 9. Room state

### 9.1 States

- `active_public`
- `active_private`
- `deleted`

### 9.2 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| none | create public room | room name unique | active_public | create room, owner membership |
| none | create private room | room name unique | active_private | create room, owner membership |
| active_public | owner changes visibility to private | allowed by policy | active_private | remove from catalog |
| active_private | owner changes visibility to public | allowed by policy | active_public | add to catalog |
| active_public | owner deletes room | requester is owner | deleted | cascade room messages/files deletion |
| active_private | owner deletes room | requester is owner | deleted | cascade room messages/files deletion |

### 9.3 Invariants

- owner is unique per room
- owner cannot leave own room
- deleted rooms are inaccessible
- room name uniqueness spans both public and private rooms

## 10. Room membership state

### 10.1 States

Per `(room_id, user_id)` effective membership state:

- `not_member`
- `invited`
- `member`
- `admin`
- `owner`
- `banned`

### 10.2 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| not_member | invite sent | room private, invitee registered, invitee not banned | invited | create invitation |
| invited | invitation accepted | invitation open | member | create membership, close invitation |
| invited | invitation rejected | invitation open | not_member | close invitation |
| not_member | join public room | room public, user not banned | member | create membership |
| member | owner makes admin | requester owner or eligible admin policy | admin | role elevated |
| admin | owner removes admin | requester owner | member | role lowered |
| member | admin or owner removes member | requester authorized | banned | delete membership, create room ban |
| admin | owner removes admin from room | requester owner | banned | delete membership, create room ban |
| member | user leaves room | user not owner | not_member | delete membership |
| admin | user leaves room | user not owner | not_member | delete membership |
| banned | authorized unban | requester authorized | not_member | remove room ban |
| owner | delete room | requester owner | n/a | room deleted, all memberships removed |

### 10.3 Invariants

- owner role is unique
- owner is always admin-equivalent and cannot lose admin privileges
- admin removal by non-owner cannot target owner
- removal by admin is treated as a ban
- banned users cannot join until unbanned

## 11. Invitation state

### 11.1 States

- `open`
- `accepted`
- `rejected`
- `revoked`
- `expired`

### 11.2 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| none | invite created | room private, invitee registered, invitee not banned | open | notify invitee |
| open | invitee accepts | invitation valid | accepted | create membership |
| open | invitee rejects | invitation valid | rejected | none |
| open | inviter or admin revokes | authorized | revoked | none |
| open | expiry policy | invitation too old | expired | none |

### 11.3 Invariants

- accepted invitations may not be accepted again
- invitation validity must be checked against current room ban status at accept time
- multiple open invites for same user and room should be prevented

## 12. Room ban state

### 12.1 States

Per `(room_id, user_id)`:

- `not_banned`
- `banned`

### 12.2 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| not_banned | admin or owner bans user | requester authorized | banned | remove membership if present |
| not_banned | admin removes user from room | requester authorized | banned | same as ban |
| banned | authorized unban | requester authorized | not_banned | user may rejoin or be reinvited |

### 12.3 Invariants

- room ban overrides invite and join eligibility
- room ban must be checked for public join, private invitation accept, and attachment access

## 13. Message lifecycle state

### 13.1 States

For a message record:

- `persisted`
- `edited`
- `deleted`

### 13.2 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| none | create message | sender authorized, size valid | persisted | assign sequence, update unread |
| persisted | author edits own message | edit allowed by policy | edited | store updated content, emit event |
| edited | author edits again | edit allowed by policy | edited | store updated content, emit event |
| persisted | author deletes own message | allowed | deleted | hide content from normal display |
| persisted | room admin deletes room message | room chat, requester authorized | deleted | same |
| edited | delete | allowed | deleted | same |

### 13.3 Invariants

- sequence number is assigned once at create time and never changes
- deleted messages are not required to be user-recoverable
- author-admin moderation rules differ between room chats and direct chats

## 14. Attachment lifecycle state

### 14.1 States

For an attachment record:

- `uploaded`
- `linked`
- `inaccessible_to_user`
- `deleted`

### 14.2 Notes

`inaccessible_to_user` is an effective access state, not necessarily a globally stored attachment state. The file may still exist, but be inaccessible to a specific user.

### 14.3 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| none | upload start | requester authorized | uploaded | temp file or staged binary created |
| uploaded | message or attachment metadata committed | transaction success | linked | attachment visible in chat |
| linked | user loses room access | attachment remains stored | inaccessible_to_user | deny future access to that user |
| linked | room deleted | none | deleted | binary removed, metadata removed |
| inaccessible_to_user | room deleted | none | deleted | binary removed, metadata removed |

### 14.4 Invariants

- attachment existence does not imply current visibility
- access is always checked against current authorization
- uploader identity alone never guarantees access

## 15. Read state / unread state

### 15.1 States

For each `(user_id, chat_id)`:

- `never_opened`
- `has_read_upto_n`
- `stale_local_cache` (client-only effective state)
- `fully_synced_to_n`

### 15.2 Stored representation

Server stores at minimum:
- `last_read_sequence`
- timestamps as needed

### 15.3 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| never_opened | first open chat | authorized | has_read_upto_n | set `last_read_sequence` |
| has_read_upto_n | new message sequence > n | none | has_read_upto_n | unread now exists implicitly |
| has_read_upto_n | open chat at current head m | m >= n | has_read_upto_m | unread cleared |
| has_read_upto_n | reconnect with stale local cache | none | stale_local_cache | client re-fetch required |
| stale_local_cache | reconciliation complete | none | fully_synced_to_n | local indicators corrected |
| fully_synced_to_n | new message > n | none | has_read_upto_n | unread appears again |

### 15.4 Invariants

- unread is derived from latest chat sequence > `last_read_sequence`
- server-side read state is authoritative across tabs and sessions
- opening a chat advances read state only after successful synchronization and server acknowledgement

## 16. Password reset token state

### 16.1 States

- `issued`
- `consumed`
- `expired`
- `revoked`

### 16.2 Transitions

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| none | reset requested | account exists per chosen product policy | issued | token stored |
| issued | reset confirmed | token valid | consumed | password changed |
| issued | expiry time reached | none | expired | reject use |
| issued | superseding token issued or admin action | none | revoked | reject use |

### 16.3 Invariants

- token is one-time use
- consumed, expired, or revoked tokens may not be reused

## 17. Cross-state rules

### 17.1 Session vs presence

- session may be active while presence is offline
- presence offline does not imply session revocation
- session revocation forces connection teardown for that session

### 17.2 Block vs friendship

- any block state overrides friendship for DM eligibility
- unblocking does not automatically recreate friendship unless product explicitly chooses that behavior

### 17.3 Ban vs membership

- room ban overrides invitation and join eligibility
- room ban may coexist with no active membership row

### 17.4 Room access vs attachment access

- if room access is lost, attachment access is lost immediately
- file may remain stored while inaccessible

### 17.5 Realtime vs durable history

- realtime events may be delayed, duplicated, or missed
- durable history plus sequence reconciliation is authoritative

## 18. Recommended server timers and thresholds

These are implementation defaults, not product requirements:

- websocket heartbeat interval: 15s
- stale socket threshold: 45s
- AFK threshold: 60s
- invitation expiry: choose and document if implemented
- password reset token expiry: choose and document if implemented

## 19. Testing focus implied by this state model

High-priority transition tests:

1. multi-tab online -> afk -> online -> offline
2. selective session revocation
3. friend request accept / reject / remove
4. block after direct chat exists
5. remove from room -> banned
6. unban then rejoin
7. unread reconciliation across multiple tabs
8. reconnect with missing message sequence
9. room deletion cascading message and file deletion
10. attachment access loss after room removal
