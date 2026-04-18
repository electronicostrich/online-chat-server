# Finalized Requirement Decisions
## Online Chat Server

This document freezes product-level decisions that were previously open or implicit. These decisions are now treated as part of the handoff baseline and should not be re-litigated during implementation unless scope changes.

## 1. Identity normalization and uniqueness

### 1.1 Usernames
Usernames are compared for uniqueness using a canonical form that:
- trims leading and trailing whitespace
- normalizes Unicode to NFC
- collapses internal whitespace runs to a single space
- compares case-insensitively

The canonical form is used for uniqueness checks and database constraints. The stored/display form may preserve case, but UI validation should prevent usernames that normalize to an existing canonical value.

### 1.2 Room names
Room names use the same canonicalization rule as usernames:
- trim leading/trailing whitespace
- Unicode NFC normalization
- collapse internal whitespace runs to a single space
- case-insensitive comparison

Global room-name uniqueness is enforced on the canonical form across both public and private rooms.

## 2. Session transport and request protection

The system uses server-managed, revocable sessions with cookie-based authentication.

### 2.1 HTTP auth
- The browser authenticates using an httpOnly session cookie.
- SameSite should be `Lax` by default.
- `Secure` should be enabled whenever HTTPS is used; local plain-HTTP development may use a development-only override.

### 2.2 CSRF protection
All state-changing HTTP endpoints must enforce CSRF protection.

Required posture:
- CSRF token on state-changing requests
- Origin and/or Referer validation on state-changing requests
- no reliance on SameSite alone as the only CSRF control

### 2.3 WebSocket auth
WebSocket handshake authenticates against the same server-managed session and must validate allowed origin.

## 3. Room visibility changes after creation

Room visibility **may** be changed by the room owner after creation.

### 3.1 Public -> private
- Existing members remain members.
- The room disappears from the public catalog immediately.
- New free joins from the public catalog stop immediately.
- Existing invitations remain valid unless explicitly revoked.

### 3.2 Private -> public
- Existing members remain members.
- The room becomes visible in the public catalog immediately.
- Authenticated users may join freely unless banned.
- Existing invitations remain valid.

## 4. Unread semantics

### 4.1 Clear-on-open rule
Opening a chat does **not** clear unread optimistically on the client.

Unread clears only when:
1. the client has synchronized the chat to the current server head, and
2. the server acknowledges the read-state advancement.

### 4.2 Cross-tab rule
Server-side read state is authoritative across tabs.

If one tab clears unread for a chat:
- all other tabs for that same user must update to show the cleared state
- no tab may continue showing unread for that already-cleared range

### 4.3 Open-chat live reading rule
If a chat is currently open, synchronized, and active in the foreground, newly arriving messages in that chat may immediately advance read state server-side.

Background tabs do not automatically mark messages as read merely because the tab exists.

## 5. Direct-message lifecycle

### 5.1 Creation trigger
A direct chat is created only on the first successful direct message between two eligible users.

Do not create an empty durable direct chat merely because a user opens a profile, clicks “message,” or views a composer.

### 5.2 Friendship removal effect
Removing a friend without blocking:
- ends friendship immediately
- disables new direct messaging immediately
- keeps existing direct-chat history visible
- makes that existing direct chat read-only until friendship is re-established and no block exists

### 5.3 Block effect
Blocking another user:
- disables new direct messaging immediately
- keeps existing direct-chat history visible
- makes the existing direct chat read-only

Unblocking alone does not restore messaging unless the users are friends again.

## 6. Attachment policy

### 6.1 Allowed file types
The core product imposes no file-type restriction beyond the explicit size limits in the requirements.

### 6.2 Filename preservation and storage
- Preserve the original filename in metadata and UI.
- Do not use the original filename as the trusted storage path.
- Store attachment binaries under server-generated identifiers.

### 6.3 Download filename sanitization
Any filename used in a download header or filesystem-adjacent context must be sanitized to remove:
- null bytes
- control characters
- path separators
- reserved traversal-like sequences

If sanitization produces an empty value, use a safe fallback filename.
