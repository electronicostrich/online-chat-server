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
