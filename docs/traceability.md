# Traceability Index

## Online Chat Server

## 1. Purpose

This document is the single source of truth for mapping **acceptance criteria** to the code artifacts that implement them: API endpoints, WebSocket events, state-model transitions, and data-model entities.

Every AC in `acceptance-criteria-pack.md` must appear here. Every API endpoint in `api-and-events.md` must be cited by at least one AC row. Every state-model transition in `state-model.md` that has business-visible effects must be reachable from at least one AC row.

This table is checked by CI (`docs/ci-pipeline.md` → `doc-consistency.yml`):

- Every `AC-*` ID mentioned in this table MUST exist in `acceptance-criteria-pack.md`.
- Every row's "Playwright test" column MUST correspond to a test file whose name starts with the AC ID.
- Every API path mentioned MUST exist in `api-and-events.md`.

## 2. How to use this table

- **When implementing** a feature, locate the AC row → implement the listed endpoint(s) → wire state transitions → ensure the Playwright test exists and passes.
- **When reviewing a PR**, the PR must declare which AC IDs it touches. The reviewer confirms the implementation matches the row's columns.
- **When adding a new AC**, add a row here in the same PR. Do not let the index drift behind the AC pack.

## 3. Column conventions

- **AC ID**: exact identifier from `acceptance-criteria-pack.md`.
- **Capability**: short human label.
- **Primary HTTP endpoint(s)**: from `api-and-events.md`. `—` if none.
- **WebSocket event(s)**: from `api-and-events.md` §6.4. `—` if none.
- **State transition(s)**: cite `state-model.md` by section heading or transition. `—` if none.
- **Primary entities**: the main tables in `data-model.md` involved.
- **Permissions row(s)**: the matching row(s) in `permissions-matrix.md`. `—` for global/infra ACs.
- **Playwright test**: the test file name stem (e.g., `AC-AUTH-01-registration.spec.ts`).

## 3.1 Bootstrap (pseudo-AC)

| AC ID      | Capability                        | HTTP                                      | WS event | State transition | Entities                   | Permissions row | Playwright test                |
| ---------- | --------------------------------- | ----------------------------------------- | -------- | ---------------- | -------------------------- | --------------- | ------------------------------ |
| AC-BOOT-00 | Stage-0 scaffolding and bootstrap | `GET /healthz`, `POST /__test/seed` (dev) | —        | —                | — (no persistent entities) | —               | `AC-BOOT-00-bootstrap.spec.ts` |

## 3.2 Stage-1 tooling (meta safety net)

These rows map `deferred-stage-1` tooling issues (#1–#8) onto the scripts
that implement them. Not ACs — they have no Playwright spec, no permissions
row, and no API surface. Listed here so every script under `scripts/` can
be traced back to the issue that motivated it.

| Issue                                                                  | Script                            | Layer                   | Invoked from                                                                            | Closed in                                     |
| ---------------------------------------------------------------------- | --------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| [#1](https://github.com/electronicostrich/online-chat-server/issues/1) | `scripts/doc-coverage.ts`         | 3 (CI)                  | `pnpm doc-consistency`, lefthook `pre-push`, `.github/workflows/ci.yml doc-consistency` | `chore: implement #1 doc-coverage.ts`         |
| [#2](https://github.com/electronicostrich/online-chat-server/issues/2) | `scripts/schema-drift-check.ts`   | 3 (CI)                  | `pnpm schema-drift`, `.github/workflows/ci.yml schema-drift`                            | `chore: implement #2 schema-drift-check.ts`   |
| [#3](https://github.com/electronicostrich/online-chat-server/issues/3) | `scripts/lint-compose.ts`         | 2/3                     | `pnpm lint-compose`                                                                     | `chore: implement #3 lint-compose.ts`         |
| [#4](https://github.com/electronicostrich/online-chat-server/issues/4) | `scripts/check-test-substance.ts` | 3 (CI)                  | CI (planned); ad-hoc local                                                              | `chore: implement #4 check-test-substance.ts` |
| [#5](https://github.com/electronicostrich/online-chat-server/issues/5) | `scripts/check-pr-description.ts` | 3 (CI)                  | `.github/workflows/ci.yml check-pr-title` and `check-pr-description`                    | `chore: implement #5 check-pr-description.ts` |
| [#6](https://github.com/electronicostrich/online-chat-server/issues/6) | `scripts/check-suppressions.ts`   | 2 (pre-commit) / 3 (CI) | lefthook `pre-commit suppression-check`; CI base↔head mode                              | `chore: implement #6 check-suppressions.ts`   |
| [#7](https://github.com/electronicostrich/online-chat-server/issues/7) | `scripts/drizzle-guard.ts`        | 2 (pre-commit)          | lefthook `pre-commit drizzle-guard`                                                     | `chore: implement #7 drizzle-guard.ts`        |
| [#8](https://github.com/electronicostrich/online-chat-server/issues/8) | `scripts/ac-test-presence.ts`     | 2 (pre-commit)          | lefthook `pre-commit ac-test-presence`                                                  | `chore: implement #8 ac-test-presence.ts`     |

## 4. Authentication, sessions, and account lifecycle

| AC ID      | Capability                      | HTTP                                                                     | WS event                   | State transition                            | Entities                                              | Permissions row                    | Playwright test                             |
| ---------- | ------------------------------- | ------------------------------------------------------------------------ | -------------------------- | ------------------------------------------- | ----------------------------------------------------- | ---------------------------------- | ------------------------------------------- |
| AC-AUTH-01 | Registration with unique creds  | `POST /auth/register`                                                    | —                          | User: none → active                         | User                                                  | §3 "Register account"              | `AC-AUTH-01-registration.spec.ts`           |
| AC-AUTH-02 | Registration fails on duplicate | `POST /auth/register`                                                    | —                          | —                                           | User                                                  | §3 "Register account"              | `AC-AUTH-02-duplicate-registration.spec.ts` |
| AC-AUTH-03 | Login creates one session       | `POST /auth/login`                                                       | —                          | Session: none → active                      | User, Session                                         | §3 "Sign in"                       | `AC-AUTH-03-login-session.spec.ts`          |
| AC-AUTH-04 | Logout revokes only current     | `POST /auth/logout`                                                      | `session.revoked` (self)   | Session: active → revoked                   | Session                                               | §3 "Sign out current session"      | `AC-AUTH-04-logout-scope.spec.ts`           |
| AC-AUTH-05 | Sessions screen is accurate     | `GET /sessions`                                                          | —                          | —                                           | Session                                               | §3 "View active sessions"          | `AC-AUTH-05-sessions-list.spec.ts`          |
| AC-AUTH-06 | Session revocation is immediate | `POST /auth/logout-session`                                              | `session.revoked` (target) | Session: active → revoked                   | Session                                               | §3 "Revoke another active session" | `AC-AUTH-06-revoke-immediate.spec.ts`       |
| AC-AUTH-07 | Password change                 | `POST /auth/password-change` (see note)                                  | —                          | —                                           | User                                                  | §3 "Change password"               | `AC-AUTH-07-password-change.spec.ts`        |
| AC-AUTH-08 | Password reset flow             | `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm` | —                          | PasswordResetToken: open → consumed         | PasswordResetToken, User                              | §3 "Request password reset"        | `AC-AUTH-08-password-reset.spec.ts`         |
| AC-AUTH-09 | Account deletion cascades       | `DELETE /users/me` (see note)                                            | `session.revoked` × N      | User: active → deleted; owned Rooms deleted | User, Room, Chat, Message, Attachment, RoomMembership | §3 "Delete own account"            | `AC-AUTH-09-account-deletion.spec.ts`       |

Notes: `POST /auth/password-change` is now documented in `api-and-events.md` §5.1 (landed with WS-02 AC-AUTH-07). `DELETE /users/me` is still documented there but not yet implemented — AC-AUTH-09 is held for WS-03, see `docs/workstream-notes/ws-02-blockers.md`.

Implementation status (WS-02 autorun, 2026-04-19):

- AC-AUTH-01 — implemented. `POST /auth/register` issues Argon2id-hashed password, opaque session cookie (`chat_sid`, httpOnly), CSRF token cookie (`csrf_token`, double-submit). Spec at `e2e/specs/AC-AUTH-01-registration.spec.ts`.
- AC-AUTH-02 — implemented. Duplicate email and duplicate username (including case-insensitive collisions) return `CONFLICT` with `details.field`. Spec at `e2e/specs/AC-AUTH-02-duplicate-registration.spec.ts`.
- AC-AUTH-03 — implemented. `POST /auth/login` issues a per-browser session without touching other sessions; wrong password returns `UNAUTHENTICATED` with no cookies. Spec at `e2e/specs/AC-AUTH-03-login-session.spec.ts`.
- AC-AUTH-04 — implemented. `POST /auth/logout` revokes only the caller's session and clears its cookies; other active sessions for the same user remain valid. Spec at `e2e/specs/AC-AUTH-04-logout-scope.spec.ts`. Note: `session.revoked` WebSocket fan-out to the caller is WS-05's responsibility; HTTP layer is done here.
- AC-AUTH-05 — implemented. `GET /sessions` returns all active sessions for the caller with UA/IP metadata and exactly one `current: true`; cross-user access is impossible. Spec at `e2e/specs/AC-AUTH-05-sessions-list.spec.ts`.
- AC-AUTH-06 — implemented (HTTP layer). `POST /auth/logout-session` revokes the target session immediately; cross-user revocation is rejected with `NOT_FOUND` (no information leak). Spec at `e2e/specs/AC-AUTH-06-revoke-immediate.spec.ts`. WebSocket drop of the live socket belongs to WS-05 and is outside this workstream's scope.
- AC-PRES-05 — implemented. Sessions remain valid across idle periods; only explicit logout or TTL expiry ends them. Spec at `e2e/specs/AC-PRES-05-no-inactivity-logout.spec.ts`.
- AC-AUTH-07 — implemented. `POST /auth/password-change` verifies `currentPassword`, enforces the same complexity rules as registration, updates the stored hash, and revokes all of the user's other sessions (the calling session is preserved). WebSocket `session.revoked` fan-out for the terminated sessions is WS-05's responsibility. Spec at `e2e/specs/AC-AUTH-07-password-change.spec.ts`.
- AC-AUTH-08 — implemented. `POST /auth/password-reset/request` always returns 200 (no email enumeration); `POST /auth/password-reset/confirm` consumes the single-use token, re-hashes the password, and revokes all of the user's sessions. SMTP delivery is not yet wired (transport is outside WS-02 scope) — the raw token is captured under `NODE_ENV=test` by `apps/api/src/modules/auth/test-reset-token-store.ts` and surfaced through the `/__test/last-reset-token` peek route so Playwright can drive the flow. Spec at `e2e/specs/AC-AUTH-08-password-reset.spec.ts`.
- AC-AUTH-09 — **deferred** to a follow-up PR. The account-deletion cascade covers rooms, memberships, friendships, blocks, friend requests, and user blocks — all of which are WS-03-owned entities that don't exist in the schema yet. See `docs/workstream-notes/ws-02-blockers.md` for the full rationale and hand-off notes.

Implementation status (WS-03 autorun, 2026-04-19):

- AC-ROOM-01 — implemented. `POST /rooms` creates a `chats` row (type=`room`), a `rooms` row (with case-insensitive `normalized_name` uniqueness), and an owner `room_memberships` row in one transaction. Spec at `e2e/specs/AC-ROOM-01-create-room.spec.ts`.
- AC-ROOM-02 — covered by the same `POST /rooms` handler via the normalized-name unique index; the duplicate-name assertion lives inside `e2e/specs/AC-ROOM-01-create-room.spec.ts`. The dedicated spec file named in the table row above (`AC-ROOM-02-name-uniqueness.spec.ts`) is authored by the follow-up that also lands the `PATCH /rooms/{id}` rename path — the row's file reference is the target, not the current state.
- AC-ROOM-08 — implemented (HTTP layer). `DELETE /rooms/{id}` is owner-only, soft-deletes both the `rooms` row (`deleted_at`) and the underlying `chats` row so messages/attachments become unreachable to WS-04/WS-06. Hard-purge after 30 days is a scheduled job held for WS-08. Spec at `e2e/specs/AC-ROOM-08-room-deletion.spec.ts`.
- AC-DM-01 — implemented. `POST /friends/requests` validates the recipient is registered, is not the caller, and is not involved in an active block in either direction; creates a `friend_requests` row with `status='open'`. Spec at `e2e/specs/AC-DM-01-friend-request.spec.ts`.
- AC-DM-06 — partially implemented. `POST /blocks/{userId}` creates the `user_blocks` row, is idempotent, and rejects self-block. The WS-03 slice of the freeze semantics (block rejects friend requests in either direction) is proven in `e2e/specs/AC-DM-06-block-freezes-dm.spec.ts`. Freezing an existing direct chat's message-send path belongs to WS-04's `POST /chats/{id}/messages` handler and is held for that workstream.
- **Deferred** within WS-03: AC-ROOM-03..07, AC-INV-01..04, AC-MOD-01..08, AC-DM-02..05. See `docs/workstream-notes/ws-03-progress.md` for the full list and rationale.

Implementation status (WS-04 autorun, 2026-04-19):

- AC-MSG-01 — implemented. `POST /chats/{chatId}/messages` accepts plain text, multiline text, UTF-8 emoji, and optional `replyToMessageId`. Room-membership gate enforces authorization; reply targets must belong to the same chat. Spec at `e2e/specs/AC-MSG-01-content-forms.spec.ts`.
- AC-MSG-02 — implemented. The send path measures `bodyText` UTF-8 byte length and rejects any payload over 3 KB with `VALIDATION_ERROR`. Emoji/multibyte cases are covered in the spec. Spec at `e2e/specs/AC-MSG-02-size-limit.spec.ts`.
- AC-MSG-03 — implemented. `GET /chats/{chatId}/messages` returns DESC-by-`sequence` rows; the Playwright spec asserts `createdAt` monotonicity and body-text ordering for a contiguous batch. Spec at `e2e/specs/AC-MSG-03-ordering.spec.ts`.
- AC-MSG-04 — implemented. `PATCH /messages/{messageId}` requires `req.session.user.id === message.author_user_id`; sets `edited_at`. Non-authors get `FORBIDDEN`. Spec at `e2e/specs/AC-MSG-04-edit-own.spec.ts`.
- AC-MSG-05 — implemented. `DELETE /messages/{messageId}` grants moderation rights to the room's admin and owner; other members are `FORBIDDEN`. Deleted messages stay in history with `body_text` nulled out so the sequence space isn't reshuffled. Spec at `e2e/specs/AC-MSG-05-admin-delete.spec.ts`.
- AC-MSG-06 — implemented. Direct-chat participants can only delete their own messages; the non-author case returns `FORBIDDEN`. Spec at `e2e/specs/AC-MSG-06-dm-delete-restricted.spec.ts`.
- AC-MSG-07 — implemented (HTTP layer). `GET /chats/{chatId}/messages?afterSequence=N` returns the missed window from durable history. The websocket re-subscribe that integrates this is WS-05's responsibility. Spec at `e2e/specs/AC-MSG-07-offline-catchup.spec.ts`.
- AC-MSG-08 — implemented. `beforeSequence` + `limit` pages older-than-cursor windows; non-overlapping pages confirmed in the spec. Spec at `e2e/specs/AC-MSG-08-infinite-scroll.spec.ts`.
- AC-RT-03 — implemented. `insertMessageWithSequence` bumps `chats.current_sequence` and inserts the message inside one transaction, so concurrent sends produce contiguous sequence numbers with no duplicates. Spec at `e2e/specs/AC-RT-03-sequence-allocation.spec.ts`.
- AC-DM-04 — implemented. Send paths (chat-scoped and `POST /dm/{userId}/messages`) check `findActiveBlockBetween` before `hasActiveFriendship`; both rejection paths return `DM_NOT_ALLOWED`. The WS-03 friendship-writer is still deferred, so the Playwright spec uses the `/__test/seed` fixture's new `friendships` + `blocks` fields. Spec at `e2e/specs/AC-DM-04-dm-eligibility.spec.ts`.
- AC-DM-05 — implemented. `POST /dm/{userId}/messages` lazy-creates the direct chat + participant rows in a single transaction the first time, and reuses the existing chat thereafter. Response reports `chat.created=true/false`. Spec at `e2e/specs/AC-DM-05-first-dm.spec.ts`.
- AC-UNREAD-01 — implemented. `GET /chats/{chatId}/read-state` returns `hasUnread = headSequence > lastReadSequence`; absence of a `chat_read_state` row is treated as `last_read_sequence=0`. Spec at `e2e/specs/AC-UNREAD-01-room-indicator.spec.ts`.
- AC-UNREAD-02 — implemented. Direct-chat flavour of the same contract, proven on a lazy-created DM. Spec at `e2e/specs/AC-UNREAD-02-dm-indicator.spec.ts`.
- AC-UNREAD-03 — implemented. `POST /chats/{chatId}/read` upserts `chat_read_state` with `GREATEST(existing, LEAST(requested, head))` — advances are monotonic and over-advances silently clamp. Spec at `e2e/specs/AC-UNREAD-03-explicit-advance.spec.ts`.
- **Deferred** within WS-04: AC-UNREAD-04 (multi-tab consistency needs WS-05's websocket fan-out), the `message.created/edited/deleted/readstate.updated` event emissions (all WS-05), and the gap-detection `sync.request` contract (AC-RT-04; ends up in WS-05 on top of this history layer).

Implementation status (WS-05 autorun, 2026-04-19):

- AC-RT-01 — implemented. `GET /ws` accepts authenticated websocket connections; `chat.subscribe` commands join a per-chat subscriber set after the same room-membership / direct-participant check used by the REST read path. `POST /chats/{id}/messages` and `POST /dm/{userId}/messages` publish `message.created` to every authorised subscriber after commit. Spec at `e2e/specs/AC-RT-01-realtime-delivery.spec.ts`. Implementation in `apps/api/src/modules/realtime/`.
- AC-RT-06 — implemented. The delivery path rejects any event whose encoding would push `bufferedAmount` over 256 KiB and closes the offending socket with close code 4408 (`WS_CLOSE_CODES.SLOW_CONSUMER`). Unit coverage in `apps/api/test/unit/realtime/delivery.test.ts` asserts both the happy-path send and the slow-consumer close; an e2e reproduction is deferred because the OS-level TCP buffer behaviour makes a reliable end-to-end trigger difficult without either a test-only threshold (which would muddle the prod guarantee) or a bespoke raw-socket test harness.
- AC-UNREAD-04 — implemented. `POST /chats/{id}/read` fan-outs `readstate.updated` to every session of the calling user; other users in the same chat do not receive the event (read state is per-user). Spec at `e2e/specs/AC-UNREAD-04-multitab.spec.ts`.
- AC-AUTH-06 (WS portion) — implemented. `POST /auth/logout-session` publishes `session.revoked` to the revoked session's live socket and closes it with code 4440 (`WS_CLOSE_CODES.SESSION_REVOKED`). Spec at `e2e/specs/AC-AUTH-06-ws-drop.spec.ts`. Other active sessions for the same user stay up.
- `message.edited` / `message.deleted` — emitted on `PATCH /messages/{id}` and `DELETE /messages/{id}` (completes the WS portion of AC-MSG-04 / AC-MSG-05). No new Playwright spec: the HTTP AC specs (WS-04) still cover the REST contract, and AC-RT-01's test infra proves the gateway plumbing.
- **Deferred** within WS-05 (tracked in `docs/workstream-notes/ws-05-progress.md`): AC-PRES-01..04 (multi-tab presence aggregation), AC-RT-02/AC-RT-04 (`sync.request` / `sync.response`), AC-RT-05 (client-side dedup — no server behaviour), AC-AUTH-04 self-socket drop (cosmetic — HTTP response already clears the caller's cookie), and `room.*`/`session.revoked` emissions for AUTH-07 password-change and WS-03 moderation/invitation endpoints that don't yet exist.

## 5. Presence

| AC ID      | Capability                        | HTTP | WS event           | State transition                    | Entities                          | Permissions row               | Playwright test                           |
| ---------- | --------------------------------- | ---- | ------------------ | ----------------------------------- | --------------------------------- | ----------------------------- | ----------------------------------------- |
| AC-PRES-01 | Online if any tab active          | —    | `presence.updated` | Presence: → online                  | LiveConnection, PresenceAggregate | §4 "View presence of friend"  | `AC-PRES-01-multitab-online.spec.ts`      |
| AC-PRES-02 | AFK when all tabs idle >60s       | —    | `presence.updated` | Presence: online → afk              | LiveConnection, PresenceAggregate | §4                            | `AC-PRES-02-afk-threshold.spec.ts`        |
| AC-PRES-03 | Offline when no live tabs         | —    | `presence.updated` | Presence: afk/online → offline      | LiveConnection                    | §4                            | `AC-PRES-03-offline-no-tabs.spec.ts`      |
| AC-PRES-04 | Hibernated tab eventually offline | —    | `presence.updated` | Presence: → offline after 45s stale | LiveConnection                    | §4                            | `AC-PRES-04-hibernation.spec.ts`          |
| AC-PRES-05 | No inactivity logout              | —    | —                  | Session stays active                | Session                           | §3 "Sign out current session" | `AC-PRES-05-no-inactivity-logout.spec.ts` |

## 6. Friends, blocks, and direct messaging

| AC ID    | Capability                        | HTTP                                                                               | WS event          | State transition                                          | Entities                             | Permissions row                                  | Playwright test                          |
| -------- | --------------------------------- | ---------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------- | ------------------------------------ | ------------------------------------------------ | ---------------------------------------- |
| AC-DM-01 | Friend request                    | `POST /friends/requests`                                                           | —                 | FriendRequest: none → open                                | FriendRequest                        | §4 "Send friend request"                         | `AC-DM-01-friend-request.spec.ts`        |
| AC-DM-02 | Friendship on acceptance          | `POST /friends/requests/{id}/accept`                                               | —                 | FriendRequest: open → accepted; Friendship: none → active | FriendRequest, Friendship            | §4 "Accept friend request"                       | `AC-DM-02-friendship-accept.spec.ts`     |
| AC-DM-03 | Friend removal freezes DM         | `DELETE /friends/{userId}`                                                         | —                 | Friendship: active → removed; DirectChat: active → frozen | Friendship, Chat (direct)            | §4 "Remove friend"                               | `AC-DM-03-friend-removal-freeze.spec.ts` |
| AC-DM-04 | DM requires friendship + no block | `POST /chats/{chatId}/messages` (rejected)                                         | —                 | —                                                         | Friendship, UserBlock                | §5 "Send message in existing direct chat"        | `AC-DM-04-dm-eligibility.spec.ts`        |
| AC-DM-05 | First DM creates direct chat      | `POST /chats/{chatId}/messages` (first) OR `POST /dm/{userId}/messages` (see note) | `message.created` | Chat: none → active; DirectChatParticipant × 2 created    | Chat, DirectChatParticipant, Message | §5 "Create direct chat by sending first message" | `AC-DM-05-first-dm.spec.ts`              |
| AC-DM-06 | Block freezes DM                  | `POST /blocks/{userId}`                                                            | —                 | UserBlock: none → active; DirectChat: active → frozen     | UserBlock, Chat                      | §4 "Block another user"                          | `AC-DM-06-block-freezes-dm.spec.ts`      |

Note: DM creation is resolved via `POST /dm/{userId}/messages` (api-and-events.md §5.6.1): the first send lazy-creates the direct chat + participant rows in a single transaction, then subsequent sends reuse the returned `chatId` against `POST /chats/{chatId}/messages`. The response reports `chat.created=true/false` so the caller can tell which path ran.

## 7. Rooms

| AC ID      | Capability                         | HTTP                                | WS event                      | State transition                             | Entities                                        | Permissions row                          | Playwright test                         |
| ---------- | ---------------------------------- | ----------------------------------- | ----------------------------- | -------------------------------------------- | ----------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| AC-ROOM-01 | Authenticated user creates room    | `POST /rooms`                       | —                             | Room: none → active; RoomMembership (owner)  | Room, Chat, RoomMembership                      | §6 "Create room"                         | `AC-ROOM-01-create-room.spec.ts`        |
| AC-ROOM-02 | Room names globally unique         | `POST /rooms`, `PATCH /rooms/{id}`  | —                             | — (rejected)                                 | Room                                            | §6 "Change room name"                    | `AC-ROOM-02-name-uniqueness.spec.ts`    |
| AC-ROOM-03 | Public catalog searchable          | `GET /rooms/public`                 | —                             | —                                            | Room                                            | §6 "View public room catalog"            | `AC-ROOM-03-public-catalog.spec.ts`     |
| AC-ROOM-04 | Private rooms hidden               | `GET /rooms/public`                 | —                             | —                                            | Room                                            | §6 "View private room in public catalog" | `AC-ROOM-04-private-hidden.spec.ts`     |
| AC-ROOM-05 | Public room joinable unless banned | `POST /rooms/{id}/join`             | `room.membership.updated`     | RoomMembership: none → active                | RoomMembership                                  | §6 "Join public room"                    | `AC-ROOM-05-public-join.spec.ts`        |
| AC-ROOM-06 | Banned users cannot join           | `POST /rooms/{id}/join` (rejected)  | —                             | —                                            | RoomBan                                         | §6 "Join public room"                    | `AC-ROOM-06-banned-cannot-join.spec.ts` |
| AC-ROOM-07 | Owner cannot leave                 | `POST /rooms/{id}/leave` (rejected) | —                             | —                                            | RoomMembership                                  | §6 "Leave room"                          | `AC-ROOM-07-owner-cannot-leave.spec.ts` |
| AC-ROOM-08 | Room deletion removes content      | `DELETE /rooms/{id}`                | `room.membership.updated` × N | Chat: active → deleted (soft, 30d then hard) | Room, Chat, Message, Attachment, RoomMembership | §6 "Delete room"                         | `AC-ROOM-08-room-deletion.spec.ts`      |

## 8. Invitations

| AC ID     | Capability                        | HTTP                                                  | WS event                                                        | State transition                                               | Entities                       | Permissions row                     | Playwright test                     |
| --------- | --------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ | ----------------------------------- | ----------------------------------- |
| AC-INV-01 | Only registered users invited     | `POST /rooms/{id}/invitations`                        | —                                                               | RoomInvitation: none → open                                    | RoomInvitation                 | §7 "Invite registered user"         | `AC-INV-01-registered-only.spec.ts` |
| AC-INV-02 | Accept grants membership          | `POST /rooms/{id}/invitations/{id}/accept`            | `room.invitation.created` (consumed), `room.membership.updated` | RoomInvitation: open → accepted; RoomMembership: none → active | RoomInvitation, RoomMembership | §7 "Accept private-room invitation" | `AC-INV-02-accept-invite.spec.ts`   |
| AC-INV-03 | Reject changes nothing else       | `POST /rooms/{id}/invitations/{id}/reject`            | —                                                               | RoomInvitation: open → rejected                                | RoomInvitation                 | §7 "Reject private-room invitation" | `AC-INV-03-reject-invite.spec.ts`   |
| AC-INV-04 | Banned user cannot consume invite | `POST /rooms/{id}/invitations/{id}/accept` (rejected) | —                                                               | —                                                              | RoomInvitation, RoomBan        | §7 "Accept private-room invitation" | `AC-INV-04-banned-invite.spec.ts`   |

## 9. Moderation and roles

| AC ID     | Capability                     | HTTP                                                                     | WS event                                      | State transition                                      | Entities                | Permissions row                 | Playwright test                           |
| --------- | ------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------- | ----------------------- | ------------------------------- | ----------------------------------------- |
| AC-MOD-01 | Owner is always admin          | (invariant)                                                              | —                                             | —                                                     | RoomMembership          | §8 "Remove owner admin status"  | `AC-MOD-01-owner-always-admin.spec.ts`    |
| AC-MOD-02 | Remove = ban                   | `POST /rooms/{id}/members/{uid}/remove`                                  | `room.membership.updated`, `room.ban.updated` | RoomMembership: active → left; RoomBan: none → active | RoomMembership, RoomBan | §8 "Remove member from room"    | `AC-MOD-02-remove-is-ban.spec.ts`         |
| AC-MOD-03 | Admin views ban list           | `GET /rooms/{id}/bans`                                                   | —                                             | —                                                     | RoomBan                 | §8 "View room banned-user list" | `AC-MOD-03-ban-list.spec.ts`              |
| AC-MOD-04 | Admin unbans user              | `DELETE /rooms/{id}/bans/{uid}`                                          | `room.ban.updated`                            | RoomBan: active → removed                             | RoomBan                 | §8 "Unban user from room"       | `AC-MOD-04-unban.spec.ts`                 |
| AC-MOD-05 | Admin removes another admin    | `POST /rooms/{id}/members/{uid}/remove-admin`                            | `room.membership.updated`                     | RoomMembership: role admin → member                   | RoomMembership          | §8 "Remove admin status"        | `AC-MOD-05-admin-removes-admin.spec.ts`   |
| AC-MOD-06 | Owner removes any admin        | `POST /rooms/{id}/members/{uid}/remove-admin`                            | `room.membership.updated`                     | RoomMembership: role admin → member                   | RoomMembership          | §8 "Remove admin status"        | `AC-MOD-06-owner-removes-admin.spec.ts`   |
| AC-MOD-07 | Cannot strip owner admin       | `POST /rooms/{id}/members/{uid}/remove-admin` (rejected if target=owner) | —                                             | —                                                     | RoomMembership          | §8 "Remove owner admin status"  | `AC-MOD-07-owner-admin-protected.spec.ts` |
| AC-MOD-08 | Admin promotes member to admin | `POST /rooms/{id}/members/{uid}/make-admin`                              | `room.membership.updated`                     | RoomMembership: role member → admin                   | RoomMembership          | §8 "Promote member to admin"    | `AC-MOD-08-admin-promotes-member.spec.ts` |

## 10. Messaging and history

| AC ID     | Capability                                | HTTP                                        | WS event          | State transition          | Entities                  | Permissions row                                   | Playwright test                          |
| --------- | ----------------------------------------- | ------------------------------------------- | ----------------- | ------------------------- | ------------------------- | ------------------------------------------------- | ---------------------------------------- |
| AC-MSG-01 | Supported content forms                   | `POST /chats/{id}/messages`                 | `message.created` | Message: none → active    | Message, Attachment       | §9 "Send room message"                            | `AC-MSG-01-content-forms.spec.ts`        |
| AC-MSG-02 | 3 KB size limit                           | `POST /chats/{id}/messages` (rejected)      | —                 | —                         | Message                   | §9 "Send room message"                            | `AC-MSG-02-size-limit.spec.ts`           |
| AC-MSG-03 | Stable ordering                           | `GET /chats/{id}/messages`                  | `message.created` | —                         | Message                   | §9 "View room message history"                    | `AC-MSG-03-ordering.spec.ts`             |
| AC-MSG-04 | Author edits own                          | `PATCH /messages/{id}`                      | `message.edited`  | Message: active → edited  | Message, MessageEditAudit | §9 "Edit own room message"                        | `AC-MSG-04-edit-own.spec.ts`             |
| AC-MSG-05 | Admin deletes other's                     | `DELETE /messages/{id}`                     | `message.deleted` | Message: active → deleted | Message                   | §9 "Delete another user's room message"           | `AC-MSG-05-admin-delete.spec.ts`         |
| AC-MSG-06 | DM participants can't delete each other's | `DELETE /messages/{id}` (rejected)          | —                 | —                         | Message                   | §5 "Delete another user's message in direct chat" | `AC-MSG-06-dm-delete-restricted.spec.ts` |
| AC-MSG-07 | Offline → miss → catch up                 | `GET /chats/{id}/messages`                  | —                 | —                         | Message                   | §9 "View room message history"                    | `AC-MSG-07-offline-catchup.spec.ts`      |
| AC-MSG-08 | Infinite scroll                           | `GET /chats/{id}/messages?beforeSequence=…` | —                 | —                         | Message                   | §9 "View room message history"                    | `AC-MSG-08-infinite-scroll.spec.ts`      |

## 11. Realtime delivery and continuity

| AC ID    | Capability               | HTTP                                       | WS event                               | State transition               | Entities                         | Permissions row | Playwright test                        |
| -------- | ------------------------ | ------------------------------------------ | -------------------------------------- | ------------------------------ | -------------------------------- | --------------- | -------------------------------------- |
| AC-RT-01 | No REST polling          | —                                          | `message.created`                      | —                              | —                                | —               | `AC-RT-01-realtime-delivery.spec.ts`   |
| AC-RT-02 | Hybrid recovery          | `GET /chats/{id}/messages`, `sync.request` | `sync.response`                        | —                              | Message                          | —               | `AC-RT-02-hybrid-recovery.spec.ts`     |
| AC-RT-03 | Next chat-local sequence | `POST /chats/{id}/messages`                | `message.created`                      | Chat.current_sequence: N → N+1 | Chat, Message                    | —               | `AC-RT-03-sequence-allocation.spec.ts` |
| AC-RT-04 | Gap repair               | `GET /chats/{id}/messages?afterSequence=…` | `sync.response`                        | —                              | Message                          | —               | `AC-RT-04-gap-repair.spec.ts`          |
| AC-RT-05 | Dedup/reorder tolerance  | —                                          | `message.created` (duplicated in test) | —                              | —                                | —               | `AC-RT-05-dedup.spec.ts`               |
| AC-RT-06 | No unbounded backlog     | —                                          | —                                      | —                              | (in-memory OutboundSocketBuffer) | —               | `AC-RT-06-bounded-buffer.spec.ts`      |

## 12. Attachments

| AC ID        | Capability                                | HTTP                                                              | WS event                      | State transition                                     | Entities                            | Permissions row                                                | Playwright test                            |
| ------------ | ----------------------------------------- | ----------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| AC-ATT-01    | Upload within limits                      | `POST /chats/{id}/attachments`                                    | `message.created` (if linked) | Attachment: none → active                            | Attachment, Message                 | §10 "Upload file/image to room"                                | `AC-ATT-01-upload.spec.ts`                 |
| AC-ATT-02    | Oversized rejected                        | `POST /chats/{id}/attachments` (rejected `PAYLOAD_TOO_LARGE`)     | —                             | —                                                    | —                                   | §10                                                            | `AC-ATT-02-oversize-rejected.spec.ts`      |
| AC-ATT-03    | Auth based on current state               | `GET /attachments/{id}/download` (rejected after membership loss) | —                             | —                                                    | Attachment, RoomMembership, RoomBan | §10 "Access previously uploaded file after losing room access" | `AC-ATT-03-current-auth.spec.ts`           |
| AC-ATT-04    | Room deletion removes attachments         | `DELETE /rooms/{id}`                                              | —                             | Attachment: active → deleted (soft, then hard-purge) | Attachment, Chat                    | §10 "Delete attachment by deleting containing room"            | `AC-ATT-04-room-deletion-cleanup.spec.ts`  |
| AC-ATTACH-05 | No file-type restriction                  | `POST /chats/{id}/attachments`                                    | —                             | —                                                    | Attachment                          | §10                                                            | `AC-ATTACH-05-no-type-restriction.spec.ts` |
| AC-ATTACH-06 | Filename preserved, sanitized on download | `POST /chats/{id}/attachments`, `GET /attachments/{id}/download`  | —                             | —                                                    | Attachment                          | §10 "View original filename"                                   | `AC-ATTACH-06-filename-handling.spec.ts`   |

## 13. Unread state

| AC ID        | Capability               | HTTP                                        | WS event                                  | State transition                                               | Entities               | Permissions row                            | Playwright test                         |
| ------------ | ------------------------ | ------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- | ---------------------- | ------------------------------------------ | --------------------------------------- |
| AC-UNREAD-01 | Room unread indicator    | `GET /chats/{id}/read-state` (or bootstrap) | `readstate.updated`, `message.created`    | —                                                              | ChatReadState, Message | §11 "See unread indicator for room"        | `AC-UNREAD-01-room-indicator.spec.ts`   |
| AC-UNREAD-02 | DM unread indicator      | `GET /chats/{id}/read-state`                | `readstate.updated`, `message.created`    | —                                                              | ChatReadState, Message | §11 "See unread indicator for direct chat" | `AC-UNREAD-02-dm-indicator.spec.ts`     |
| AC-UNREAD-03 | Explicit advance on open | `POST /chats/{id}/read`                     | `readstate.updated`                       | ChatReadState: lazy-created or updated; `last_read_sequence` ↑ | ChatReadState          | §11 "Clear unread by opening chat"         | `AC-UNREAD-03-explicit-advance.spec.ts` |
| AC-UNREAD-04 | Multi-tab consistency    | `POST /chats/{id}/read` (one tab)           | `readstate.updated` (all user's sessions) | —                                                              | ChatReadState          | §11                                        | `AC-UNREAD-04-multitab.spec.ts`         |

## 14. UI behavior

UI ACs are exercised primarily through Playwright and may not involve a specific backend endpoint.

| AC ID    | Capability                         | HTTP                      | WS event          | State transition | Entities | Permissions row | Playwright test                     |
| -------- | ---------------------------------- | ------------------------- | ----------------- | ---------------- | -------- | --------------- | ----------------------------------- |
| AC-UI-01 | Standard chat layout               | —                         | —                 | —                | —        | —               | `AC-UI-01-chat-layout.spec.ts`      |
| AC-UI-02 | Autoscroll at bottom               | —                         | `message.created` | —                | —        | —               | `AC-UI-02-autoscroll.spec.ts`       |
| AC-UI-03 | No forced autoscroll while reading | —                         | `message.created` | —                | —        | —               | `AC-UI-03-no-forced-scroll.spec.ts` |
| AC-UI-04 | Moderation via menus/dialogs       | Various `/rooms/{id}/...` | —                 | —                | —        | §8              | `AC-UI-04-moderation-ui.spec.ts`    |

## 15. Coverage invariants (CI-enforced)

The `doc-consistency.yml` workflow asserts:

- **Every AC ID in `acceptance-criteria-pack.md`** appears exactly once in this table (no missing rows, no duplicates).
- **Every API path in `api-and-events.md` §5** is cited by at least one row here, OR is explicitly marked as infrastructure-only in a `docs/infrastructure-endpoints.md` allowlist (currently none).
- **Every WebSocket event type in `api-and-events.md` §6.4** is cited by at least one row here.
- **Every Playwright test name in this table** has a matching test file in `e2e/`.

Drift between this table and the other docs is treated as a merge-blocking error.
