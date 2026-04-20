# WS-05 autorun progress — 2026-04-20

Branch: `feature/WS-05-autorun-20260420`

## This session (fourth slice) — AC-AUTH-04 self-socket drop spec

### Scope

The server code for AC-AUTH-04 WS was already in place:
`apps/api/src/modules/auth/routes.ts` calls
`publishSessionRevoked({ sessionId: current.session.id })` on every
`POST /auth/logout`. What was still missing was a Playwright
assertion that the caller's own WS socket actually receives the
event and closes with code `4440` — so the behaviour is locked in
against regressions.

### Files touched

- `e2e/specs/AC-AUTH-04-ws-self-drop.spec.ts` (new) — mirrors the
  `AC-AUTH-06-ws-drop.spec.ts` layout. Tab A calls `POST /auth/logout`;
  its socket must receive `session.revoked` with the caller's
  session id and then close with `4440`. Tab B (a second live
  session of the same user) stays open to prove the revocation is
  session-scoped, not user-scoped.
- `docs/traceability.md` — new AC-AUTH-04 (WS portion) implementation
  line; deferred list drops the self-socket-drop item.

### Design notes

- No product code change. The route-level call to
  `publishSessionRevoked` landed in an earlier slice (line 125 of
  `routes.ts`); the `publishSessionRevoked` helper already delivers
  `deliverOrDrop` + close for every socket in
  `socketsForSession(sessionId)`, which covers any additional tabs
  the same session id happens to hold. The spec proves the wire
  behaviour end-to-end.
- Kept the file pattern `AC-AUTH-04-ws-self-drop.spec.ts` — distinct
  from the HTTP-only `AC-AUTH-04-logout-scope.spec.ts` — so the
  Playwright AC-matcher can recognise both as AC-AUTH-04 coverage.

## Previous slice (third, 2026-04-20) — AC-ROOM-08 fan-out

### Scope (third slice)

Close the last known-missing event emission in the WS-05 deferred list:
`DELETE /rooms/{id}` must fan `room.membership.updated: 'left'` to every
user that was an active member at delete time. Previously deferred with
the note that it "clusters with the 30-day hard-purge job"; in practice
the fan-out is orthogonal to purge — it just needs an active-membership
snapshot at commit time.

### Files touched

- `apps/api/src/modules/rooms/repository.ts` — `softDeleteRoom` now
  returns `{ok, members}` instead of a bare boolean. The members array
  is the `(userId, role)` snapshot taken inside the same transaction
  that flips `rooms.deletedAt` so a concurrent join cannot slip in
  between the snapshot read and the tombstone write.
- `apps/api/src/modules/rooms/service.ts` — `deleteRoom` iterates the
  returned members and publishes one `room.membership.updated` event
  per member via the existing publisher. Published post-commit inside
  the request-scope so the HTTP 200 and the events arrive on the same
  tick.
- `e2e/specs/AC-ROOM-08-ws-events.spec.ts` (new) — owner subscribes to
  the chat and receives the three events (one per member) via the
  subscriber path; two non-subscribing member sockets each receive the
  single event where they are the subject, exercising the subject
  path of `fanOutRoomEventIncludingSubject`.
- `docs/traceability.md` — AC-ROOM-08 WS portion now listed as
  implemented; deferred list drops it and annotates the remaining
  items.

### Design notes

- The snapshot is taken inside the transaction rather than with a
  separate repository query so there is no read-write race. A public
  room could otherwise accept a `POST /rooms/:id/join` after the
  service's `findRoomByChatId` preflight but before the soft-delete
  lands. Folding the member read into the same tx serializes them
  against the row-level lock the `UPDATE rooms … deletedAt` takes.
- The subject path of `fanOutRoomEventIncludingSubject` is the
  load-bearing delivery mechanism: once the chat is soft-deleted the
  subscriber path still reaches current subscribers (the socket's
  `subscriptions` set doesn't auto-clear), but a non-subscribing tab
  only learns about the deletion via the subject path. The spec
  asserts both paths by subscribing one socket (owner) and not
  subscribing the other two (bob, carol).
- Preferred not to emit `room.ban.updated` for this path — delete is
  not a ban, and conflating the two would tempt UI code to surface a
  ban warning where there isn't one. Membership transitions to `left`
  with the member's original role, which is enough for the UI to
  remove the room from its sidebar and preserve the historical role
  label if it needs to.

### Still deferred within WS-05

- **AC-RT-05** — client-side dedup. Server-side guarantees remain
  intact (persist-before-publish, chat-local sequence allocation);
  reconciliation contract lives in WS-07.
- **AC-AUTH-04 self-socket drop** — implementation already in place
  (`publishSessionRevoked` at `apps/api/src/modules/auth/routes.ts`
  line 125 on `POST /auth/logout`); the outstanding work is a
  test-only assertion that the caller's own WS socket receives the
  event before close. Polish follow-up.
- **`session.revoked` for AC-AUTH-07 password-change** — unchanged;
  still blocked on a WS-02 `changePassword()` service-surface change
  to return the list of revoked sibling session ids.

---

## Previous slice (second, 2026-04-20) — room event fan-out

### Scope (second slice)

Wire the three `room.*` WebSocket events documented in
`docs/api-and-events.md` §6.4 through the existing WS-03 HTTP endpoints
so realtime clients can reflect invitation / membership / ban changes
without polling. The HTTP layer is already owned and tested by WS-03;
this slice is pure event-emission layering.

1. `room.invitation.created` — targeted fan-out to the invitee's own
   sockets on `POST /rooms/{id}/invitations`.
2. `room.membership.updated` — subscriber-plus-subject fan-out on
   join / leave / remove / make-admin / remove-admin / accept-invite.
3. `room.ban.updated` — subscriber-plus-subject fan-out on
   remove-member (isBanned=true) and unban (isBanned=false).

### Files touched

- `packages/shared-schemas/src/schemas/events.ts` — three new TypeBox
  event schemas (`RoomInvitationCreated`, `RoomMembershipUpdated`,
  `RoomBanUpdated`) with payload unions for membership state and role.
- `apps/api/src/modules/realtime/types.ts` — add the three new events
  to the `OutboundEvent` discriminated union.
- `apps/api/src/modules/realtime/bus.ts` — new
  `fanOutRoomEventIncludingSubject` helper plus
  `publishRoomInvitationCreated` / `publishRoomMembershipUpdated` /
  `publishRoomBanUpdated` exported publishers.
- `apps/api/src/modules/realtime/index.ts` — export the new publishers.
- `apps/api/src/modules/rooms/service.ts` — call the publishers in the
  post-commit path of `joinPublicRoom`, `leaveRoomAsMember`,
  `removeMember`, `unbanRoomUser`, `makeMemberAdmin`,
  `removeAdminStatus`, `createRoomInvitation`, and `acceptInvitation`.
  Idempotent no-op branches (e.g. making an already-admin an admin) do
  not publish — nothing changed, nothing to broadcast.
- `e2e/specs/AC-MOD-08-ws-events.spec.ts` — make-admin delivers
  `room.membership.updated` to both the subscribing owner and the
  (non-subscribing) promoted member's own socket.
- `e2e/specs/AC-MOD-02-ws-events.spec.ts` — remove-as-ban delivers
  both `room.membership.updated` and `room.ban.updated` to the
  subscribing owner.
- `e2e/specs/AC-INV-01-ws-events.spec.ts` — invitation fires to the
  invitee only; a room-subscriber bystander does NOT receive it.
- `docs/traceability.md` — completion notes for the three events and a
  refreshed "deferred within WS-05" list (AC-RT-05, self-socket drop
  on AC-AUTH-04, `session.revoked` fan-out for AC-AUTH-07, and
  `room.membership.updated × N` fan-out on AC-ROOM-08 deletion).

### Design notes

- Audience: the product spec reserves `room.invitation.created` for
  the invitee (leaking it to room subscribers would disclose that a
  private account-to-room relationship exists). The other two events
  are subscriber-scoped but ALSO reach the affected user's sockets so
  the subject's UI can react even when that tab isn't subscribed to
  the room — a catalog-only tab still needs to learn it was removed.
  The union is de-duplicated per socket.
- No per-event authorization re-check in
  `fanOutRoomEventIncludingSubject`. Unlike `message.created`, where a
  revoked access window can still deliver fresh content, the room
  events are the VERY EVENT that announces the revocation. Re-checking
  would suppress the single frame the subject needs to see.
- Publishers are synchronous (no `await`). They run after the
  service's transactional commit and before the HTTP handler returns,
  so e2e tests see the event before the HTTP response resolves.
- Test-mode `WEBSOCKET_STALE_TIMEOUT_MS=2500` made the tests
  borderline flaky: any ws that doesn't command within 2.5s gets
  swept by `runPresenceScan`. The three new specs send an explicit
  `presence.heartbeat` or `chat.subscribe` before the HTTP call to
  keep the stale clock fresh; matches the pattern established by
  AC-RT-01.

### Still deferred within WS-05

- **AC-RT-05** — client-side dedup. Server-side guarantees remain
  intact (persist-before-publish, chat-local sequence allocation);
  the reconciliation contract lives in WS-07.
- **AC-AUTH-04 self-socket drop** — cosmetic. HTTP already clears the
  caller's cookie; a future polish slice can add
  `publishSessionRevoked` to the self path.
- **`session.revoked` for AC-AUTH-07 password-change** — needs WS-02's
  `changePassword()` service to return the list of revoked sibling
  session ids so the route handler can publish. Small service-surface
  change, held for a WS-02 follow-up.
- **AC-ROOM-08 `room.membership.updated × N`** — enumerating every
  active member at delete time is outside the natural path of the
  soft-delete handler. Clusters with the 30-day hard-purge job held
  for WS-08.

---

## Previous slice (first slice, 2026-04-20) — AC-PRES-01..04 (multi-tab presence)

- Added per-socket `lastHeartbeatAt` / `lastActivityAt` and
  `computeUserPresence` / `runPresenceScan` in
  `apps/api/src/modules/realtime/presence.ts`.
- Observer fan-out (self + active friends + co-room members) lives in
  `apps/api/src/modules/realtime/presence-observers.ts`.
- Gateway now handles `presence.heartbeat` / `presence.activity`
  commands and publishes `presence.updated` on connect and close.
- Stale sockets are closed with close code 4410
  (`WS_CLOSE_CODES.STALE_CONNECTION`) by the 5s sweep.
- `compose.test.yaml` compresses 60s/45s defaults to 1.5s/2.5s so
  Playwright specs exercise the timers in realistic test time.
- Specs: AC-PRES-01 (multi-tab online), AC-PRES-02 (afk), AC-PRES-03
  (offline on disconnect), AC-PRES-04 (hibernation sweep).
- Unit coverage: `apps/api/test/unit/realtime/presence.test.ts`.

## Still deferred within WS-05

- **AC-RT-05** — client-side dedup. Server guarantees
  persist-before-publish + chat-local sequence allocation, so there's
  no additional server behaviour to land. Reconciliation lives in
  WS-07.
- **AC-AUTH-04 self-socket drop** — cosmetic. HTTP response already
  clears the caller's cookie; a polish slice can add
  `publishSessionRevoked` to the self path without any user-facing
  change.
- **`session.revoked` for AC-AUTH-07 password-change** — the service
  revokes sibling sessions but doesn't yet thread the list of revoked
  session ids back to the route handler for publishing. WS-02 service
  surface change.
- **`room.invitation.created` / `room.membership.updated` /
  `room.ban.updated`** — WS-03 moderation / invitation endpoints
  landed in #39 (`feature/WS-03-autorun-*`). Wiring the publishers
  through those handlers is a small follow-up slice but not part of
  this session's scope.

---

## Previous session — 2026-04-19

Branch: `feature/WS-05-autorun-20260419`

## Completed in prior PR (#28, merged to develop)

PR #28 landed the realtime backbone: websocket gateway, event envelope,
per-chat fan-out, bounded outbound buffer (AC-RT-06), read-state fan-out
(AC-UNREAD-04), and session-revoked fan-out + live-socket drop for
`POST /auth/logout` and `POST /auth/logout-session` (AC-AUTH-06 WS
portion). `message.edited` / `message.deleted` fan-out on the existing
HTTP paths completes the WS portion of AC-MSG-04 / AC-MSG-05.

## This PR — AC-RT-02 + AC-RT-04 (sync.request / sync.response)

### Scope

Add the server half of the hybrid recovery contract documented in
`docs/api-and-events.md` §6.2:

1. `sync.request` client command with the shape
   `{ chatId, lastKnownContiguousSequence, lastKnownReadSequence }[]`
   and a 200-entry cap.
2. `sync.response` server event — a single event per command, matched by
   `replyToCommandId`. Per-chat advice is one of `in-sync`,
   `fetch-history` (with an inclusive `rangeHint`), or
   `chat-inaccessible`.
3. Per-entry access re-check so former members / DM participants get
   `chat-inaccessible` rather than leaking headSequence.

### Files touched

- `packages/shared-schemas/src/schemas/events.ts` — add
  `SyncRequestCommandSchema`, `SyncResponseEventSchema`, related payload
  types, and export the 200-chat cap as `SYNC_REQUEST_MAX_CHATS`.
- `apps/api/src/modules/realtime/sync.ts` (new) — per-chat advice
  computation.
- `apps/api/src/modules/realtime/gateway.ts` — wire `sync.request` into
  the existing command dispatcher; parse + validate payload, emit
  `sync.response` via the bounded-buffer `deliverOrDrop` path.
- `apps/api/src/modules/realtime/types.ts` — extend `OutboundEvent` with
  `SyncResponseEvent`.
- `e2e/specs/AC-RT-02-hybrid-recovery.spec.ts` (new) — three cases:
  fetch-history with a real HTTP history follow-up, in-sync, and
  chat-inaccessible.
- `e2e/specs/AC-RT-04-gap-repair.spec.ts` (new) — two cases: gap in the
  middle (watermark=2, head=5) and oversized command rejected with
  `VALIDATION_ERROR`.
- `docs/traceability.md` — completion notes for AC-RT-02 / AC-RT-04 and
  removal of the deferred entries for those rows.

### Design notes

- Per-chat advice is computed sequentially, not in parallel, so a
  caller cannot fan out a 200-chat sync request into 200 simultaneous
  DB hits. Under reconnect load the latency hit is accepted.
- `sync.response` flows through the same bounded-buffer
  `deliverOrDrop` path as domain events so a client that spams
  `sync.request` without reading gets closed with the slow-consumer
  code just like any other burst.
- Duplicate `chatId` entries within one `sync.request` are rejected as
  `VALIDATION_ERROR` rather than silently coalesced — the server has no
  policy for which stale watermark to honour, so the client must
  de-duplicate before sending.
- No server-side coalescing of overlapping sync.request commands is
  done yet (the contract says the server MAY coalesce). The client is
  expected to rely on `replyToCommandId` to pair request/response; we
  haven't measured a case where multiple parallel sync requests from
  the same socket actually hit the server.

### Still deferred within WS-05

- **AC-PRES-01..04** (multi-tab presence aggregation) — needs a presence
  store, heartbeat timers, and a tab registry. Separable work; landed
  after the backbone proves stable.
- **AC-RT-05** — the client-side dedup obligation. The server already
  guarantees persist-before-publish plus chat-local sequence
  allocation, so duplicate / reordered fan-out would be a server bug,
  not a design gap. The client-side rendering reconciliation lives in
  WS-07.
- **room.invitation.created / room.membership.updated / room.ban.updated**
  — WS-03 hasn't landed invitations, bans, membership transitions, or
  moderation endpoints yet. Event emission lands with those HTTP paths
  (expected in the next WS-03 autorun), not separately here.
- **AC-AUTH-07 password-change `session.revoked` fan-out** — the
  password-change service revokes sibling sessions but doesn't yet
  thread the list of revoked session ids back to the route handler, so
  the HTTP layer has nothing to publish.

## Interfaces handed to other workstreams

- WS-07 client reconciler: connect to `GET /ws` with the session cookie
  + CSRF token header; after reconnect, issue one `sync.request` with
  the per-visible-chat watermarks and process the advice in the single
  `sync.response` event. For chats with `advice = 'fetch-history'`,
  call `GET /chats/{chatId}/messages?afterSequence=fromSequence - 1`
  until the response reaches `toSequence`. For
  `advice = 'chat-inaccessible'`, drop the local state for that chat.
- WS-08 reconnect tests: the sync path is authoritative and can be
  exercised end-to-end via the `ws` npm client (see the two new
  Playwright specs for reference wire shapes).
- WS-08: integration tests drive the websocket via the `ws` npm client.
  The `/ws` endpoint honours the same CSRF/session rules as REST
  state-changing routes, so tests can re-use the existing `register()` /
  `login()` helpers.

## Files likely touched

- `packages/shared-schemas/src/schemas/events.ts` (new)
- `packages/shared-schemas/src/index.ts` (export)
- `apps/api/src/modules/realtime/` (new module)
- `apps/api/src/modules/messages/service.ts` (publish hook)
- `apps/api/src/modules/auth/service.ts` (session.revoked publish hook)
- `apps/api/src/routes/index.ts` (register plugin)
- `apps/api/package.json` (new deps: `@fastify/websocket`, `ws`, `@types/ws`)
- `e2e/specs/AC-RT-01-realtime-delivery.spec.ts` (new)
- `e2e/specs/AC-UNREAD-04-multitab.spec.ts` (new)
- `e2e/specs/AC-RT-06-bounded-buffer.spec.ts` (new)
- `docs/traceability.md` (update status lines)
- `docs/api-and-events.md` (no contract changes — already documented)
