# Permissions Matrix
## Online Chat Server

## 1. Purpose

This document defines who may perform which action under which conditions. It exists to remove ambiguity at handoff time. Where the source requirements are explicit, the matrix treats those rules as fixed. Where behavior depends on product decisions already captured in the PRD, the matrix reflects those defaults. If any row changes later, update this file and the PRD together.

## 2. Conventions

### 2.1 Actors

- **Guest**: unauthenticated visitor
- **User**: authenticated registered user
- **Member**: user who belongs to a room
- **Admin**: room admin who is not the owner
- **Owner**: room owner
- **Blocked pair**: two users where one or both have applied a user-to-user ban
- **Banned room user**: user banned from a room

### 2.2 Decision markers

- **Yes**: allowed without extra approval, assuming normal validation succeeds
- **No**: not allowed
- **Conditional**: allowed only if the stated condition is true
- **N/A**: not applicable

## 3. Identity, auth, and sessions

| Action | Guest | User | Notes |
|---|---|---|---|
| Register account | Yes | No | Only when not already authenticated. |
| Sign in | Yes | No | Authenticated users should use session switching or logout. |
| Sign out current session | No | Yes | Logs out current browser session only. |
| View active sessions | No | Yes | Only own sessions. |
| Revoke another active session of self | No | Yes | Must belong to requesting user. |
| Revoke current session from sessions screen | No | Yes | Equivalent to logout for current browser. |
| View another user's sessions | No | No | Never allowed. |
| Change password | No | Yes | Requires valid current session. |
| Request password reset | Yes | Yes | If already authenticated, still allowed but rarely surfaced in UI. |
| Delete own account | No | Yes | Requires confirmation. |
| Delete another user's account | No | No | Out of scope. |

## 4. Presence and contacts

| Action | Guest | User | Notes |
|---|---|---|---|
| View own presence state | No | Yes | Usually implicit in profile/session UI. |
| View presence of friend | No | Yes | Allowed. |
| View presence of room member | No | Conditional | Allowed when user currently has access to that room. |
| View presence of non-friend and non-room-member | No | No | No general people directory is required. |
| View own friend list | No | Yes | Only own list. |
| View another user's friend list | No | No | Not required. |
| Send friend request by username | No | Yes | Conditional on target existing and pair not blocked. |
| Send friend request from room member list | No | Yes | Conditional on current access to that room and pair not blocked. |
| Accept friend request | No | Yes | Must be recipient of that request. |
| Reject friend request | No | Yes | Must be recipient of that request. |
| Cancel outbound friend request | No | Yes | Must be sender of still-open request. |
| Remove friend | No | Yes | Must be one of the two friends. Symmetric effect. |
| Block another user | No | Yes | Allowed against any registered user. |
| Unblock another user | No | Yes | Only the blocking side may remove its own block. |

## 5. Direct chat eligibility and direct-message actions

| Action | Guest | User | Notes |
|---|---|---|---|
| See direct chat list | No | Yes | Only direct chats user participates in. |
| Create direct chat by sending first message | No | Conditional | Allowed only if users are friends and neither side has blocked the other. |
| Send message in existing direct chat | No | Conditional | Allowed only when friendship exists and neither side has blocked the other. |
| Read history of active direct chat | No | Conditional | Allowed to the two participants. |
| Read history of frozen direct chat | No | Conditional | Allowed to the two participants even after user-to-user block. |
| Edit own message in direct chat | No | Conditional | Allowed only while chat is active and user still has write permission. |
| Delete own message in direct chat | No | Conditional | Allowed only while user still has access to that direct chat UI. |
| Delete another user's message in direct chat | No | No | No admin role in direct chats. |
| Upload attachment in direct chat | No | Conditional | Same eligibility as sending a message. |
| Download attachment from direct chat | No | Conditional | Allowed to currently authorized participants only. |

### 5.1 Direct chat permission notes

- A user-to-user block immediately disables new direct messaging in both directions.
- Existing direct message history remains visible but becomes read-only.
- Removing a friendship without blocking also disables new direct messages and freezes any existing direct chat until friendship is re-established and neither side is blocked.

## 6. Room lifecycle and discovery

| Action | Guest | User | Member | Admin | Owner | Notes |
|---|---|---|---|---|---|---|
| View public room catalog | No | Yes | Yes | Yes | Yes | Catalog is for authenticated users. |
| Search public room catalog | No | Yes | Yes | Yes | Yes | Same as above. |
| View private room in public catalog | No | No | No | No | No | Private rooms are hidden. |
| Create room | No | Yes | Yes | Yes | Yes | Any authenticated user may create a room. |
| Join public room | No | Yes | N/A | N/A | N/A | Conditional on not being banned from that room. |
| Join private room without invitation | No | No | N/A | N/A | N/A | Never allowed. |
| Accept private-room invitation | No | Yes | N/A | N/A | N/A | Must be invited user and not banned from that room. |
| Reject private-room invitation | No | Yes | N/A | N/A | N/A | Must be invited user. |
| Leave room | No | N/A | Yes | Yes | No | Owner cannot leave; owner must delete room. |
| View room details | No | Conditional | Yes | Yes | Yes | Public-room metadata may be visible through catalog; full room details require room access. |
| Change room name | No | No | No | No | Yes | Must preserve global uniqueness. |
| Change room description | No | No | No | No | Yes | Owner-only by default. |
| Change room visibility | No | No | No | No | Yes | Allowed between public and private. |
| Delete room | No | No | No | No | Yes | Deletes room messages and attachments permanently. |

## 7. Room invitations

| Action | Guest | User | Member | Admin | Owner | Notes |
|---|---|---|---|---|---|---|
| Invite registered user to private room | No | No | No | No | Yes | Chosen default: owner controls invitations unless later expanded. |
| View outstanding invitations for room | No | No | No | Conditional | Yes | Admin visibility is optional; owner visibility required. |
| Revoke pending invitation | No | No | No | No | Yes | Chosen default: owner-only. |
| Invite user to public room | No | No | No | No | No | Unnecessary because public rooms are freely joinable. |

### 7.1 Invitation notes

- Invitations are only for already registered users.
- Invitation acceptance adds membership.
- Invitation rejection leaves room membership unchanged.
- If the invitee becomes banned before accepting, the invitation becomes unusable.

## 8. Room moderation and roles

| Action | Guest | User | Member | Admin | Owner | Notes |
|---|---|---|---|---|---|---|
| View room member list | No | No | Yes | Yes | Yes | Requires current room access. |
| View room banned-user list | No | No | No | Yes | Yes | Explicit requirement for admins. |
| View who banned each banned user | No | No | No | Yes | Yes | Explicit requirement for admins. |
| Promote member to admin | No | No | No | Yes | Yes | PO decision (2026-04-18): admins may promote other members to admin. Rationale: lets room owners delegate growth without bottlenecking on the owner. |
| Demote admin (remove admin status from non-owner admin) | No | No | No | Yes | Yes | Admin may demote other admins except owner; owner may demote any admin. |
| Remove owner admin status | No | No | No | No | No | Never allowed. |
| Transfer room ownership | No | No | No | No | Yes | Owner-only. Not required for MVP; out of scope unless re-opened. |
| Remove member from room | No | No | No | Yes | Yes | Removal is treated as a ban. |
| Ban member from room | No | No | No | Yes | Yes | Allowed to admins and owner. |
| Unban user from room | No | No | No | Yes | Yes | Allowed to admins and owner. |
| Remove another admin from room entirely | No | No | No | Conditional | Yes | Admin may remove other admins except owner, per requirement. |
| Remove owner from room | No | No | No | No | No | Never allowed. |
| Manage room settings | No | No | No | No | Yes | Chosen default: owner-only. |

### 8.1 Moderation notes

- Any administrative removal from a room is equivalent to banning that user from that room.
- Banned users cannot rejoin until explicitly unbanned.
- Users who lose room access lose access to room messages and room files/images in the UI.

## 9. Messaging in rooms

| Action | Guest | User | Member | Admin | Owner | Notes |
|---|---|---|---|---|---|---|
| View room message history | No | No | Yes | Yes | Yes | Requires current room access. |
| Send room message | No | No | Yes | Yes | Yes | Must currently be a room participant. |
| Reply to room message | No | No | Yes | Yes | Yes | Same as sending. |
| Edit own room message | No | No | Yes | Yes | Yes | Allowed while user still has access to that room. |
| Delete own room message | No | No | Yes | Yes | Yes | Allowed while user still has access to that room. |
| Delete another user's room message | No | No | No | Yes | Yes | Admins and owner can moderate room messages. |
| View deleted-message placeholder | No | No | Yes | Yes | Yes | If deletion model preserves placeholder. |
| See message edited indicator | No | No | Yes | Yes | Yes | Always shown when applicable. |

## 10. Attachments

| Action | Guest | User | Member | Admin | Owner | Notes |
|---|---|---|---|---|---|---|
| Upload file/image to room | No | No | Yes | Yes | Yes | Requires current room access. |
| Upload file/image to direct chat | No | Conditional | N/A | N/A | N/A | Allowed only if DM is currently writable. |
| Download room attachment | No | No | Yes | Yes | Yes | Requires current room access at download time. |
| Download direct-chat attachment | No | Conditional | N/A | N/A | N/A | Only currently authorized direct-chat participants. |
| View original filename | No | No | Yes | Yes | Yes | Visible to current authorized participants. |
| Add optional comment to attachment | No | No | Yes | Yes | Yes | Same permissions as upload/send. |
| Access previously uploaded file after losing room access | No | No | No | No | No | Never allowed; uploader identity does not override access loss. |
| Delete attachment by deleting containing room | No | No | No | No | Yes | Room deletion cascades to attachment deletion. |

## 11. Unread state and notifications

| Action | Guest | User | Member | Admin | Owner | Notes |
|---|---|---|---|---|---|---|
| See unread indicator for direct chat | No | Yes | N/A | N/A | N/A | Only own indicators. |
| See unread indicator for room | No | No | Yes | Yes | Yes | Only own indicators. |
| Clear unread by opening chat | No | Conditional | Yes | Yes | Yes | Requires current access to the chat. |
| Clear another user's unread state | No | No | No | No | No | Never allowed. |

## 12. Information visibility matrix

| Information | Guest | User | Member | Admin | Owner | Notes |
|---|---|---|---|---|---|---|
| Public room names/descriptions/member counts | No | Yes | Yes | Yes | Yes | Through catalog. |
| Private room existence (not invited, not member) | No | No | No | No | No | Hidden. |
| Room member list | No | No | Yes | Yes | Yes | Requires current room access. |
| Room banned-user list | No | No | No | Yes | Yes | Restricted. |
| Who banned whom in room | No | No | No | Yes | Yes | Restricted. |
| Direct-chat history | No | Conditional | N/A | N/A | N/A | Only two participants. |
| Frozen direct-chat history after block | No | Conditional | N/A | N/A | N/A | Still visible to two participants. |
| Own active sessions with browser/IP details | No | Yes | Yes | Yes | Yes | Self only. |
| Another user's session details | No | No | No | No | No | Never allowed. |
| Presence of room members | No | No | Yes | Yes | Yes | Requires current room access. |
| Presence of direct-contact friend | No | Yes | N/A | N/A | N/A | Friend/contact views. |

## 13. Validation and enforcement rules

1. Authorization is always checked against **current** server state.
2. Upload/download authorization must not rely on uploader identity.
3. WebSocket subscription does not grant permission; it must reflect permission already granted by server state.
4. If a user loses access while actively viewing a room, the room view must become non-interactive and subsequent commands from that client must be rejected.
5. Hidden resources remain undiscoverable: private rooms stay hidden from non-members and non-invitees.
6. A blocked user cannot use friendship or direct messaging paths to contact the blocker.
7. Owner is unique per room and cannot be stripped of admin privileges.

## 14. Items intentionally fixed here as defaults

The source requirements do not explicitly define every actor for every management action. To avoid drift, this matrix fixes the following defaults unless later changed by product decision:

- private-room invitations are owner-controlled
- room settings are owner-controlled
- **admin promotion is admin-or-owner controlled (PO decision 2026-04-18)**
- admin demotion is admin-or-owner controlled (cannot target owner)
- invitation revocation is owner-controlled
- ownership transfer is owner-only and out of scope for MVP

If those defaults are changed later, update this document, the PRD, and the UX flow notes together.
