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

ACs held for follow-up PRs in the same workstream:

- **AC-ROOM-02** — covered by AC-ROOM-01 handler; the duplicate-name test
  adds a second test case on the same endpoint.
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
`truncate`; `upsert` remains deferred to WS-08. Seed shape extended to
create friendships, blocks, room memberships against the new tables so
future AC tests can reuse it.
