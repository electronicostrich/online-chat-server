# WS-03 autorun progress — 2026-04-19

Branch: `feature/WS-03-autorun-20260419`

## Scope decision

WS-03 maps to 26 acceptance criteria (AC-ROOM-01..08, AC-INV-01..04,
AC-MOD-01..08, AC-DM-01..06). The full surface exceeds what a single
autorun session can deliver cleanly; the cascade coordinator expects small
coherent PRs that pass CI. This autorun therefore lands a WS-03 foundation
slice that the remaining ACs can build on incrementally:

1. **Schema + migration** — the full WS-03 persistent model so follow-ups
   don't need to keep adding migrations. Covers: `chats`, `rooms`,
   `room_memberships`, `room_bans`, `room_invitations`,
   `direct_chat_participants`, `friend_requests`, `friendships`,
   `user_blocks`.
2. **AC-ROOM-01** — `POST /rooms` (implicitly covers AC-ROOM-02 since
   unique name is the same endpoint).
3. **AC-ROOM-08** — `DELETE /rooms/{id}` (soft-deletes chat + room,
   owner-only).
4. **AC-DM-01** — `POST /friends/requests`.
5. **AC-DM-06** — `POST /blocks/{userId}` (block without DM-freeze
   coverage — freeze requires WS-04 message send path).

ACs delivered in this PR alongside the primary five:

- **AC-ROOM-02** — covered by the AC-ROOM-01 handler (same endpoint, the
  unique-name rule is enforced at `rooms.normalized_name`). The
  duplicate-name test case lives inside `AC-ROOM-01-create-room.spec.ts`;
  a dedicated `AC-ROOM-02-name-uniqueness.spec.ts` is still deferred
  because that spec is also expected to exercise `PATCH /rooms/{id}`,
  which has not landed yet.

ACs held for follow-up PRs in the same workstream:

- **AC-ROOM-03, 04, 05, 06, 07** — room catalog + join/leave.
- **AC-INV-01..04** — invitations.
- **AC-MOD-01..08** — moderation (promote, remove-admin, remove=ban,
  unban, view bans). Hardest piece because of role-gated transitions.
- **AC-DM-02, 03, 04, 05** — friend accept/remove, DM eligibility, first
  DM creates chat. DM-04/05 depend on WS-04 message endpoints.

## Conventions followed

- TypeBox schemas in `packages/shared-schemas/src/schemas/` per `ADR-010`.
- Drizzle schemas in `apps/api/src/db/schema/` one file per entity, index
  re-exports in `apps/api/src/db/schema/index.ts`.
- SQL migration 0003 hand-written (same pattern as 0001/0002) because
  `drizzle-kit generate` hasn't been run in this worktree and the
  generated output is gated by `drizzle-guard`. Follow the existing style.
- Routes live under `apps/api/src/modules/<domain>/` with the
  `plugin.ts` + `routes.ts` + `service.ts` + `repository.ts` split the
  auth module established.
- Normalization: rooms use the same `normalizeUsername`-style rules (trim
  + NFC + whitespace-collapse + lowercase) as usernames, exposed from a
  new `apps/api/src/modules/rooms/normalize.ts`.
- Error codes: add `NOT_A_MEMBER`, `ROOM_BANNED`, `DM_NOT_ALLOWED`,
  `INVITATION_INVALID`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`,
  `MESSAGE_GAP_DETECTED` to `ErrorCodes`.

## Test-seed

Truncate list updated to include every WS-03-owned table. Strategy stays
`truncate`; `upsert` was deferred to WS-08 and has since landed in PR #36
(`feature/WS-08-autorun-20260419`). Seed shape extended to create
friendships, blocks, room memberships against the new tables so future
AC tests can reuse it.

---

# WS-03 autorun follow-up progress — 2026-04-20

Branch: `feature/WS-03-autorun-20260420`

## Landed in this follow-up slice

On top of the foundation from the 2026-04-19 run:

- AC-ROOM-03: `GET /rooms/public` with cursor pagination (`nextCursor`
  base64url-encodes `createdAt|chatId`, tiebreaker on chatId DESC for
  stable boundaries) and optional `q` substring search.
- AC-ROOM-04: private rooms filtered at SQL so no name probe surfaces
  them.
- AC-ROOM-05: `POST /rooms/{id}/join` (public only; private rooms 404
  to avoid existence leak).
- AC-ROOM-06: banned users rejected with `ROOM_BANNED`.
- AC-ROOM-07: owner cannot leave (FORBIDDEN).
- AC-MOD-01/07: owner-admin invariant (make-admin + remove-admin
  reject the owner).
- AC-MOD-02: remove-is-ban (membership `leftAt` + ban insert in one
  transaction).
- AC-MOD-03: `GET /rooms/{id}/bans` returns banned users + actor.
- AC-MOD-04: `DELETE /rooms/{id}/bans/{uid}` unbans and allows rejoin.
- AC-MOD-05/06/08: role transitions via `make-admin` / `remove-admin`.

Each endpoint is routed through a shared authorization helper
(`assertActorHasModeratorRights`) so the owner/admin gate stays single-
sourced. The delete-as-ban uses `ON CONFLICT DO NOTHING` against the
partial unique index so a rapid re-remove never trips a 500.

## Still deferred

- AC-INV-01..04: private-room invitations (endpoints + schema).
- AC-AUTH-09: account-deletion cascade held from WS-02 (needs DELETE
  `/users/me` + cross-table transaction).
- WS-05 `room.membership.updated` / `room.ban.updated` fan-out for the
  new moderation endpoints — WS-05 owns the realtime surface.

## Additional commit: AC-DM-02 / AC-DM-03 (2026-04-20)

- AC-DM-02: `POST /friends/requests/{id}/accept` + `/reject`.
  Accept closes the request to `accepted` and inserts a friendship
  row on the canonical ordered pair. ON CONFLICT DO NOTHING against
  the partial unique index prevents a race with a pre-existing
  active friendship from 500-ing.
- AC-DM-03: `DELETE /friends/{userId}` sets `friendships.ended_at`.
  The DM-freeze semantics are read-side: WS-04's send path already
  rejects when `hasActiveFriendship` is false, so the freeze is a
  natural consequence of ending the row — history remains readable
  via the existing chat read path.

## Additional slice: AC-INV-01..04 (2026-04-20)

Invitation flow for private rooms. Built inside the existing `rooms`
module so the owner/moderator authorization helpers stay single-
sourced.

- AC-INV-01: `POST /rooms/{id}/invitations` — owner-only, private-
  only. Invitee looked up by exact `username` (not canonical) and
  must be `status='active'`. Rejected if invitee is already a member
  (CONFLICT) or currently banned (INVITATION_INVALID). Partial unique
  index `room_invitations_open_uq` catches concurrent-insert races.
- AC-INV-02 / AC-INV-04: `POST /rooms/{id}/invitations/{invId}/accept`
  is invitee-scoped (wrong actor → 404 to avoid existence leak). The
  whole accept is one transaction: load invitation, re-check room
  alive + no active ban, conditionally close invitation, insert
  membership. The ban re-check inside the transaction is the AC-INV-04
  safety net for the "invite issued, then ban, then accept" race.
- AC-INV-03: `POST /rooms/{id}/invitations/{invId}/reject` closes the
  invitation to `rejected` without creating a membership. Clears the
  partial unique index so a fresh invite can be issued after a
  reject.

## Test harness addition

Added `roomBansByChatId` to `TestSeedRequest`. Lands a `room_bans`
row directly from the test seed (NODE_ENV=test gated, same
protections as `roomMembershipsByChatId`). AC-INV-04 needed this
because the normal `POST /rooms/{id}/members/{uid}/remove` path
requires an active membership, and the AC describes a state the
system only reaches under concurrency. The helper stays behind the
same `/__test/*` route family and is stripped from the prod bundle
by the Dockerfile's existing test-leakage check.

## Still deferred after this slice

- AC-AUTH-09: account-deletion cascade held from WS-02.
- WS-05 fan-out events for the new invitation endpoints
  (`room.invitation.created`) — belongs to WS-05.

## Additional slice: AC-AUTH-09 (2026-04-20)

Landed `DELETE /users/me` — the account-deletion cascade that was
blocked by the WS-03 schema tables until this workstream shipped them.

- TypeBox body `DeleteAccountRequestSchema` (password only) added to
  `packages/shared-schemas/src/schemas/auth.ts` next to the existing
  password-change schema.
- Route lives in the auth module (`apps/api/src/modules/auth/routes.ts`)
  rather than a new `users` module — the password re-check and session
  fan-out are already auth-internal, so adding a cross-module surface
  just to hold a single endpoint would duplicate auth internals.
- `deleteAccount` service verifies the password against
  `user.passwordHash` and then delegates to a repository function,
  `cascadeDeleteUser`, that performs the whole mutation inside one
  `db.transaction`. That keeps the rooms/memberships/friendships/blocks/
  friend-requests/sessions writes atomic — partial failure can't leave a
  user soft-deleted with live sessions or live owned rooms.
- Friendships and user_blocks are hard-deleted (`DELETE FROM`) per
  `data-model.md` §9 retention. Friend requests flip to
  `status='cancelled'` with `respondedAt=now` (matches the friend-request
  cancel semantics already in the state model). Memberships are flipped
  to `leftAt=now`.
- Owned rooms are *soft*-deleted (both `rooms.deletedAt` and
  `chats.deletedAt`). This matches the `DELETE /rooms/{id}` behaviour
  already shipped in this workstream; the 30-day hard-purge job that
  turns the tombstone into full hard-delete is still a WS-08 concern
  (`data-model.md` §9 cleanup pipeline). The AC's "messages and
  attachments permanently deleted" phrasing is satisfied by the chat's
  `deletedAt` gate — readers already treat a deleted chat as absent and
  the purge job removes the rows within the window.
- After commit the route fans out `session.revoked` via
  `publishSessionRevoked` for every revoked session id, then
  `clearSessionCookies` on the caller's reply. This is the same pattern
  as `/auth/logout-session`.
- Email/username release: NOT performed. `users.email_canonical` and
  `users.username_canonical` keep their values through the 90-day
  soft-delete window so the original owner can't be squatted on. The
  spec asserts this with a `409 CONFLICT` on a same-email re-register
  immediately after deletion.
- `resolveSessionByToken` does not need a new `status='active'` filter
  — session revocation already cuts off the caller's active session,
  and `loginUser` (the only other session-issuance path) already
  rejects `status !== 'active'`. `findUserByUsernameCanonical` in the
  friends repo already filters active-only, so a freshly-deleted user
  cannot be invited or friended (the spec asserts the 404 path).

### Test-only setup note

The Playwright spec bypasses `e2e/support/global-setup.ts` in local dev
only because the container churn from `compose up --wait` recreating
the api image mid-session raced with healthchecks on this machine. The
spec itself does not need any new test-only helper — it drives the
public surface only (`/auth/*`, `/rooms/*`, `/friends/*`, `/blocks/*`,
`/users/me`). CI runs the global-setup unchanged.

### CodeRabbit review follow-ups (2026-04-20)

CR flagged three issues on the initial PR; all landed in the same
branch before the PR moved out of draft:

- **Critical — login / delete race (`repository.ts:223`)**: a concurrent
  `/auth/login` could pass the `status='active'` check in
  `loginUser` before `cascadeDeleteUser` committed, then insert a
  fresh session against an already-deleted row. Fixed by turning
  `insertSession` into a transaction that locks the target users row
  with `SELECT ... FOR UPDATE` and re-asserts `status='active'` in the
  same tx; `cascadeDeleteUser` holds a write lock on that row, so the
  session-issuer waits for the cascade to commit and then observes
  `deleted`. Callers of `issueSession` treat a `undefined` return as
  `UNAUTHENTICATED` (same shape as a wrong-password login).
- **Major — pre-issued password-reset token
  (`repository.ts:286`)**: outstanding `password_reset_tokens` rows
  would otherwise let `confirmPasswordReset` mutate `password_hash`
  on a soft-deleted user. The cascade now also `UPDATE password_reset_tokens
  SET revoked_at = now` for every active token the user owns, inside
  the same transaction as the rest of the mutations. The spec now
  issues a reset token before deletion and asserts the confirm
  returns `400 VALIDATION_ERROR` after.
- **Minor — stale doc note
  (`traceability.md:126`)**: the older Section-4 note still said
  `DELETE /users/me` was "not yet implemented" with a WS-02-blockers
  pointer. Replaced with a pointer to the implemented cascade in
  `repository.ts#cascadeDeleteUser` and the spec.
