# WS-06 autorun progress — 2026-04-19

Branch: `feature/WS-06-autorun-20260419`

## Scope

WS-06 (Attachments and File Access) owns upload/download flow, filesystem
storage, metadata persistence, and current-membership-based download auth.
AC set: AC-ATT-01, AC-ATT-02, AC-ATT-03, AC-ATT-04, AC-ATTACH-05, AC-ATTACH-06.

## Key decisions

- **Transport**: `multipart/form-data` via `@fastify/multipart` (per
  `api-and-events.md` §5.8 "recommended default: multipart form upload").
- **Storage layout**: `<ATTACHMENT_ROOT_DIR>/<chatId>/<attachmentId>` —
  chat-scoped shard keeps per-chat cleanup cheap; attachment id is the
  sole server-generated storage key (AC-ATTACH-06).
- **Size limits**: enforced in the route by streaming limits — 20 MiB for
  generic files, 3 MiB for `image/*` mime types. Limits from
  `ATTACHMENT_MAX_FILE_BYTES` / `ATTACHMENT_MAX_IMAGE_BYTES` (already in
  `packages/shared-schemas/src/constants/limits.ts`).
- **Linkage to messages**: every upload creates a sibling
  `kind='attachment'` message row in the same transaction — the
  `messages` row carries sequence/ordering and is what the realtime
  fan-out already handles (`message.created` event from WS-05). The
  attachment row's `message_id` FK points at that message.
- **Authorization**:
  - *Upload*: reuses the same write-access check as
    `POST /chats/{chatId}/messages` (room membership OR DM eligibility).
  - *Download*: re-evaluates **current** room membership / direct-chat
    participation at request time — former members, banned users, and
    users whose DM became frozen all get 404 (AC-ATT-03).
- **Soft-delete cascade**: `DELETE /rooms/{id}` (WS-03) already
  soft-deletes the underlying chat. Attachment downloads are gated by
  `chats.deleted_at IS NULL` so room deletion immediately blocks
  downloads without touching attachment rows. This is the AC-ATT-04
  "soft delete" stage; the 30-day hard-purge job (WS-08) will delete
  attachment rows + binaries.
- **Filename sanitization on download**: `Content-Disposition` uses a
  sanitized ASCII fallback plus a `filename*=UTF-8''` RFC 5987 encoded
  form for the original name. Path separators, control chars, NUL, and
  shell/URL metacharacters are stripped in the ASCII fallback so a
  malicious filename can't inject headers or break parsers.

## Progress

- [x] AC-ATT-01 upload within limits — `e2e/specs/AC-ATT-01-upload.spec.ts`
- [x] AC-ATT-02 oversized rejected — `e2e/specs/AC-ATT-02-oversize-rejected.spec.ts`
- [x] AC-ATT-03 download auth based on current state — `e2e/specs/AC-ATT-03-current-auth.spec.ts`
- [x] AC-ATT-04 room deletion blocks attachment downloads (soft-delete; WS-08 hard-purge pending) — `e2e/specs/AC-ATT-04-room-deletion-cleanup.spec.ts`
- [x] AC-ATTACH-05 no file-type restriction — `e2e/specs/AC-ATTACH-05-no-type-restriction.spec.ts`
- [x] AC-ATTACH-06 filename preserved + sanitized — `e2e/specs/AC-ATTACH-06-filename-handling.spec.ts`
