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

4. `findUserActive` — added `deleted_at IS NULL` alongside `status='active'`
   to match the convention used by the other chat-side queries.
5. `sendMessageToChat` and `sendDirectMessage` reply-target validation —
   reject soft-deleted targets the same way a cold miss is rejected, since
   a tombstoned target renders as a dangling pointer on the public surface.

### Deferred: preflight-authz TOCTOU (CodeRabbit r3107554906 / r3107554910)

CodeRabbit also flagged two 🔴 Critical threads arguing that membership /
moderator / friendship / block authz is preflight-only, so a concurrent
revocation between the service check and the repo mutation can let one more
message through. These are a different class from the concurrent-delete
races fixed above — the FK stays intact, the window is bounded to a single
in-flight request, and the AC-MSG / AC-DM criteria are phrased as preflight
semantics rather than serialisable isolation between revoker and writer.

Atomizing authz into the mutation SQL would thread chat-type-aware params
through four repo methods (`insertMessageWithSequence`, `updateMessageBody`,
`softDeleteMessage`, `createDirectChatAndInsertMessage`) plus the read
paths, with a predicate that differs per chat type (room-membership EXISTS
vs. direct-participant + friendship + no-block EXISTS). That reshapes the
service/repository boundary and is ADR-level — owed a dedicated ticket
rather than rolled into this concurrent-delete follow-up. Threads resolved
with a rationale reply on the PR so cascade can proceed.
