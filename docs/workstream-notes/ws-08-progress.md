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

No DB schema changes. No destructive SQL. No `zod`/`any`/etc.
