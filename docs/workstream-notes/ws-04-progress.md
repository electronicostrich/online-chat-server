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
