# WS-08 autorun progress — 2026-04-20

Branch: `feature/WS-08-autorun-20260420`

## Prior WS-08 runs

- 2026-04-19 (#36, merged) — delivered the developer-seed slice of
  AC-BOOT-00: real `pnpm --filter api db:seed`, `/__test/seed`
  upsert strategy, seed unit tests, doc updates. That PR explicitly
  deferred the following WS-08 items:
  1. cross-workstream integration specs (blocked on upstream
     AC-RT-02/04, AC-MOD-*, AC-PRES-01..04),
  2. `/readyz` endpoint + `docs/observability.md`,
  3. the 30-day attachment hard-purge job,
  4. a metrics / counters surface.

Since then the upstream picture has changed:

- AC-RT-02/04 (sync request/response + gap-repair rangeHint) landed in
  `07cabf6` (#37).
- AC-MOD-01..08 (room moderation HTTP surface) landed in `9e7c3db`
  (#39).
- AC-AUTH-05 / AC-AUTH-06 UI in `d2521b7` (#38).

AC-PRES-01..04 and AC-AUTH-09 are still deferred upstream (WS-05 and
WS-03 respectively).

## Scope for this autorun

This run targets the **observability baseline** slice. It is the
highest-leverage WS-08 item that is fully unblocked today, and it is
small enough to land cleanly in one autorun without touching other
workstreams' code paths.

### In scope for this PR

1. **New `GET /readyz` endpoint** — distinct from `/healthz`. Returns
   503 with `error.code = SERVICE_UNAVAILABLE` if any of `db`, `redis`,
   `attachments`, or the migrations-applied check fails. The
   migrations check queries the Drizzle migrations table and asserts
   that at least the current migration head is recorded, so a pod that
   is reachable but hasn't run schema migrations is correctly reported
   as not-ready. Response shape is carried by a new TypeBox schema
   `ReadyzResponseSchema` in `packages/shared-schemas`.
2. **`/healthz` unchanged** — compose's `healthcheck.test` hits
   `/healthz` and `depends_on.service_healthy` is wired to it; the
   semantic split (liveness = `/healthz`, readiness = `/readyz`) is
   documented without breaking compose.
3. **New doc `docs/observability.md`** — the observability baseline:
   logger configuration, request-ID propagation, `/healthz` vs
   `/readyz` semantics, and the near-term plan for metrics + tracing.
   This is a new doc (not overlapping with any existing one — see
   `docs/ai-development-guardrails.md` §10.2 allow-list for new docs).
4. **`docs/api-and-events.md` §5.10** extended with the `/readyz`
   endpoint spec (request/response/error envelope).
5. **Playwright spec** `e2e/specs/AC-BOOT-00-readyz.spec.ts` — covers
   the happy path (200 with `status: 'ready'`) against the running
   compose stack. The `/healthz` case is still covered by the existing
   `AC-BOOT-00-bootstrap.spec.ts`.
6. **Unit test** for the migrations check so that a stubbed "no rows"
   state correctly reports `migrations: 'down'` without requiring the
   live DB to be broken.
7. **Docs: `docs/traceability.md`** updated with a WS-08 2026-04-20
   status block and the AC-BOOT-00 row extended to list `/readyz`.

### Still deferred within WS-08 (follow-up PRs)

- **Cross-workstream composite specs** — the test-ownership table in
  `docs/workstreams/workstream-dependency-and-interface-map.md` assigns
  these to WS-08:
  - "send→unread→delivery" (partially covered by AC-RT-01/AC-UNREAD-01..04)
  - "reconnect→gap repair" (now unblocked by AC-RT-02/04; pick up next)
  - "upload→remove-from-room→lose-download-access" (now unblocked by
    AC-MOD-02; pick up next)
  - "multi-tab→online/AFK/offline transitions" (still blocked — waits
    for AC-PRES-01..04 upstream)

  These are held for their own PR because each one reads from multiple
  test utilities and can noisily cross the 15-minute-review PR-size
  threshold when bundled with the observability slice.

- **30-day attachment hard-purge job** — needs a scheduled-job runner
  decision (node-cron vs compose-level cron vs a lightweight timer
  plugin). That scoping belongs to its own PR.

- **Metrics / counters surface** — will follow observability.md with a
  concrete Prometheus-text `/metrics` endpoint (or similar). Kept out
  of this PR so the PR stays review-sized.

## Interfaces handed to other workstreams

- **Operators / CI** — `GET /readyz` is available for compose and
  future Kubernetes-style probes. `/healthz` is unchanged for backward
  compat.
- **Contributors** — `docs/observability.md` is the new single source
  of truth for "how do I see what the running API is doing" (logs,
  request IDs, health probes). No change to runtime config.

## Files likely touched

- `apps/api/src/routes/readyz.ts` (new)
- `apps/api/src/routes/index.ts` (register)
- `apps/api/test/unit/routes/readyz.test.ts` (new)
- `packages/shared-schemas/src/schemas/readyz.ts` (new)
- `packages/shared-schemas/src/index.ts` (export)
- `docs/observability.md` (new)
- `docs/api-and-events.md` (append §5.10)
- `docs/traceability.md` (AC-BOOT-00 row + status block)
- `e2e/specs/AC-BOOT-00-readyz.spec.ts` (new)

No DB schema changes, no destructive SQL, and no `zod`/`any`/etc.

---

## Follow-up slice (same autorun day, later in session)

### Scope

The observability slice merged via #40. While still on this branch,
pick up the first of the three "cross-workstream composite specs" that
were marked "pick up next": the **upload → remove-from-room →
lose-download-access** flow.

### What this slice adds

- `e2e/specs/AC-ATT-03-via-moderation.spec.ts` (new). End-to-end
  integration test that chains real endpoints from three workstreams:
  - WS-03: `POST /rooms` (public), `POST /rooms/{id}/join` (AC-ROOM-05),
    `POST /rooms/{id}/members/{uid}/remove` (AC-MOD-02),
    `GET /rooms/{id}/bans` (AC-MOD-03).
  - WS-06: `POST /chats/{chatId}/attachments` (AC-ATT-01),
    `GET /attachments/{id}/download` (AC-ATT-03).
  - WS-02: register + session cookies.

  The spec proves the AC-ATT-03 authorization rule ("download follows
  current membership") composes correctly with the AC-MOD-02 moderation
  state in production — without using the WS-06 test-only helper
  `POST /__test/ws06/expire-membership` that the original
  `AC-ATT-03-current-auth.spec.ts` still relies on.

  The ban + re-join assertion (AC-ROOM-06) ensures the former-member
  status is durable: an ex-member cannot regain download access simply
  by re-entering the room.

- `docs/traceability.md` — status-block extension for the WS-08
  2026-04-20 autorun with a bullet documenting the new composite spec.

### Files touched (follow-up)

- `e2e/specs/AC-ATT-03-via-moderation.spec.ts` (new)
- `docs/traceability.md` (status block extended)
- `docs/workstream-notes/ws-08-progress.md` (this section)

No new endpoints, schemas, or DB changes. No removal of the WS-06
test-only helper (still used by `AC-ATT-03-current-auth.spec.ts`; its
removal, if desired, is a WS-06 cleanup).

### Still deferred after this slice

- Composite specs still to land: "reconnect → gap repair" (unblocked),
  "multi-tab → online/AFK/offline" (unblocked), "send → unread →
  delivery" (partially covered).
- 30-day attachment hard-purge job.
- Metrics / counters surface.

---

## Follow-up slice (same autorun day, third pass)

### Scope

The moderation-composite slice merged via #45. While still on
`feature/WS-08-autorun-20260420`, pick up the next of the deferred
cross-workstream composite specs: the **send message → unread update →
websocket delivery** flow. The test-ownership table in
`docs/workstreams/workstream-dependency-and-interface-map.md` assigns
this composite to WS-08 (depends on WS-04, WS-05, WS-07). It was
previously marked "partially covered by AC-RT-01 / AC-UNREAD-*" — the
per-AC specs each exercise one leg but none proves consistency across
the legs on a single send timeline.

### What this slice adds

- `e2e/specs/AC-RT-01-composite-send-unread-delivery.spec.ts` (new).
  End-to-end integration test that chains real endpoints from three
  workstreams on one user timeline:
  - WS-03: `POST /rooms` (AC-ROOM-01), `POST /rooms/{id}/join`
    (AC-ROOM-05).
  - WS-04: `POST /chats/{id}/messages` (AC-MSG-01),
    `GET /chats/{id}/read-state` (AC-UNREAD-01),
    `POST /chats/{id}/read` (AC-UNREAD-03).
  - WS-05: `/ws` + `chat.subscribe` + `message.created` (AC-RT-01).

  The spec exercises four legs:
  1. Offline unread — Alice sends with Bob disconnected; Bob's REST
     read-state reports `hasUnread=true, headSequence=1`.
  2. Live delivery — Bob subscribes; Alice's next send lands on Bob's
     socket as `message.created` with the correct sequence and head.
  3. Live-delivery-does-not-advance — after leg 2, Bob's REST
     read-state still reports `hasUnread=true`, proving that WS
     delivery does not silently advance the watermark.
  4. Post-advance consistency — Bob advances via `POST /chats/{id}/read`
     (unread clears), then Alice's next send BOTH delivers
     `message.created` on Bob's still-open socket AND reopens unread
     on the HTTP surface.

  Assertion power the per-AC specs don't carry: one write, two
  consistent surfaces, in both the pre- and the post-advance state.

- `docs/traceability.md` — status-block extension for the WS-08
  2026-04-20 autorun with a bullet documenting the new composite spec;
  the "still deferred" list loses the "send → unread → delivery" item.

### Files touched (follow-up)

- `e2e/specs/AC-RT-01-composite-send-unread-delivery.spec.ts` (new)
- `docs/traceability.md` (status block extended)
- `docs/workstream-notes/ws-08-progress.md` (this section)

No new endpoints, schemas, or DB changes.

### Still deferred after this slice

- Composite specs still to land: "reconnect → gap repair" (unblocked
  by AC-RT-02/04), "multi-tab → online/AFK/offline" (unblocked by
  AC-PRES-01..04).
- 30-day attachment hard-purge job.
- Metrics / counters surface.
