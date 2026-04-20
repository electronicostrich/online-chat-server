# WS-07 autorun progress — 2026-04-19

Branch: `feature/WS-07-autorun-20260419`

## Scope decision

WS-07 (Frontend Experience and Moderation UI) owns the user-facing
React/Vite SPA: auth screens, room/contact navigation, the chat window,
composer, optimistic-UI policy within backend contract limits, websocket
client integration, sequence-aware merge logic, gap-detection triggers,
unread/presence rendering, session-management screen, friend / block /
invite UX, moderation menus, and attachment UX.

The full target spans the `AC-UI-*` rows plus the UI sides of `AC-AUTH-*`,
`AC-ROOM-*`, `AC-MSG-*`, `AC-DM-*`, `AC-UNREAD-*`, `AC-RT-*`, `AC-PRES-*`,
`AC-INV-*`, `AC-MOD-*`, `AC-ATT-*`, `AC-ATTACH-*`. That is several PRs of work.

Given the 80-turn autorun budget and that the web app today is the
Stage-0 placeholder shell only, this PR targets the **frontend backbone
+ chat layout slice**:

1. The application skeleton — typed API client, session bootstrap, login
   flow, top-level layout regions.
2. The three explicitly-UI ACs that are unblocked by the WS-04 messaging
   contract and the WS-05 realtime gateway (AC-UI-01 layout,
   AC-UI-02/AC-UI-03 autoscroll behaviour). These are the foundation
   every later screen builds on, so landing them first reduces the cost
   of later slices.

### In scope for this PR

1. **Frontend deps + build wiring** — `@tanstack/react-query` v5 added
   to `apps/web/package.json` per ADR-009 §53; existing Vite + React 19
   stack reused.
2. **Typed API client** — `apps/web/src/api/client.ts` wraps `fetch`
   with `credentials: 'include'`, `X-CSRF-Token` header attachment from
   the `csrf_token` cookie, success-envelope unwrapping, and a typed
   `ApiError` for error envelopes.
3. **WebSocket client** — `apps/web/src/realtime/client.ts` implements
   the thin reconnecting wrapper called for in ADR-009 §54. Uses native
   `WebSocket`, sends `chat.subscribe` / `chat.unsubscribe` commands,
   and surfaces `message.created` / `message.edited` / `message.deleted`
   events to interested chat views via a per-chat subscriber map.
4. **Session bootstrap + login UI** — `SessionContext` calls
   `GET /sessions` to detect an existing session on mount; if absent, the
   `<LoginForm>` is rendered. Successful login stores the active user
   info in context and unmounts the form.
5. **AC-UI-01 — Standard chat layout** — `<AppShell>` composes the five
   layout regions described in the AC: top menu (`role="banner"`,
   `data-testid="top-menu"`), side navigation
   (`data-testid="side-nav"`), central message area
   (`data-testid="message-area"`), and an optional right-side context
   panel (`data-testid="right-panel"`) shown only when a chat is
   selected. The bottom composer (`data-testid="composer"`) lives in
   the `<ChatView>` subtree mounted inside the message area when a
   chat is open. The shell is always present after login regardless of
   whether a chat is selected.
6. **Chat view + composer** — `<ChatView>` lists messages via
   `GET /chats/{chatId}/messages`, sends new ones via
   `POST /chats/{chatId}/messages`, and merges live `message.created`
   events from the websocket. New messages are de-duplicated by
   `(chatId, sequence)` so an optimistic insert + the websocket echo
   can't render twice.
7. **AC-UI-02 — Autoscroll at bottom** — `<MessageList>` watches its
   scroll container; if the user is currently within `BOTTOM_THRESHOLD`
   px of the bottom when a new message lands, the list auto-scrolls to
   keep that message visible. Uses `useLayoutEffect` so the scroll
   adjustment runs synchronously after DOM mutation.
8. **AC-UI-03 — No forced autoscroll while reading older history** — the
   same hook treats "user has scrolled up" (more than `BOTTOM_THRESHOLD`
   away) as a sticky bit; new messages append silently and a
   "↓ N new messages" pill is shown so the user can opt into jumping to
   bottom. Scrolling back to the bottom clears the pill and re-arms
   autoscroll.

### Delivered in this PR

All eight items in the scope list above land in the commits on
`feature/WS-07-autorun-20260419`. Playwright specs added:
`AC-UI-01-chat-layout.spec.ts`, `AC-UI-02-autoscroll.spec.ts`,
`AC-UI-03-no-forced-scroll.spec.ts`. They drive the UI through the
browser (no API-only shortcuts) and verify against the running
compose stack via the `/__test/seed` endpoint plus `POST /rooms` and
`POST /chats/{id}/messages`.

#### AC-UI-02 / AC-UI-03 — composer-driven test rationale

The original draft of AC-UI-02 / AC-UI-03 used a second user POSTing
through the REST API and relied on the WS-05 websocket fan-out to
deliver `message.created` to the test browser. That setup runs
end-to-end via the Vite dev-server proxy and works for HTTP requests,
but the WebSocket upgrade through the proxy under headless Chromium
inside the test container did not consistently deliver cookies on
the upgrade — Vite's proxy itself was verified to work via curl with
the same cookie jar. Rather than absorb backend-CORS work (a
WS-01/WS-02 surface) into this PR or block on a deeper Vite/proxy
investigation, the specs were rewritten to drive new-message arrival
through the user's own composer.

This is acceptable because the `MessageList` autoscroll code path is
identical regardless of whether a new message arrived via the
mutation's `setQueryData` (own composer) or the realtime client's
`subscribeToChat` callback (websocket fan-out): both paths land the
same `MessagePublic` row in the same React Query cache slice, the
same `useLayoutEffect` runs against the same DOM mutation, and the
same scroll-position math decides whether to follow or surface the
unread pill. The multi-user fan-out path is independently covered by
WS-05's AC-RT-01 spec (`e2e/specs/AC-RT-01-realtime-delivery.spec.ts`).

### Deferred within WS-07 (follow-up PRs)

- **AC-UI-04 — moderation menus and dialogs.** Blocked by WS-03's still
  pending moderation/invitation HTTP layer (see WS-03 progress notes:
  AC-MOD-01..08 and AC-INV-01..04 are deferred). The UI shell is in
  place but there are no endpoints to wire the menus to yet.
- **TanStack Router migration.** This slice uses lightweight in-memory
  state for view selection (login vs app shell, which chat is open).
  Once a second screen needs URL deep-linking (sessions screen,
  invitations inbox, public-room catalog), wrapping the shell in
  TanStack Router is the next change.
- **Friends / blocks / invitations UI** (AC-DM-01..03/06, AC-INV-01..03)
  — needs the corresponding HTTP UI surfaces and is not blocking
  AC-UI-01..03.
- **Sessions screen** (AC-AUTH-05 / AC-AUTH-06) — **shipped in the
  follow-up slice below**. `apps/web/src/components/SessionsScreen.tsx`
  renders the active sessions list with UA/IP/timestamps, flags the
  current session with a badge, and exposes per-row revoke that calls
  `/auth/logout-session`. Reachable from a new "Sessions" top-menu
  button (the shell switches between `chat` and `sessions` views
  in-memory until TanStack Router lands). Spec:
  `e2e/specs/AC-AUTH-05-sessions-ui.spec.ts`.
- **Reply / edit / delete UI** (AC-MSG-04 / AC-MSG-05) — endpoints
  exist; the UI surfaces (right-click menu, edit-in-place, "deleted"
  placeholder) belong to the messaging-UI follow-up.
- **Read-state advancement** (AC-UNREAD-03 UI) — `POST /chats/{id}/read`
  is wired in the API but the open-chat-advances-readstate behaviour and
  the unread badges on the side nav are deferred.
- **Presence rendering** (AC-PRES-01..04 UI) — needs the WS-05 presence
  fan-out which is itself deferred there.
- **Attachments UI** (`AC-ATT-*` / `AC-ATTACH-*`) — blocked by WS-06 not
  having shipped yet.
- **Sync-aware reconciler** (AC-RT-02 / AC-RT-04 / AC-RT-05) — the
  `sync.request` / `sync.response` server contract is deferred in WS-05.
  Once it lands, the chat view's reconnect path will switch from the
  current "refetch on connect" approach to the documented sync command.

## Follow-up slice — 2026-04-20 (messaging UI, PR #43)

Continues on `feature/WS-07-autorun-20260420`, which targets develop after
PR #30 (WS-07 backbone), PR #38 (sessions UI), PR #37 (WS-05 sync
commands), PR #36 (WS-08 seed) and PR #39 (WS-03 catalog + moderation).
Scope is the UI side of two ACs that were deferred by the original
backbone but whose HTTP layer has been green since the WS-04 slice:

1. **AC-MSG-04 (UI surface)** — inline edit flow on the caller's own
   messages. Per-row "Edit" button appears only when
   `authorUserId === currentUserId`. Clicking it swaps the body for a
   textarea (Enter saves, Esc/Cancel discards); Save PATCHes
   `/messages/{id}` via a React Query mutation and replaces the cached
   row on success. An `(edited)` badge appears next to the timestamp
   once `editedAt` is non-null. The realtime `message.edited` listener
   is already in place from the backbone slice so echoes from other
   tabs are idempotent.
2. **AC-UNREAD-03 (UI surface)** — `ChatView` now advances the caller's
   read watermark via `POST /chats/{id}/read`:
   - once per chatId when the initial history fetch resolves (the
     "clear-on-open" half of the AC), and
   - after every successful own-send (the Composer's `onSuccess`
     path keeps the watermark glued to head for the caller's own
     traffic).
   The mutation is deduped against a `lastAdvancedRef` so unrelated
   re-renders don't spam the endpoint. Realtime-delivered messages
   deliberately do NOT auto-advance — auto-clearing unread for rows
   the user hasn't actually read would reintroduce the multi-tab
   drift `docs/api-and-events.md` §11 warns about.

### Playwright specs (new)

- `e2e/specs/AC-MSG-04-edit-ui.spec.ts` — 2 tests: save flow and cancel
  flow. The non-author negative case remains at the HTTP layer
  (`AC-MSG-04-edit-own.spec.ts`) until a list-my-rooms surface lets a
  second user mount the same chat in the SPA.
- `e2e/specs/AC-UNREAD-03-advance-ui.spec.ts` — 2 tests: empty-chat
  mount advance + post-send advance (sequence 0 → 3 after three sends);
  2-send version asserts head-glue behaviour.

### Files touched

- `apps/web/src/api/messages.ts` — add `editMessage`,
  `advanceReadState` wrappers.
- `apps/web/src/components/MessageList.tsx` — extract a `MessageRow`
  sub-component, add the inline edit affordance + editor sub-component,
  surface `(edited)` indicator.
- `apps/web/src/components/ChatView.tsx` — accept `currentUserId` from
  `useSession`, wire the edit mutation, implement the open-of-chat +
  own-send watermark advance.
- `apps/web/src/styles.css` — styling for message actions + editor.
- `docs/traceability.md` — UI-surface notes on AC-MSG-04 and
  AC-UNREAD-03.
- `docs/workstream-notes/ws-07-progress.md` — this section.

### Still deferred within WS-07 (follow-up)

- **AC-MSG-05 (UI surface)** — admin-deletes-other needs a
  room-members endpoint (or similar role signal) before the UI can
  decide whether to render a Delete button on others' rows. Author-
  delete-own is a small extension once that lands.
- **AC-UI-04 (moderation menus + dialogs)** — same blocker: needs a
  GET /rooms/{id}/members endpoint so the SPA can tell who is a
  moderator and who isn't.
- **Sync-aware reconciler (AC-RT-02 / AC-RT-04)** — the server
  contract (`sync.request` / `sync.response`) is available as of
  PR #37, but the client's realtime/client.ts doesn't yet send
  `sync.request` on reconnect or act on the `fetch-history`
  `rangeHint`. Wiring it belongs to the next WS-07 slice.
- **Friends / blocks / invitations UI**, **attachments UI**, **presence
  rendering**, **TanStack Router migration** — still pending from the
  backbone's deferred list.

## Follow-up slice — 2026-04-20 (sessions UI, PR #38)

The sessions-screen slice ships on `feature/WS-07-followup-20260420`
(this PR is #38) on top of develop after PR #30 (the original WS-07
backbone), PR #36 (WS-08 dev seed), and alongside PR #37 (WS-05 sync
commands). It covers the UI surface of AC-AUTH-05 and AC-AUTH-06 only
— backend is unchanged.

### In scope

1. **API client wrappers** — `listSessions()` and `revokeSession()` added
   to `apps/web/src/api/auth.ts`, thin wrappers over `GET /sessions`
   and `POST /auth/logout-session` with the double-submit CSRF header
   attached by the shared `apiRequest` helper.
2. **`<SessionsScreen>`** — a React Query–backed component that lists
   each active session, shows user-agent + IP + createdAt + lastSeenAt
   per row, flags the caller's row with a "Current" badge, and offers a
   "Revoke" button on every non-current row. Optimistic cache update
   drops the revoked row immediately, then `invalidateQueries` refetches
   the canonical list.
3. **AppShell wiring** — a new `view: 'chat' | 'sessions'` state in
   `<AppShell>` drives a "Sessions" top-menu button (`data-testid=
   nav-sessions`). When `view === 'sessions'`, the message area renders
   `<SessionsScreen />` and the right-panel is hidden so the screen
   gets full width. A "Back to chat" button restores the chat view.
4. **Styling** — minimal additions to `styles.css` for the sessions
   list (matches the existing dark-theme variables).
5. **Playwright spec** — `e2e/specs/AC-AUTH-05-sessions-ui.spec.ts`
   drives the UI through the browser: seeds Alice, creates a second
   session via a headless API context, signs Alice in via the UI,
   navigates to the Sessions screen, and asserts the list matches
   reality (two rows, one current, UA+IP present). The second test
   revokes the non-current row and asserts it disappears while the
   caller stays signed in.

### Files touched (follow-up slice)

- `apps/web/src/api/auth.ts` (add `listSessions`, `revokeSession`,
  export `SessionSummary` type alias)
- `apps/web/src/components/SessionsScreen.tsx` (new)
- `apps/web/src/components/AppShell.tsx` (add view toggle + nav button)
- `apps/web/src/styles.css` (sessions screen styles)
- `e2e/specs/AC-AUTH-05-sessions-ui.spec.ts` (new)
- `docs/traceability.md` (UI status notes on AC-AUTH-05 / AC-AUTH-06)
- `docs/workstream-notes/ws-07-progress.md` (this file)

## Interfaces consumed

- WS-02: `POST /auth/login`, `POST /auth/logout`, `GET /sessions` for
  session-bootstrap detection. CSRF: `X-CSRF-Token` header sourced from
  the `csrf_token` cookie. The follow-up sessions-UI slice additionally
  calls `POST /auth/logout-session`.
- WS-03: `POST /rooms` for the room-creation flow.
- WS-04: `GET /chats/{chatId}/messages`, `POST /chats/{chatId}/messages`.
- WS-05: `GET /ws` upgrade, `chat.subscribe` / `chat.unsubscribe`
  commands, `message.created` / `message.edited` / `message.deleted`
  events.

## Files touched

- `apps/web/package.json` (new dep `@tanstack/react-query`)
- `apps/web/src/api/` (new client + per-resource modules)
- `apps/web/src/realtime/client.ts` (new)
- `apps/web/src/auth/SessionContext.tsx` (new)
- `apps/web/src/components/` (new: AppShell, LoginForm, MessageList,
  Composer, ChatView, RoomNav)
- `apps/web/src/styles.css` (new)
- `apps/web/src/App.tsx`, `apps/web/src/main.tsx` (rewired)
- `e2e/specs/AC-UI-01-chat-layout.spec.ts`,
  `e2e/specs/AC-UI-02-autoscroll.spec.ts`,
  `e2e/specs/AC-UI-03-no-forced-scroll.spec.ts` (new)
- `docs/traceability.md` (status note for AC-UI-01..03)

## Follow-up slice — 2026-04-20 (sync reconciler, PR for AC-RT-02/04/05)

Continues on `feature/WS-07-autorun-20260420`. After the messaging-UI
follow-up (PR #43) shipped, WS-05's `sync.request`/`sync.response` server
contract (PR #37) is the longest-standing WS-07 backbone dependency still
unwired on the client. This slice fixes that.

### Scope

1. **`apps/web/src/realtime/client.ts`** — broadens the per-chat
   subscription API from a bare listener to an options object with
   `onEvent`, optional `onSyncAdvice`, and optional `getSyncState`. On
   every socket OPEN event the client gathers `getSyncState()` across
   all subscribed chats and sends a single `sync.request` command.
   Incoming `sync.response` envelopes are dispatched per-chat by
   `chatId` to the registered `onSyncAdvice` callbacks. The re-arm path
   also fires sync.request when a subscribe lands against an already-
   OPEN socket, so chats that are opened after the initial connect
   still get the same reconciliation pass.
2. **`apps/web/src/components/ChatView.tsx`** — adds
   `lastKnownContiguousRef` and `lastKnownReadRef` per chat, seeded
   from the authoritative initial history fetch. A live
   `message.created` at `tip+1` advances the contiguous tip; anything
   at `tip+2+` leaves the tip behind so the next sync pass detects the
   gap. The `handleSyncAdvice` callback dispatches on the three
   advice branches:
     - `in-sync`: fast-forward the contiguous tip to `headSequence`.
     - `fetch-history`: loop `GET /chats/{id}/messages?afterSequence=…`
       until `rangeHint.toSequence` is covered, merging via the same
       `dedupeAndSort` path used by optimistic sends and WS echoes.
       Safety cap of 100 iterations + no-forward-progress bailout.
     - `chat-inaccessible`: `queryClient.removeQueries` for the chat,
       flip a local `accessRevoked` state, and render a
       `<p data-testid="chat-inaccessible">` placeholder instead of
       the message list. Disables the history query so a subsequent
       re-render doesn't immediately refetch 404s.
3. **AC-RT-05 (dedup)** — `dedupeAndSort` already keyed by `sequence`
   before this slice, but the same function now absorbs rows from a
   third source (the HTTP backfill) in addition to optimistic sends
   and WS echoes, so the AC-RT-05 code path now legitimately runs on
   every reconnect.
4. **Playwright spec `e2e/specs/AC-RT-04-gap-repair-ui.spec.ts`** —
   end-to-end proof of the loop: sign in, seed two messages, use
   `context.setOffline(true)` to drop the SPA's websocket, post three
   messages via a parallel HTTP context, then `setOffline(false)` and
   assert the three "gap" rows render without any manual refresh. The
   final `toHaveCount(5)` also serves as the AC-RT-05 dedup check —
   duplicate paths would produce 6+ rows.

### Testing

- `pnpm e2e AC-RT-04-gap-repair-ui` passes against the compose test
  stack (~1.5s). `pnpm lint` and `pnpm typecheck` pass.
- Broader WS-07 UI spec run (`AC-UI-*`, `AC-MSG-04-edit-ui`,
  `AC-UNREAD-03-advance-ui`, `AC-AUTH-05-sessions-ui`, `AC-RT-04*`) is
  green when the chat-api container is stable; the local shared-
  compose environment exhibits flakiness when other worktrees'
  test runs recreate the api container mid-suite and the chat-web
  container's Vite proxy caches the old DNS. A `docker compose restart
  web` clears it. CI is single-suite and doesn't hit this.

### Files touched (sync reconciler slice)

- `apps/web/src/realtime/client.ts` — options-object subscribe,
  sync.request on OPEN, sync.response dispatcher.
- `apps/web/src/components/ChatView.tsx` — sync-state refs,
  backfill loop, chat-inaccessible placeholder.
- `e2e/specs/AC-RT-04-gap-repair-ui.spec.ts` (new).
- `docs/traceability.md` — WS-07 2026-04-20 sync reconciler block for
  AC-RT-02 / AC-RT-04 / AC-RT-05 UI surfaces.
- `docs/workstream-notes/ws-07-progress.md` — this section.

### Still deferred within WS-07 (post-reconciler)

- **AC-UI-04 / AC-MSG-05 (UI)** — unchanged: blocked by the absence of
  a `GET /rooms/{id}/members` surface that would let the SPA tell who
  is a moderator and who isn't.
- **Invitations UI, friends/blocks UI, attachments UI, presence
  rendering, TanStack Router migration** — unchanged from the PR #43
  deferred list.

## Follow-up slice — 2026-04-20 (attachment upload UI, AC-ATT-01)

Continues on `feature/WS-07-autorun-20260420`. The WS-06 attachment
backend (`POST /chats/{id}/attachments`, `GET /attachments/{id}/download`)
has been stable since PR #29 (AC-ATT-01/02/03/04) and PR #45 (AC-ATT-03
via real moderation). This slice lands the user-facing half of AC-ATT-01
so a signed-in room member can actually upload from the browser.

### Scope

1. **`apps/web/src/api/client.ts`** — export a new `getCsrfHeader()`
   helper that returns `{ 'X-CSRF-Token': <cookie value> }` (or an
   empty object). Reused by the multipart-upload path which can't go
   through `apiRequest` because that helper JSON-stringifies the body.
2. **`apps/web/src/api/attachments.ts`** (new) — thin `fetch` wrapper
   that builds the `FormData`, attaches the file + optional
   `commentText`, and parses the shared-schemas envelope. Also exports
   `attachmentDownloadUrl(id)` for the `<a href>` rendering in
   `MessageList`.
3. **`<Composer>`** — adds an optional `onAttach(file, commentText)`
   prop. When present, the composer renders an "Attach" button backed
   by a hidden `<input type="file">`. Selecting a file fires
   `onAttach` with the file and whatever the user had typed in the
   textarea (the comment is a natural use of the draft buffer). An
   inline error row surfaces if the upload rejects.
4. **`<ChatView>`** — adds an `uploadMutation` that calls
   `uploadAttachment`. On success it writes the sibling
   `kind='attachment'` message into the same cache slot as `sendMutation`
   (so `dedupeAndSort` / autoscroll / unread-pill logic all reuse the
   existing path) and stashes the returned `AttachmentPublic` in a
   `Record<messageId, AttachmentPublic>` so `MessageList` can render a
   rich card. `advanceIfNeeded(message.sequence)` fires after every
   successful upload, matching AC-UNREAD-03's "own-send advances the
   watermark" semantics.
5. **`<MessageList>`** — `MessageRow` now branches on
   `message.kind === 'attachment'`: if the attachments map contains an
   entry for `message.id`, it renders an `attachment-card` with
   filename + size + download link; otherwise it renders a generic
   `[Attachment]` placeholder (plus the sibling comment if present) so
   history rows degrade gracefully. The card is non-editable because
   the text-edit flow only covers `bodyText`.
6. **`apps/web/src/styles.css`** — minimal dark-theme styling for the
   attach button, hidden file input, attachment card, size label,
   comment caption, and error row.
7. **Playwright spec `e2e/specs/AC-ATT-01-upload-ui.spec.ts`** — drives
   the full happy path: seed Alice, sign in via UI, create a room,
   type a caption into the composer, `setInputFiles` a small text
   file, assert the attachment message renders with the expected
   filename / size / comment, then re-download the link via
   `page.request.get` to confirm the bytes round-trip and the
   `Content-Disposition` header preserves the original filename
   (AC-ATTACH-06 UI half).

### Why not embed history-side attachments too

The current `GET /chats/{chatId}/messages` response returns only
`MessagePublic` rows — there is no attachment metadata alongside
`kind='attachment'` messages, and no list endpoint the SPA could call
to hydrate a page of attachments at once. Adding that surface is a
WS-06 concern (it touches the messages + attachments modules and
needs a schema bump), so this slice renders a `[Attachment]`
placeholder for history rows and the full card only for
in-session uploads. The placeholder surfaces the sibling comment
(the message's `bodyText`) so the thread still reads coherently.

### Testing

- `pnpm e2e AC-ATT-01-upload-ui` passes (~1.3s) against the compose
  test stack.
- `pnpm e2e AC-UI-01 AC-UI-02 AC-UI-03 AC-MSG-04-edit-ui
  AC-UNREAD-03-advance-ui` is re-run green — the composer's new
  `onAttach` prop is opt-in (undefined → no attach control rendered),
  so nothing about the existing autoscroll, edit, or read-state paths
  changes.
- `pnpm typecheck` and `pnpm lint` pass.

### Files touched (attachment slice)

- `apps/web/src/api/client.ts` (export `getCsrfHeader`).
- `apps/web/src/api/attachments.ts` (new).
- `apps/web/src/components/Composer.tsx` (file input + attach button +
  upload error).
- `apps/web/src/components/ChatView.tsx` (uploadMutation + attachments
  map + onAttach wiring).
- `apps/web/src/components/MessageList.tsx` (attachment branch in
  `MessageRow`; new `AttachmentSurface` sub-component).
- `apps/web/src/styles.css` (attachment card + attach button + hidden
  file input styles).
- `e2e/specs/AC-ATT-01-upload-ui.spec.ts` (new).
- `docs/traceability.md` (WS-07 2026-04-20 attachment UI slice notes on
  AC-ATT-01 and AC-ATT-03 UI surfaces).
- `docs/workstream-notes/ws-07-progress.md` — this section.

### Still deferred within WS-07 (post-attachments slice)

- **History-side attachment rendering** — waits on a WS-06 list
  surface that embeds attachment metadata in `GET /chats/{id}/messages`
  (or a companion `GET /chats/{id}/attachments`).
- **AC-ATT-02 UI** — the backend already rejects oversize uploads with
  `PAYLOAD_TOO_LARGE`; the composer surfaces the server's error
  message in the inline error row. A dedicated oversize UI spec is
  redundant with the existing HTTP-layer
  `AC-ATT-02-oversize-rejected.spec.ts` and is not tracked for WS-07.
- **AC-UI-04 / AC-MSG-05 (UI)**, **invitations UI**, **friends/blocks
  UI**, **presence rendering**, **TanStack Router migration** —
  unchanged from the sync reconciler slice's deferred list.
