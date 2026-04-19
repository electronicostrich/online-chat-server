# WS-05 autorun progress — 2026-04-19

Branch: `feature/WS-05-autorun-20260419`

## Scope decision

WS-05 (Realtime Gateway, Presence, and Synchronization) owns the websocket
gateway, event envelope, publish-after-commit fan-out, presence
aggregation, sync/reconnect semantics, and slow-consumer handling. The
full scope spans AC-RT-01..06, AC-PRES-01..04, AC-UNREAD-04, plus event
emission for AC-MSG-01/04/05, AC-AUTH-04/06/07, AC-ROOM-05/08, AC-INV-02,
AC-MOD-02..08.

Given the 80-turn autorun budget and the absence of WS-06 / WS-07 / most
of WS-03's moderation + invitation endpoints, this PR targets the
**realtime backbone** slice and leaves presence, sync/reconnect, and the
moderation-event emitters for follow-up PRs. The backbone is what every
other workstream consumes, so landing it first unblocks the most
downstream work per unit scope.

### In scope for this PR

1. **WS plugin + envelope schema** — `@fastify/websocket` on `GET /ws`
   using session cookie + CSRF token header during the HTTP upgrade
   handshake. Envelope types in `packages/shared-schemas/src/schemas/events.ts`
   per api-and-events.md §6.3 / §6.4.
2. **Event bus + connection registry** — in-process publish-after-commit
   event bus in `apps/api/src/modules/realtime/`; per-session
   connection map that routes by `(userId, chatId)` for chat events and
   by `userId` for presence/readstate/session events.
3. **Subscription model** — `chat.subscribe` / `chat.unsubscribe` client
   commands validate read access via `loadChatContext` +
   `isActiveRoomMember` / direct-participant check.
4. **AC-RT-01** — `message.created` emitted on `POST /chats/{id}/messages`
   and `POST /dm/{userId}/messages`; delivered to every subscribed socket
   that passes the access check. Spec:
   `e2e/specs/AC-RT-01-realtime-delivery.spec.ts`.
5. **message.edited / message.deleted** — emitted on the respective HTTP
   paths to the same subscriber set (covers the WS portion of AC-MSG-04
   and AC-MSG-05; the HTTP layer already passed in WS-04).
6. **AC-UNREAD-04** — `readstate.updated` fan-out from
   `POST /chats/{id}/read` to the *caller's* other sessions (no broadcast
   to other users — read state is a per-user fact).
7. **AC-RT-06** — per-socket bounded outbound queue (default 256
   events); on overflow, the server closes the socket with a distinct
   close code and records the cause in the log. Client is expected to
   reconnect and repair via REST.
8. **session.revoked + live-socket drop** — emitted on
   `POST /auth/logout-session` and `POST /auth/password-change`
   (revoking other sessions) to each revoked `sessionId`; the server
   also closes any live socket bound to that session.

### Deferred within WS-05 (follow-up PRs)

- **AC-PRES-01..04** (multi-tab presence aggregation) — needs a presence
  store, heartbeat timers, and a tab registry. Separable work; will be
  landed after the backbone proves stable.
- **AC-RT-02 / AC-RT-04 / AC-RT-05** — `sync.request` / `sync.response`
  command + dedup semantics. The server-side pieces depend on agreement
  with WS-07's client reconciler, which doesn't exist yet.
- **room.invitation.created / room.membership.updated / room.ban.updated**
  — WS-03 hasn't landed invitations, bans, membership transitions, or
  moderation endpoints yet. Event emission will land with those HTTP
  paths (expected in the next WS-03 autorun), not separately here.
- **AC-AUTH-04 self-logout `session.revoked` to caller** — the HTTP
  response clears the caller's cookie before the event could be
  delivered, so the fan-out is cosmetic. Deferring until presence /
  session management UX surfaces a concrete need.

## Interfaces handed to other workstreams

- WS-07: client connects to `GET /ws` carrying the session cookie and
  the `X-CSRF-Token` header. Once connected, the client issues
  `chat.subscribe` commands and receives server events in the envelope
  shape documented in api-and-events.md §6.3. Disconnects indicate
  either network trouble OR server-side eviction for slow-consumer
  overflow — the client must repair via REST on reconnect.
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
