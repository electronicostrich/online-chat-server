# Acceptance Criteria Pack
## Online Chat Server

## 1. Purpose

This document defines what counts as done for the major product capabilities. It is intentionally compact and implementation-facing. Each section covers required behavior, validation, failure cases, and expected resulting state.

## 2. Identity and authentication

### AC-AUTH-01 Registration succeeds with unique credentials
**Given** a visitor provides a unique email, unique username, and valid password  
**When** they submit the registration form  
**Then** an account is created  
**And** the username is stored as immutable  
**And** the password is stored in hashed form.

### AC-AUTH-02 Registration fails for duplicate email or username
**Given** a visitor submits an email or username already in use  
**When** registration is attempted  
**Then** the account is not created  
**And** the UI shows a specific validation error for the conflicting field.

### AC-AUTH-03 Login establishes one active browser session
**Given** a registered user provides valid credentials  
**When** they sign in  
**Then** a new active session is created for that browser  
**And** the user is authenticated without affecting any other active sessions.

### AC-AUTH-04 Logout affects current browser only
**Given** a user has multiple active sessions  
**When** they log out from one browser  
**Then** only that browser session is revoked  
**And** the other sessions remain active.

### AC-AUTH-05 Active sessions screen is accurate
**Given** a signed-in user  
**When** they open the sessions screen  
**Then** they see all of their active sessions  
**And** each session shows browser/user-agent detail and IP detail  
**And** they cannot view sessions belonging to another user.

### AC-AUTH-06 Session revocation is immediate
**Given** a signed-in user revokes one of their sessions  
**When** the revoke action completes  
**Then** that session becomes invalid for subsequent API calls  
**And** any live websocket for that session is closed.

### AC-AUTH-07 Password change requires valid authenticated session
**Given** a signed-in user  
**When** they successfully change their password  
**Then** the new password is required for future sign-ins.

### AC-AUTH-08 Password reset restores access
**Given** a user requests password reset  
**When** they complete the token-based reset flow successfully  
**Then** they can sign in with the new password.

### AC-AUTH-09 Account deletion removes owned rooms and memberships
**Given** a signed-in user deletes their account  
**When** deletion completes  
**Then** their account is removed  
**And** any room they own is deleted  
**And** all messages and attachments in those deleted rooms are deleted permanently  
**And** their membership in other rooms is removed.

## 3. Presence and sessions

### AC-PRES-01 Multi-tab presence shows online if any tab is active
**Given** a user has multiple tabs open  
**And** at least one tab has recent activity  
**When** another user views their presence  
**Then** the user appears online.

### AC-PRES-02 AFK requires all live tabs to be inactive
**Given** a user has one or more live tabs  
**And** none of them has recent activity for more than one minute  
**When** presence is recalculated  
**Then** the user appears AFK.

### AC-PRES-03 Offline requires no live non-stale tabs
**Given** all of a user's tabs are disconnected or stale  
**When** presence is recalculated  
**Then** the user appears offline.

### AC-PRES-04 Browser tab hibernation does not keep user online forever
**Given** a browser suspends an inactive tab and stops JavaScript execution  
**When** heartbeats and activity signals stop  
**Then** the server eventually marks the connection stale  
**And** updates presence accordingly.

### AC-PRES-05 No inactivity logout
**Given** a signed-in user becomes AFK or offline  
**When** no explicit logout occurs  
**Then** their session remains valid until revoked or expired by policy.

## 4. Friends, blocks, and direct messaging

### AC-DM-01 Friend request can be sent by username or room list
**Given** a signed-in user and a valid target user  
**When** the sender submits a friend request by username or from a room member list  
**Then** a pending request is created  
**And** the recipient can accept or reject it.

### AC-DM-02 Friendship is created only on recipient acceptance
**Given** an open friend request  
**When** the recipient accepts it  
**Then** both users become friends  
**And** the request is closed.

### AC-DM-03 Friend removal terminates friend relationship and freezes existing DM
**Given** two users are friends  
**When** either user removes the other  
**Then** the friendship no longer exists  
**And** new direct messaging is no longer allowed unless friendship is re-established  
**And** any existing direct chat remains visible but read-only until friendship is re-established and no block exists.

### AC-DM-04 Direct messaging requires friendship and no block
**Given** two users are not friends, or one has blocked the other  
**When** either attempts to send a direct message  
**Then** the message is rejected  
**And** no new writable direct chat is created.

### AC-DM-05 First successful direct message creates direct chat
**Given** two users are friends and unblocked  
**When** one sends the first direct message successfully  
**Then** a direct chat is created with exactly two participants.

### AC-DM-06 User-to-user block freezes direct chat
**Given** two users have an existing direct chat  
**When** either user blocks the other  
**Then** new direct messages are rejected  
**And** existing direct-message history remains visible  
**And** the chat becomes read-only to both sides.

## 5. Rooms and discovery

### AC-ROOM-01 Any authenticated user can create a room
**Given** a signed-in user  
**When** they submit valid room details  
**Then** a room is created  
**And** the creator becomes the owner.

### AC-ROOM-02 Room names are globally unique
**Given** an existing room name  
**When** another user attempts to create or rename a room to the same normalized name  
**Then** the operation is rejected.

### AC-ROOM-03 Public room catalog shows searchable discoverable rooms
**Given** one or more public rooms  
**When** an authenticated user opens the public room catalog  
**Then** they see room name, description, and current member count  
**And** they can search the catalog.

### AC-ROOM-04 Private rooms are hidden from catalog
**Given** a private room  
**When** an authenticated non-member searches the public catalog  
**Then** that room is not shown.

### AC-ROOM-05 Public rooms can be joined unless banned
**Given** a signed-in user is not banned from a public room  
**When** they choose to join it  
**Then** they become a member.

### AC-ROOM-06 Banned users cannot join public rooms
**Given** a signed-in user is on a room's ban list  
**When** they attempt to join that room  
**Then** the join is rejected.

### AC-ROOM-07 Owner cannot leave own room
**Given** a room owner  
**When** they attempt to leave the room  
**Then** the leave action is rejected  
**And** deletion remains the only supported path to remove the room.

### AC-ROOM-08 Room deletion removes messages and attachments permanently
**Given** a room owner  
**When** they delete the room  
**Then** the room is removed  
**And** all room messages are deleted  
**And** all room attachments are deleted.

## 6. Invitations and private rooms

### AC-INV-01 Only registered users can be invited
**Given** a private room and a target username  
**When** the inviter submits the invite  
**Then** the invite succeeds only if the target is an already registered user.

### AC-INV-02 Invite acceptance grants membership
**Given** a pending private-room invitation  
**When** the invited user accepts it  
**Then** they become a member of that private room.

### AC-INV-03 Invite rejection changes nothing else
**Given** a pending private-room invitation  
**When** the invited user rejects it  
**Then** they do not become a member  
**And** no room state changes beyond closing the invitation.

### AC-INV-04 Banned user cannot use invitation to gain access
**Given** a user has a pending invitation but is now banned from the room  
**When** they try to accept the invitation  
**Then** acceptance is rejected.

## 7. Room moderation and roles

### AC-MOD-01 Owner is always admin
**Given** any room  
**When** role assignments change  
**Then** the owner always remains an admin  
**And** cannot lose admin privileges.

### AC-MOD-02 Admin can remove member and it becomes a ban
**Given** a room admin and a current member  
**When** the admin removes that member  
**Then** the member is removed from the room  
**And** added to the room ban list.

### AC-MOD-03 Admin can view ban list and who issued each ban
**Given** a room admin  
**When** they open the banned-users view  
**Then** they can see banned users  
**And** the actor who issued each ban.

### AC-MOD-04 Admin can unban user
**Given** a room admin or owner and a banned user  
**When** unban is confirmed  
**Then** the ban entry is removed  
**And** the user may rejoin through normal room access paths.

### AC-MOD-05 Admin can remove another non-owner admin
**Given** a room admin and another admin who is not the owner  
**When** the first admin removes admin status from the second  
**Then** the second admin becomes a regular member.

### AC-MOD-06 Owner can remove any admin
**Given** a room owner and any non-owner admin  
**When** the owner removes that admin  
**Then** that user loses admin privileges.

### AC-MOD-07 No one can remove owner admin status
**Given** any room  
**When** any user attempts to strip the owner's admin role  
**Then** the action is rejected.

## 8. Messaging and history

### AC-MSG-01 Messages support required content forms
**Given** an authorized participant in a room or writable direct chat  
**When** they send a message  
**Then** the system accepts plain text, multiline text, UTF-8 content, emoji, attachments, and optional reply reference within defined limits.

### AC-MSG-02 Message size limit is enforced
**Given** an authorized participant  
**When** they attempt to send message text larger than 3 KB  
**Then** the system rejects the message with a validation error.

### AC-MSG-03 Message ordering is stable and chronological
**Given** persisted messages in a chat  
**When** history is rendered or new messages arrive  
**Then** messages appear in persisted chat order.

### AC-MSG-04 Author can edit own message
**Given** a current authorized participant is the message author  
**When** they edit the message  
**Then** the new content is stored  
**And** the UI shows an edited indicator.

### AC-MSG-05 Admin can delete room message authored by another user
**Given** a room admin or owner  
**When** they delete another participant's room message  
**Then** the message is removed according to the chosen deletion model.

### AC-MSG-06 Direct-chat participants cannot delete each other's messages
**Given** a direct chat  
**When** one participant attempts to delete the other participant's message  
**Then** the action is rejected.

### AC-MSG-07 Offline recipient sees missed messages after reconnect
**Given** a user was offline while messages were sent to an accessible chat  
**When** they reconnect and open the application  
**Then** the missed messages are available from persisted history.

### AC-MSG-08 Infinite scroll loads older history
**Given** a chat with older persisted messages  
**When** the user scrolls upward far enough  
**Then** older history is retrieved incrementally without replacing newer loaded messages.

## 9. Realtime delivery and continuity

### AC-RT-01 Realtime update path does not rely on REST polling
**Given** connected users in an active chat  
**When** one sends a message  
**Then** other connected authorized participants receive the update through the realtime channel without polling loops.

### AC-RT-02 Hybrid model supports authoritative recovery
**Given** websocket delivery is interrupted or a client reconnects  
**When** synchronization resumes  
**Then** the client can recover authoritative history through HTTP APIs.

### AC-RT-03 Every persisted message gets next chat-local sequence
**Given** a chat with current sequence N  
**When** a new message is persisted  
**Then** it receives sequence N+1 in that chat.

### AC-RT-04 Client repairs sequence gaps
**Given** a client expects sequence N+1 but receives N+2  
**When** the gap is detected  
**Then** the client fetches authoritative history for the missing range before marking the chat synchronized.

### AC-RT-05 Duplicate or out-of-order events do not create duplicate rendered messages
**Given** the realtime stream duplicates or reorders events  
**When** the client merges those events  
**Then** each persisted message appears at most once.

### AC-RT-06 No unbounded delivery backlog for inactive users
**Given** a user stays absent for a long period  
**When** messages continue to accumulate in their accessible chats  
**Then** durable history remains available  
**And** transient delivery buffers do not grow unbounded waiting for that user.

## 10. Attachments

### AC-ATT-01 Room participant can upload allowed file within limits
**Given** a current authorized room participant  
**When** they upload a file or image within size limits  
**Then** the attachment is stored  
**And** metadata preserves original filename  
**And** optional comment is stored if provided.

### AC-ATT-02 Oversized uploads are rejected
**Given** a current authorized participant  
**When** they upload an image over 3 MB or another file over 20 MB  
**Then** the upload is rejected with validation error.

### AC-ATT-03 Attachment access is based on current authorization
**Given** a file exists in a room  
**When** a user who has since lost room access attempts to download it  
**Then** the request is rejected even if they originally uploaded it.

### AC-ATT-04 Room deletion removes room attachments
**Given** a room containing attachments  
**When** the room is deleted  
**Then** the stored files and metadata are removed according to deletion policy.

## 11. Unread state and notifications

### AC-UNREAD-01 Unread indicator appears for room with unseen messages
**Given** a user has not opened a room since new messages arrived  
**When** they view the room list  
**Then** an unread indicator is shown for that room.

### AC-UNREAD-02 Unread indicator appears for direct chat with unseen messages
**Given** a user has unseen direct messages  
**When** they view their direct-contact list  
**Then** an unread indicator is shown.

### AC-UNREAD-03 Opening chat clears unread state
**Given** a user has unread state for a chat they are allowed to access  
**When** they open that chat successfully  
**Then** unread state for that user and that chat is cleared.

### AC-UNREAD-04 Multi-tab unread state stays consistent
**Given** the same user has multiple tabs open  
**When** one tab opens a chat and clears unread state  
**Then** the other tabs update to reflect the cleared state.

## 12. UI behavior

### AC-UI-01 Standard chat layout is preserved
**Given** a signed-in user  
**When** they enter the application  
**Then** they see a top menu, central message area, bottom composer, side navigation for rooms/contacts, and a right-side context/members panel when applicable.

### AC-UI-02 Autoscroll occurs only when user is already at bottom
**Given** a user is viewing the latest messages at the bottom of the chat  
**When** a new message arrives  
**Then** the chat auto-scrolls to keep the new message visible.

### AC-UI-03 No forced autoscroll while reading older history
**Given** a user has scrolled up to read older messages  
**When** new messages arrive  
**Then** the view does not forcibly jump to the bottom.

### AC-UI-04 Moderation actions are available through menus and dialogs
**Given** a room admin or owner  
**When** they manage room participants or bans  
**Then** the required actions are accessible through menus and modal dialogs.

### AC-ATTACH-05 No file-type restriction beyond size limits
**Given** a file upload within the configured size limits  
**When** the user uploads the file  
**Then** the upload is not rejected solely because of file type.

### AC-ATTACH-06 Original filename is preserved but not trusted for storage
**Given** a user uploads a file with a filename  
**When** the upload succeeds  
**Then** the original filename is preserved in metadata and UI  
**And** the storage path uses a server-generated identifier  
**And** any download filename emitted by the server is sanitized for unsafe characters.
