# WS-04 autorun progress — 2026-04-19

Branch: `feature/WS-04-autorun-20260419`

## Scope decision

WS-04 (Messaging and Durable History) covers AC-MSG-01..08, AC-RT-03,
AC-DM-04, AC-DM-05, AC-UNREAD-01..03 — the full durable-history and
read-state layer. WS-05 owns the websocket fan-out (`message.created`,
`message.edited`, `message.deleted`, `readstate.updated`) and will layer
on top of the commit hooks this workstream provides.

This autorun lands the schema + HTTP layer end-to-end so WS-05 can plug in
a publish-after-commit hook without further schema churn. Where a WS-03
primitive is missing (no friendship writer yet — AC-DM-02 was deferred),
this workstream extends `/__test/seed` to let Playwright seed a friendship
for the AC-DM-05 spec rather than reaching into WS-03 code.

### Delivery plan

1. **Schema + migration 0004** — `messages`, `chat_read_state` with the
   indexes from data-model.md §4.13 and §4.16.
2. **AC-MSG-01 / AC-RT-03 / AC-MSG-02** — `POST /chats/{chatId}/messages`
   with sequence allocation inside a single tx. Room-membership + DM
   eligibility gates are re-used from WS-03.
3. **AC-MSG-03 / AC-MSG-07 / AC-MSG-08** — `GET /chats/{chatId}/messages`
   with `beforeSequence`, `afterSequence`, `limit`. Stable DESC ordering
   by `(chat_id, sequence)`.
4. **AC-MSG-04** — `PATCH /messages/{messageId}` (author-only, sets
   `edited_at`).
5. **AC-MSG-05 / AC-MSG-06** — `DELETE /messages/{messageId}` (author
   anywhere; admins/owner in rooms only; DM participants can't delete
   each other's).
6. **AC-DM-04 / AC-DM-05** — `POST /dm/{userId}/messages` lazy-creates
   a direct chat when friendship exists and no block; rejects otherwise.
7. **AC-UNREAD-01/02/03** — `POST /chats/{chatId}/read` and
   `GET /chats/{chatId}/read-state`.

### Interfaces handed to other workstreams

- WS-05: publish-after-commit point is `insertMessage` / `updateMessage`
  / `softDeleteMessage` returning the row — the commit transaction is
  strictly HTTP-local in this slice and does not emit events; WS-05 will
  wrap the service calls with an outbox + ws fan-out layer.
- WS-06: attachment linkage is a future `messageId` FK on attachments.
  This workstream adds `metadata_json` jsonb on `messages` so attachment
  references can be recorded without another migration.
- WS-07: the response shapes in api-and-events.md §5.6 + §5.7 are the
  frozen contract. No client-state implied; WS-07 owns the React surface.

## 2026-04-19 follow-up — CodeRabbit concurrent-delete threads

CodeRabbit flagged three 🟠 Major race conditions where a soft-deleted chat
could still accept writes or leak history between the service-level authz
check and the subsequent data operation. All three fixes are query-level; no
schema change was needed.

1. `messages/repository.ts` — `updateMessageBody` and `softDeleteMessage` now
   include an EXISTS predicate asserting `chats.deleted_at IS NULL` in the
   UPDATE itself, so edits/deletes fail atomically if the parent chat was
   soft-deleted concurrently.
2. `messages/repository.ts` — `upsertReadState` rewritten as INSERT ... SELECT
   from `chats` filtered by `deleted_at IS NULL`. When the chat is tombstoned
   the SELECT yields no rows, no conflict is processed, RETURNING is empty,
   and `advanceReadState` surfaces the standard 404.
3. `messages/repository.ts` + `messages/service.ts` — `listMessages` replaced
   by `loadActiveChatMessageSnapshot`, which reads the chat row (active-only)
   and the page of messages in a single transaction and clamps
   `sequence <= chat.current_sequence`. `fetchMessagesForChat` now uses the
   snapshot both for head and list so the two reads always agree.

A second CodeRabbit pass added three lower-severity nits (also addressed):

1. `findUserActive` — added `deleted_at IS NULL` alongside `status='active'`
   to match the convention used by the other chat-side queries.
2. `sendMessageToChat` and `sendDirectMessage` reply-target validation —
   reject soft-deleted targets the same way a cold miss is rejected, since
   a tombstoned target renders as a dangling pointer on the public surface.

### 2026-04-19 follow-up — preflight-authz TOCTOU (r3107554906 / r3107554910 / r3107540631)

CodeRabbit's third pass flagged two 🔴 Critical threads arguing that
membership / moderator / friendship / block authz was preflight-only: a
concurrent revocation between the service check and the repository
mutation could still let one send/edit/delete commit against stale auth.
A third 🔵 trivial thread asked for the reply-target soft-delete check in
`sendDirectMessage` (landed earlier in commit `fb52954`).

An earlier session drafted a deferral rationale for the two critical
threads on the basis that atomizing authz into mutation SQL would reshape
the service/repository boundary. On reflection that underestimated the
change: the repo methods already receive a `chatId` + caller and the
predicate only needs to flow in as a discriminated union, not a full
boundary rewrite. This follow-up implements the fix in-scope:

1. `messages/repository.ts` — new `WriteAuthScope` / `DeleteAuthScope` /
   `ReadAuthScope` discriminated unions plus `callerIsActiveRoomMember`,
   `callerIsDmParticipant`, and `dmPairStillEligible` SQL fragments.
2. `insertMessageWithSequence`, `updateMessageBody`, `softDeleteMessage`,
   `loadActiveChatMessageSnapshot` take an `authScope` and fold the
   predicate into the UPDATE/SELECT's WHERE clause. Revocations that
   commit between the preflight and the mutation now cause zero rows,
   which the service maps to 403/404 mirroring the preflight response
   shape.
3. `softDeleteMessage` for rooms combines the active-membership check
   with a `(rm.user_id = messages.author_user_id OR rm.role IN
   ('admin','owner'))` disjunction, so moderator revocation fails
   atomically even when the caller is not the author.
4. `createDirectChatAndInsertMessage` — inside the existing advisory-lock
   transaction, re-verifies the friendship (SELECT ... FOR UPDATE, which
   forces any concurrent `UPDATE friendships SET ended_at = ...` to wait
   on our tx) and re-reads the block rows. A new
   `DmEligibilityRevokedError` sentinel is thrown from the tx; the
   service catches it and surfaces `DM_NOT_ALLOWED`/403 matching the
   preflight response. Block INSERTs that land after our block re-read
   but before our message INSERT have no row to lock; closing that
   narrow window requires the block writer to take the same pair
   advisory lock, which lives outside the messages module.
5. `upsertReadState` / `getReadState` — raw postgres-js tagged template
   paths now embed a `buildRawReadAuthFragment` (EXISTS on
   `room_memberships` or `direct_chat_participants`) in the `WHERE`
   clause so read-state no longer upserts against a chat the caller has
   been removed from. Zero rows → service returns 404.

All three CR threads resolved via GraphQL `resolveReviewThread`
mutations. Unit tests and doc-consistency / schema-drift checks pass; no
schema change was required.
