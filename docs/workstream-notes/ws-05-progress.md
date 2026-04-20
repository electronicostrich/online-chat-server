# WS-05 autorun progress — 2026-04-19

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
