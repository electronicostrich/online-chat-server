# Edge Cases and Business Rules Appendix
## Online Chat Server

## 1. Purpose

This appendix freezes the expected behavior for important edge cases and transition-heavy scenarios. It complements the PRD, state model, and permissions matrix by answering questions that typically arise only after development begins.

## 2. Edge-case table

| ID | Scenario | Expected behavior | Notes |
|---|---|---|---|
| EC-01 | User has two tabs open; one active, one idle | Presence remains **online** because at least one live tab is active. | Multi-tab rule. |
| EC-02 | User has two tabs open; both idle for more than one minute | Presence becomes **AFK** while at least one tab remains live. | AFK requires all live tabs to be inactive. |
| EC-03 | Browser hibernates inactive tab and stops JavaScript | Server eventually marks that tab stale via heartbeat timeout; presence recalculates from remaining live tabs. | Do not rely on explicit inactive signal. |
| EC-04 | User closes all tabs without graceful disconnect | Server eventually marks them offline after stale timeout. | Close event may not fire. |
| EC-05 | User logs out from current browser while another device is signed in | Only current browser session is revoked. Other active sessions remain valid. | Explicit requirement. |
| EC-06 | User revokes one session from sessions screen | That session immediately loses API and websocket access. | Other sessions remain valid. |
| EC-07 | User sends friend request to blocked user | Request is rejected. | Block overrides friendship creation. |
| EC-08 | Two users are friends; one blocks the other | Existing direct chat remains visible but becomes read-only. New DM sending is rejected. | Explicit requirement. |
| EC-09 | User removes friend without blocking | Friendship ends. New direct messaging is not allowed unless friendship is re-established. Existing direct-chat history remains visible but read-only. | Chosen default. |
| EC-10 | First direct message attempt between non-friends | Rejected. No direct chat is created. | Explicit DM rule. |
| EC-11 | First direct message between friends succeeds | Direct chat is created on first successful message. | Chosen default. |
| EC-12 | Private-room invitation sent to unknown username | Invitation is rejected. | Only registered users may be invited. |
| EC-13 | Private-room invitation exists; target user later becomes banned from room | Invitation can no longer be used successfully. | Ban overrides invitation. |
| EC-14 | User accepts invitation after room was deleted | Acceptance fails; room no longer exists. | Invitation is effectively invalid. |
| EC-15 | User attempts to join private room without invitation | Rejected. | Explicit requirement. |
| EC-16 | User attempts to join public room while banned | Rejected. | Explicit requirement. |
| EC-17 | Owner attempts to leave room | Rejected. Owner must delete room instead. | Explicit requirement. |
| EC-18 | Admin removes member from room | User is removed and treated as banned from that room. | Explicit requirement. |
| EC-19 | Admin bans current room member while member is actively viewing room | UI must lose interactive access promptly; subsequent sends, edits, downloads, and moderation actions from that user are rejected. | Current authorization always wins. |
| EC-20 | User loses room access while file upload is in progress | Upload should fail or be rolled back unless the upload completed and was authorized before access loss was applied. | Implementation must avoid partial authorized state. |
| EC-21 | User uploaded file earlier, then later loses room access | File remains stored, but uploader can no longer see or download it. | Explicit requirement. |
| EC-22 | Room deleted while members are viewing it | Room view becomes unavailable; subsequent actions fail; room messages and files are deleted. | Explicit requirement. |
| EC-23 | Room renamed to existing room name | Rejected. | Global room-name uniqueness. |
| EC-24 | Room visibility changes from public to private | Existing members remain members; room disappears from public catalog; existing invitations remain valid unless revoked. | Chosen default. |
| EC-25 | Room visibility changes from private to public | Existing members remain members; room appears in public catalog. | Chosen default. |
| EC-26 | User removed from room while replying to a message draft | Submit is rejected because current room authorization is gone. | Current authorization always wins. |
| EC-27 | Message arrives while user is offline | Message is persisted and becomes visible when user reconnects and opens application. | Explicit requirement. |
| EC-28 | Websocket event stream skips a message | Client detects sequence gap and requeries authoritative history. | Organizer design note. |
| EC-29 | Websocket delivers duplicate message event | Client must merge idempotently and render one message only. | Architecture rule. |
| EC-30 | Websocket delivers out-of-order events | Client orders by authoritative chat-local sequence and repairs gaps if needed. | Architecture rule. |
| EC-31 | User disappears for one year | No infinite transient backlog is kept for them. Durable history remains queryable through history APIs. | Organizer design note. |
| EC-32 | Deleted user owned one or more rooms | Those rooms are deleted, including their messages and attachments. | Explicit requirement. |
| EC-33 | Deleted user had messages in rooms they did not own | Messages remain in surviving rooms and are shown as belonging to deleted account placeholder. | Chosen default. |
| EC-34 | User attempts to open room they were once a member of but are now banned from | Access is denied; room messages and files are no longer visible through the UI. | Explicit requirement. |
| EC-35 | Admin deletes another user's room message | Deletion succeeds if actor still has admin privileges at time of action. | Explicit requirement. |
| EC-36 | Direct-chat participant attempts to delete other participant's message | Rejected. | No admin role in direct chats. |
| EC-37 | User opens same chat in multiple tabs | Server-side unread state remains authoritative; other tabs update when one tab clears unread. | Sequence/read-state model. |
| EC-38 | User opens chat while history sync is still incomplete after reconnect | Unread does not clear yet. Client waits until history is synchronized to current server head and the server acknowledges read advancement. | Prevents false clear state. |
| EC-39 | User downloads attachment using old direct link after room ban | Request is rejected because download is authorized against current access at request time. | Explicit access-control rule. |
| EC-40 | Invitee accepts private-room invitation after inviter lost owner/admin capability | Acceptance still succeeds if invitation remains valid and room still exists; acceptance depends on invitation validity, not inviter's current screen state. | Chosen default. |
| EC-41 | User uploads `.exe`, `.zip`, or unknown file type within size limits | Upload is allowed if size and authorization rules pass. | Core product does not restrict file type beyond size. |
| EC-42 | Uploaded filename contains path separators or control characters | Original filename stays in metadata, but storage path ignores it and any download filename is sanitized. | Storage and header safety rule. |

## 3. Frozen business rules

These rules should be treated as fixed unless product scope changes.

1. **Current authorization beats historical participation.** A user who previously had access but no longer does cannot continue to read, send, edit, or download based on earlier membership.
2. **Durable history is authoritative.** Realtime delivery accelerates updates but does not replace persisted state.
3. **Removal from room by admin is a ban.** It is not a soft remove.
4. **Direct chat requires friendship and no block.** Friendship or block changes immediately affect write eligibility.
5. **Owner is unique and cannot leave.** Owner can only delete the room.
6. **Private rooms are undiscoverable.** Non-members and non-invitees must not learn of private-room existence through the public catalog.
7. **Attachment access is based on current permission, not uploader identity.**
8. **Session logout is browser-specific.** One browser logout must not terminate all other sessions.
9. **Presence is server-derived.** Client inactivity signals are helpful but not authoritative by themselves.
10. **Transient delivery queues must stay bounded.** Long-term absences are handled through durable history and resync.

## 4. Recommended QA focus areas

The following scenarios are the highest-risk places to test first:

- multi-tab presence transitions
- session revocation while websocket is active
- room ban while room is open in client
- attachment access after room removal
- duplicate and gap websocket deliveries
- reconnect after extended offline period
- unread clearing across multiple tabs
- owner/admin edge cases in room management
