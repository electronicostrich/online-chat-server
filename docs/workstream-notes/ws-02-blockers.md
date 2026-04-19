# WS-02 autorun — open blockers / deferred items

## AC-AUTH-09 — account deletion cascade (NOT implemented)

The acceptance criterion requires that deleting an account also removes the
user's owned rooms, memberships, friendships, blocks, and friend requests,
and revokes all sessions (see `docs/api-and-events.md` §5.1 "DELETE /users/me"
side effects). Only the last of those is a WS-02 concern — every other
cascade target is owned by WS-03 (Core Chat Domain: Rooms, Membership,
Relationships) per `docs/workstreams/proposed-workstreams.md`.

What WS-02 could deliver in isolation (soft-delete user + revoke sessions)
would not satisfy AC-AUTH-09: the AC is specifically about the cascade.
Implementing the endpoint with stubs for rooms/friendships/blocks would
either:
- quietly diverge from the spec (rooms survive, memberships linger); or
- touch tables that WS-03 owns and will re-model, guaranteeing merge
  conflicts when WS-03 lands.

### Decision

AC-AUTH-09 is held for the WS-03 merge. Once WS-03 ships `rooms`,
`room_memberships`, `room_bans`, `friendships`, `friend_requests`, and
`user_blocks`, a follow-up PR owned by either workstream can implement the
single-transaction cascade described in the API doc. The service-layer
scaffolding landed in WS-02 (`AuthError`, `revokeAllSessionsForUser`,
canonical normalization) will be reusable.

### Notes for the human reviewer / next session

- The corresponding row in `docs/traceability.md` was left as-is (no
  implementation marker) so the AC still shows as open work.
- `POST /auth/password-reset/confirm` already exercises
  `revokeAllSessionsForUser`, which is the session half of AC-AUTH-09.
