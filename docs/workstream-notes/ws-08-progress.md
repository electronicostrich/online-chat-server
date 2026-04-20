# WS-08 autorun progress — 2026-04-19

Branch: `feature/WS-08-autorun-20260419`

## Scope decision

WS-08 (Integration, Seed Data, Observability, and Hardening) owns seed
data + developer fixtures, cross-workstream E2E coverage, structured
logging / metrics wiring, health/readiness probes, chaos/recovery
scenarios, and the local developer workflow.

The full WS-08 surface is broad. Given the 80-turn autorun budget and
the fact that several upstream ACs WS-08 would integration-test are
still deferred (AC-RT-02/04 sync/reconnect, AC-PRES-01..04 multi-tab
presence, AC-MOD-* moderation endpoints), this PR targets the **seed
data + developer fixture** slice. It is the highest-leverage WS-08
deliverable that is fully unblocked today and unblocks every downstream
manual-testing and demo flow.

### In scope for this PR

1. **Real `pnpm --filter api db:seed`** — replace the stub
   (`echo "not yet implemented (WS-02)"`) with a deterministic dev seed.
   The seed writes four fixture users (alice/bob/charlie/dana), two
   public rooms, one private room, the membership rows that make alice
   owner of each and bob admin of one, a friendship between alice and
   bob, a block from charlie to dana, and a handful of sample messages
   so the chat list is non-empty on first boot. Idempotent: safe to
   re-run. Pure INSERT … ON CONFLICT DO NOTHING — no destructive SQL
   (see `docs/ai-development-guardrails.md` §5.5).
2. **`/__test/seed` upsert strategy** — the handler currently throws
   501 on `strategy: 'upsert'` with a `WS-08` deferral comment. Landed
   as a real upsert so repeated /__test/seed calls from a single
   Playwright fixture can layer state without a full truncate. Scoped
   to the same entity set the `truncate` strategy already handles
   (users / friendships / blocks / room memberships), because extending
   past that requires WS-03 HTTP surface that hasn't landed yet.
3. **Unit tests for the seed entrypoint** — asserts the seed function
   is pure-INSERT (no TRUNCATE / DROP) via module-import introspection
   and asserts the upsert branch of `/__test/seed` is reachable under
   `NODE_ENV=test`.
4. **Docs** — `docs/runtime-and-environment.md` §8 updated to describe
   what the seed produces so a first-time developer knows which
   credentials work; `docs/testing-strategy.md` §4.3 updated to remove
   the "upsert deferred" note.

### Deferred within WS-08 (follow-up PRs)

- **Cross-workstream integration specs** — the test-ownership table
  (`docs/workstreams/workstream-dependency-and-interface-map.md`)
  assigns to WS-08: "send→unread→delivery", "reconnect→gap repair",
  "upload→remove-from-room→lose access", "multi-tab→online/AFK/offline".
  The first is partially covered by `AC-RT-01`; the next two depend on
  AC-RT-02/04 and AC-MOD-02 which are still deferred upstream; the last
  depends on AC-PRES-01..04 which is deferred in WS-05. A dedicated
  WS-08 regression spec that composes the AC-level specs into a single
  "developer smoke" path lands after the upstream pieces arrive.
- **Readyz endpoint + observability baseline** — a new
  `docs/observability.md` (planned, not yet committed) plus
  `GET /readyz` are separable from the seed work and warrant their own
  PR alongside a metrics surface decision. Current `GET /healthz`
  already covers db / redis / attachments, so liveness is not broken.
- **30-day attachment hard-purge job** — called out in
  `docs/workstream-notes/ws-06-progress.md`; needs a scheduled-job
  runner which is a separate scoping conversation.
- **Metrics / counters** — Pino request logging is already enabled.
  A structured metrics surface (Prometheus-text or /metrics JSON) is a
  future WS-08 PR once we know what we need to instrument.

## Interfaces handed to other workstreams

- **All streams**: `pnpm --filter api db:seed` is now a usable local
  bootstrap step. The seeded credentials are documented in
  `docs/runtime-and-environment.md` §8. Passwords are intentionally
  well-known strings — the seed is dev-only and
  `apps/api/src/db/seed.ts` refuses to run under `NODE_ENV=production`.
- **WS-02 / WS-03 / WS-04 Playwright suites**: `/__test/seed` now
  supports `strategy: 'upsert'` so a spec that only needs to *add* a
  fixture user on top of an already-populated DB can do so without
  truncating other specs' state. The existing `truncate` strategy
  remains the Playwright default.

## Final-phase status (end of autorun session)

All code commits pushed on `feature/WS-08-autorun-20260419`:

- `dd11616` — chore: progress note (opens draft PR)
- `4a29b17` — AC-BOOT-00: real `pnpm db:seed`
- `55e7a16` — AC-BOOT-00: upsert strategy + unit tests + docs
- `69ba8c5` — fix: CodeRabbit round-1 (room-lookup normalisation, room race, message-dedup race)
- `ed99d35` — fix: CodeRabbit round-2 (test normalization + mock-ordering comment)
- `4dcf05d` — fix: target-less ON CONFLICT for username_canonical parity

Seven CodeRabbit threads landed across the run; all have been addressed
(via commit) and resolved via the GraphQL resolveReviewThread mutation.
All CI jobs green on the final pushed commit (typecheck / lint / unit /
integration / e2e-smoke / check-pr-title / check-pr-description /
doc-consistency / schema-drift). CodeRabbit's final status is SUCCESS.
PR marked ready and the cascade-ready marker comment was posted so the
coordinator will pick it up.

## Files likely touched

- `apps/api/package.json` (db:seed script pointing at a real entrypoint)
- `apps/api/src/db/seed.ts` (new)
- `apps/api/src/routes/test-seed.ts` (upsert branch implementation)
- `apps/api/test/unit/plugins/test-seed.test.ts` (upsert coverage)
- `apps/api/test/unit/db/seed.test.ts` (new)
- `docs/runtime-and-environment.md` (seed output description)
- `docs/testing-strategy.md` (upsert strategy note updated)
- `docs/traceability.md` (AC-BOOT-00 row status line)
