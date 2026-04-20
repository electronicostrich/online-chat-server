# Observability

## Online Chat Server

## 1. Purpose

This doc is the baseline for "how do I see what the running API is
doing". It covers what is implemented today (logging, request IDs,
health + readiness probes) and the near-term plan for metrics and
tracing.

Observability is owned by WS-08 (see
`docs/workstreams/proposed-workstreams.md` — the workstream's
deliverable list includes "structured logs and metrics wiring",
"health checks and readiness checks", and "diagnostic logging
baseline"). New observability surface — an endpoint, a log field, a
metric — lands here so operators and future maintainers have one
place to look.

## 2. Logging

### 2.1 Library and level

Pino (`pino`) is the single logger. It is configured in
`apps/api/src/logger.ts`. Log level is read from `LOG_LEVEL` (env
var), defaulting per `docs/runtime-and-environment.md`.

- Under `NODE_ENV=development` the logger uses `pino-pretty` transport
  for human-friendly stdout.
- Under `NODE_ENV=test` / `production` the logger emits compact JSON
  on stdout. A container runtime (compose, ECS, Kubernetes) is
  expected to forward stdout to the centralised log sink.

### 2.2 No `console.*`

`console.log` / `console.error` / friends are banned in
`apps/api/src/**` (ESLint `no-console: error` + Claude Code Write
hook — see `docs/ai-development-guardrails.md` §5.1). Use
`req.log` (a child logger that already carries `reqId`) inside
request handlers, or `logger` (the module-level export) in
bootstrap code.

### 2.3 Request IDs

Every HTTP request is assigned a UUIDv4 `reqId` at the Fastify layer
(`genReqId` in `apps/api/src/server.ts`). The id:

- is attached to every log line Fastify emits for that request;
- is surfaced to clients as `error.traceId` in the error envelope
  (see `docs/error-envelope-and-conventions.md` and `api-and-events.md`
  §5.0);
- may be propagated into WebSocket event metadata in a future step —
  not yet wired.

When troubleshooting a failing request, the `traceId` returned in the
HTTP error envelope is the canonical log key — `grep` for it against
the pod's stdout.

### 2.4 What is logged at what level

The project does not hand-write per-endpoint request/response logs —
Fastify's built-in request logger (`disableRequestLogging: false`)
handles the request/response pair at `info`. Error-handler code paths
promote 5xx to `error` in `apps/api/src/server.ts`; 4xx domain denials
stay silent to keep the log signal clean.

Ad-hoc `req.log.debug` calls are allowed in service code, but prefer
structured fields (`req.log.info({ room: roomId }, 'room created')`)
over format-string interpolation so downstream log tooling can filter
by field.

## 3. Health and readiness probes

The API exposes two unauthenticated probe endpoints. They are the
seam between the process and the orchestrator (Docker Compose today,
Kubernetes-style liveness/readiness in the future).

| Endpoint    | Semantics                     | Used by                   |
| ----------- | ----------------------------- | ------------------------- |
| `GET /healthz` | Is the process up and can it reach its managed dependencies? | `compose.yaml` `healthcheck` — blocks `depends_on: service_healthy` |
| `GET /readyz`  | Is the process ready to serve request traffic right now?     | Future K8s readinessProbe; today: documentation + smoke coverage     |

Both endpoints:

- require no authentication and are not CSRF-protected;
- are not rate-limited (they are hit at probe frequency);
- return `200` with a `data`-wrapped success envelope when everything
  checks out, or `503` with an error envelope whose `error.code` is
  `SERVICE_UNAVAILABLE` and whose `error.details.failing` lists the
  check names that failed.

The full wire contracts live in `docs/api-and-events.md` §5.10. The
rest of this section explains the semantic distinction so a future
contributor knows where to add a new check.

### 3.1 What `/healthz` checks

- `db`: `SELECT 1` against PostgreSQL (250 ms timeout).
- `redis`: `PING` expecting `PONG` (250 ms timeout).
- `attachments`: `ATTACHMENT_ROOT_DIR` is reachable and writable
  (250 ms timeout).

If any of these fail, the process is treated as liveness-compromised
and compose's `depends_on.service_healthy` holds until they recover.
The version string comes from `apps/api/package.json`, read once at
startup.

### 3.2 What `/readyz` checks

Everything `/healthz` checks, plus:

- `migrations`: the number of rows in the `_migrations` bookkeeping
  table is at least the number of `*.sql` files shipped under
  `apps/api/drizzle/`. This prevents a newly-booted pod whose
  migrations never ran from being added to a load balancer.

`/readyz` is the probe a rolling-deploy orchestrator should call to
decide when a new replica is eligible for traffic. `/healthz` is the
probe it should call to decide whether to restart a replica that has
been running for a while but is no longer responsive.

In the MVP the two probes share the base `db` / `redis` /
`attachments` sub-checks, so those dependencies failing will fail both
probes — whether that triggers a restart, a removal from the load
balancer, or both depends entirely on orchestrator policy, not on
the API's own behavior. The real value of the split today is
isolating the migration-gating check: `/readyz` fails when migrations
haven't run, `/healthz` does not, so a partially-booted pod is
correctly "not ready" without also looking "not alive". Splitting out
additional concerns per-probe (e.g., moving Redis into `/readyz`
only) is a follow-up if and when rolling deploys care about it.

For the MVP we expose both; compose continues to use `/healthz` so
the existing `depends_on` wiring is unchanged.

### 3.3 Adding a new check

1. Decide: is the new dependency "needed for this process to be
   alive" (→ add to `/healthz`) or "needed for the process to serve
   request traffic right now" (→ add to `/readyz`)?
2. Add the TypeBox status field to the matching schema
   (`packages/shared-schemas/src/schemas/healthz.ts` or
   `readyz.ts`).
3. Add the probe to `apps/api/src/routes/healthz.ts` or
   `readyz.ts`. Use `withTimeout` — every check must fail fast, since
   the probe endpoint itself is hit at high frequency.
4. Add a row to the table in `api-and-events.md` §5.10.
5. Document the semantic in this file's §3.1 or §3.2.

## 4. Metrics (planned)

No `/metrics` endpoint is served today. When it lands, it will:

- be registered here;
- follow the Prometheus text exposition format;
- expose at minimum: HTTP request counts + latency histogram by route
  and status class, WebSocket event counts by type, database query
  latency histogram, attachment-storage bytes written.

Until then, log-based counting is the recommended fallback: every
Fastify request emits a JSON line with `res.statusCode` and
`responseTime`, and a log aggregator can derive counters from it.

## 5. Tracing (planned)

OpenTelemetry is not wired today. When it lands, the existing
`reqId` will become the trace ID so retrospective correlation between
pre-OTel logs and post-OTel traces is possible.

## 6. Local operations cheat sheet

- **Tail API logs (pretty)** — `docker compose logs -f api`.
- **Probe liveness** — `curl -fsS http://localhost:3000/healthz | jq`.
- **Probe readiness** — `curl -fsS http://localhost:3000/readyz | jq`.
  A non-200 response indicates the API is not accepting traffic; read
  `error.details.failing` for the short list.
- **Find log lines for a failed request** — copy the `traceId` value
  out of the error response and `grep` it in the API log stream.

## 7. Related docs

- `docs/runtime-and-environment.md` — env vars, compose, local boot.
- `docs/api-and-events.md` §5.10 — wire contracts for `/healthz` and
  `/readyz`.
- `docs/error-envelope-and-conventions.md` — `traceId` field and
  envelope shape.
- `docs/ai-development-guardrails.md` §5.1 — `no-console` rule.
- `docs/workstreams/proposed-workstreams.md` WS-08 — ownership.
