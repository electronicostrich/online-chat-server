# UX Flow Notes
## Online Chat Server

## 1. Purpose

This document defines the expected behavioral flow for screens and interactions that are easy to implement inconsistently. It is not a visual design spec. It exists to keep frontend behavior aligned with product rules and backend state transitions.

## 2. Global UX rules

1. The UI must reflect **current server authorization**, not optimistic assumptions about prior access.
2. The UI may be optimistic for responsiveness, but it must reconcile with authoritative server state.
3. Realtime updates should feel immediate, but the UI must recover cleanly from reconnects, duplicates, and missing events.
4. The product should feel like a classic chat client: simple navigation, clear lists, visible presence, and explicit room/member context.
5. Use modal dialogs for destructive administrative actions and settings changes that materially affect access.

## 3. Auth flows

### 3.1 Registration flow

1. Visitor opens register screen.
2. Visitor enters email, username, password, confirm password.
3. Client validates obvious input errors locally.
4. Server validates uniqueness and account rules.
5. On success, user is signed in or redirected to sign-in according to implementation choice.
6. On failure, field-level validation errors are shown inline.

### 3.2 Login flow

1. Visitor opens sign-in screen.
2. Visitor enters email and password.
3. On success, user lands in main application shell.
4. On failure, generic invalid-credentials error is shown.
5. Login persistence should survive browser restart according to session rules.

### 3.3 Password reset flow

1. User opens forgot-password screen.
2. User submits email.
3. System issues reset token through local reset-delivery mechanism.
4. User opens reset link/token flow.
5. User sets new password.
6. On success, user is able to sign in with new password.

## 4. Main application shell

### 4.1 Layout expectations

Main signed-in shell includes:
- top navigation/header
- left or right side navigation for rooms and contacts, depending on final implementation
- main chat pane
- composer at bottom of active chat
- member/context panel for room details and member statuses

The shell should make it obvious which chat is currently active.

### 4.2 Initial load behavior

On first load after sign-in or refresh:
1. load shell
2. fetch current user profile and session state
3. fetch room/contact summaries and unread indicators
4. establish websocket connection
5. reconcile latest state if server indicates missed activity

The UI should not show stale interactive room state before authorization completes.

## 5. Sessions screen

### 5.1 Content

Sessions screen should show:
- current session highlighted clearly
- other active sessions listed separately or distinguishably
- browser/device summary
- IP detail
- last seen information if available
- revoke action for revocable sessions

### 5.2 Interaction rules

- Revoking another session should require confirmation only if product chooses it; confirmation is recommended.
- Revoking current session should behave as logout.
- Revoked sessions should disappear from active-session list promptly.

## 6. Public room catalog flow

### 6.1 Catalog behavior

Catalog shows only public rooms and must include:
- room name
- description
- current number of members
- search/filter control

### 6.2 Join flow

1. User selects a public room.
2. If not banned, join succeeds and room opens.
3. If banned, join fails with clear error and no partial room view appears.

## 7. Private-room invitation flow

### 7.1 Send invitation

Chosen default behavior:
- invitation originates from room-management area, not from public catalog
- inviter searches by username among registered users
- invite action is available to room owner by default

After send:
- invitation should appear in room invitations list if that screen exists
- invitee receives notification/event

### 7.2 Receive invitation

Invitee should see:
- room name
- inviter identity if available
- accept action
- reject action

### 7.3 Accept invitation

On accept:
- user becomes room member
- room appears in room list
- room can open directly or remain in list depending on final UX choice

### 7.4 Reject invitation

On reject:
- invitation closes
- room is not added
- no other state changes occur

## 8. Room view flow

### 8.1 Enter room

When user enters a room, UI should:
- highlight active room
- display room title and description/context
- show message history in chronological order
- show member list and statuses in context panel
- show composer with attachment and reply affordances

### 8.2 Losing room access while viewing room

If room access is revoked while user is viewing the room:
- composer becomes disabled immediately
- any pending sends/edits/uploads are rejected if submitted after revocation
- room history view becomes non-interactive or user is redirected to a safe fallback state
- attachment download attempts fail

Do not leave the room appearing writable after server denial.

## 9. Room settings and moderation flows

### 9.1 Manage room dialog

Expected tabs or grouped sections:
- members
- admins
- banned users
- invitations
- settings

### 9.2 Members view

Should support:
- member search/filter if needed
- role visibility
- actions available according to actor permissions

Important rule: do not render forbidden actions that the current actor cannot perform.

### 9.3 Ban/unban flow

Ban flow should:
- identify target user clearly
- explain that remove-from-room is treated as ban where applicable
- require confirmation for destructive action

Unban flow should:
- remove the ban entry
- not automatically rejoin the user to the room

### 9.4 Admin management

- owner-only actions should be visually distinct
- owner cannot be demoted or removed via admin-management controls
- if admin can remove other admins, the owner row must still be locked/non-actionable

## 10. Direct-chat flow

### 10.1 Start direct conversation

Chosen default:
- direct chat is created on first successful message, not merely by opening an empty chat shell

The UI may allow a “message friend” action, but the actual chat record should only become durable after first successful send.

### 10.2 Frozen direct chat after block or friendship removal

When a block is applied to either participant, or when friendship is removed after a DM already exists:
- existing history stays visible
- composer is disabled or replaced with read-only notice
- UI should clearly indicate chat is no longer writable
- do not silently fail send attempts

## 11. Messaging behavior

### 11.1 Composer

Composer supports:
- multiline input
- emoji entry
- file/image attachment
- reply context when applicable
- send action

### 11.2 Reply UI

When replying:
- show the referenced message context above composer or in draft area
- allow user to cancel reply before sending
- sent message should visibly reference the original message in chat stream

### 11.3 Edit UI

When editing own message:
- transition message into editable state inline or via edit mode
- save action updates message
- edited indicator remains visible after save

### 11.4 Delete UI

Deletion should use confirmation where appropriate for destructive moderation actions.
For user self-delete, lightweight confirmation is recommended but not mandatory if the product prefers a quick action.

## 12. Autoscroll and history loading

### 12.1 Autoscroll

- If user is already at bottom and a new message arrives, keep them at bottom.
- If user has scrolled up, do not jump them to bottom.
- UI may show a “new messages” affordance when new messages arrive off-screen.

### 12.2 Infinite scroll

When older history is loaded:
- preserve current viewport position
- prepend older messages without jumping unexpectedly
- avoid duplicate rendering if overlapping pages or realtime events are merged

## 13. Unread indicators

### 13.1 Room and direct-chat lists

Unread indicators should appear near:
- room names
- direct-contact names / direct-chat entries

### 13.2 Clearing unread

Unread should clear when chat is opened successfully and server acknowledges the read-state advancement.
Do not assume local clear without server confirmation.

### 13.3 Multi-tab behavior

If unread clears in one tab:
- other open tabs should update to show cleared state
- update should arrive through realtime state sync or refreshable API reconciliation

## 14. Attachment UX

### 14.1 Upload

User should be able to add attachments through:
- upload button
- copy/paste

Attachment row should display:
- original filename
- optional comment if provided
- upload progress if supported

### 14.2 Authorization failure during download

If user clicks attachment after losing access:
- show clear permission error
- do not present corrupt or empty download as success

## 15. Presence display

### 15.1 States

Display three states clearly:
- online
- AFK
- offline

### 15.2 Update behavior

Presence changes should appear with low latency, but minor transient flicker during reconnect should be minimized.
Short debouncing in UI is acceptable if it does not materially delay visible state.

## 16. Empty, loading, and recovery states

The UI should define explicit states for:
- no rooms joined yet
- no friends yet
- no messages in chat yet
- reconnecting websocket
- history synchronization in progress
- access revoked while viewing resource

The system should not leave the user in silent broken states.

## 14. Attachment filenames and upload types

### 14.1 Allowed upload types

Do not present a product rule that rejects files solely because of type. The core rule is size-based, not type-based.

### 14.2 Filename display

Show the preserved original filename in the UI. Escape it safely for rendering.

### 14.3 Filename safety

Storage paths and download headers must not trust the raw original filename. Unsafe characters should be sanitized in any filesystem-adjacent or header context.
