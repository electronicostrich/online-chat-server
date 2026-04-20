# Runtime and Environment
## Online Chat Server

## 1. Purpose

This document defines the local runtime topology, services, networking, volumes, and complete environment variable reference. It is the authority for what `compose.yaml` must contain. A CI check (`lint-compose.ts`) diffs the Compose file against the service and port tables below.

Deployment targets beyond local Compose are out of scope for the MVP.

## 1.1 Container runtime — podman or docker

The project supports **any OCI-compatible runtime with a Compose v2 front-end.** The two officially supported paths:

| Runtime | CLI invocation | Primary use |
|---|---|---|
| **Podman** | `podman compose …` | PO's local development (rootless by default) |
| **Docker** | `docker compose …` | Collaborator default (post-MVP); GitHub Actions runner |

Both tools read the same `compose.yaml` file; both build the same `Dockerfile`; both respect the same `.env.local`. The one name difference you might notice: podman's native image-build filename is `Containerfile`, but `Dockerfile` is recognized by both — we use `Dockerfile` for cross-tool consistency.

### `CONTAINER_CLI` convention

Scripts that shell out to the runtime use `$CONTAINER_CLI` and fall back to auto-detection:

```bash
CONTAINER_CLI="${CONTAINER_CLI:-$(command -v podman 2>/dev/null || command -v docker)}"
[ -z "$CONTAINER_CLI" ] && { echo "podman or docker required"; exit 2; }
"$CONTAINER_CLI" compose up -d
```

The PO sets `CONTAINER_CLI=podman` in their shell rc; collaborators leave it unset (docker auto-detects). CI sets it to `docker` explicitly. Documentation uses `$CONTAINER_CLI compose …` in snippets; this is NOT a shell-variable tutorial — it's the convention every script MUST follow.

### Macos podman gotcha

On macOS, podman runs through a VM (`podman-machine-default` by default). Host bind mounts must be visible inside the VM. If `compose.override.yaml` mounts a host path under `/Users/...`, the podman machine init must include `--volume /Users:/Users` (which is the default for recent podman versions). If in doubt:

```bash
podman machine inspect podman-machine-default --format '{{.Mounts}}'
```

Docker Desktop has equivalent file-sharing config in its UI. This is a runtime-level concern, not a project-level one, but flagging here so a first-run crash doesn't feel like a bug in the compose file.

## 2. Services

The full stack runs as a single `docker compose up` invocation. All services attach to a single user-defined bridge network named `chat-net`.

| Service | Image (pinned) | Internal port | Host port | Purpose |
|---|---|---|---|---|
| `postgres` | `postgres:17-alpine@<digest>` | 5432 | 5432 | Durable system of record (ADR-008) |
| `redis` | `redis:7-alpine@<digest>` | 6379 | 6379 | Ephemeral coordination layer (ADR-008) |
| `mailsink` | `axllent/mailpit:latest@<digest>` | 1025 (SMTP), 8025 (UI) | 1025, 8025 | Password-reset mail capture in dev |
| `api` | built from `apps/api/Dockerfile` | 3000 | 3000 | Fastify backend + WebSocket gateway |
| `web` | built from `apps/web/Dockerfile` | 5173 | 5173 | Vite dev server (for local dev); production build served by Node in `api` if that mode is enabled |

Image digests MUST be pinned. The `@<digest>` placeholders are resolved during the initial `compose.yaml` commit and updated via dependency-bump PRs.

## 3. Volumes

| Volume | Mounted in service | Mount path (in container) | Purpose |
|---|---|---|---|
| `chat-postgres-data` | `postgres` | `/var/lib/postgresql/data` | Persistent DB storage |
| `chat-redis-data` | `redis` | `/data` | Redis AOF persistence (optional) |
| `chat-attachments` | `api` | `/data/attachments` | Attachment binaries (ADR-006) |

Source-code mounts for `api` and `web` are defined only in `compose.override.yaml` (gitignored) so hot-reload works in development without leaking dev config into the checked-in compose file.

## 4. Service dependencies and health checks

```
web → api → postgres
           ↘ redis
           ↘ mailsink
```

| Service | Healthcheck | Parameters |
|---|---|---|
| `postgres` | `pg_isready -U chat` | interval 5s, timeout 3s, retries 12, start_period 20s |
| `redis` | `redis-cli ping` expecting `PONG` | interval 5s, timeout 3s, retries 12 |
| `mailsink` | `wget -qO- http://localhost:8025/livez` | interval 10s, timeout 3s, retries 6 |
| `api` | `GET /healthz` returns 200 | interval 5s, timeout 3s, retries 30, start_period 30s (migrations run first) |
| `web` | `GET http://localhost:5173` returns 200 | interval 10s, timeout 3s, retries 12 |

`api` declares `depends_on: { postgres: { condition: service_healthy }, redis: { condition: service_healthy }, mailsink: { condition: service_healthy } }`. `web` depends on `api` being healthy.

## 5. API startup sequence

When the `api` container starts:

1. Load and validate environment variables against the TypeBox env schema (`apps/api/src/config/`). Missing required vars exit non-zero.
2. Run `drizzle-kit migrate` against `DATABASE_URL`. Idempotent; no-op when already up to date.
3. Open PostgreSQL connection pool and Redis client.
4. Register Fastify plugins (`@fastify/cookie`, `@fastify/csrf-protection`, `@fastify/cors`, `@fastify/websocket`, `@fastify/multipart`, `@fastify/swagger`, `@fastify/swagger-ui`).
5. Register route modules from `apps/api/src/modules/*`.
6. Start the scheduled cleanup job runner (`apps/api/src/jobs/`) with a 10-second jitter on first run.
7. Bind to `0.0.0.0:3000`.

## 6. Environment variables — canonical reference

Every environment variable used by any service. Required vars have no default; missing values fail startup. Optional vars have a default.

### 6.1 Backend (`api` service)

| Variable | Required | Default | Consumed by | Purpose |
|---|---|---|---|---|
| `NODE_ENV` | yes | — | api | `development` \| `test` \| `production` |
| `PORT` | no | `3000` | api | HTTP listen port |
| `DATABASE_URL` | yes | — | api | `postgres://user:pass@host:5432/dbname` |
| `REDIS_URL` | yes | — | api | `redis://host:6379/0` |
| `SESSION_COOKIE_NAME` | no | `chat_sid` | api | Cookie name for session identifier |
| `SESSION_COOKIE_DOMAIN` | no | (unset → request host) | api | Override if behind a proxy |
| `SESSION_COOKIE_SECURE` | no | `true` in production, `false` otherwise | api | Sets `Secure` flag |
| `SESSION_COOKIE_SAMESITE` | no | `lax` | api | `strict` \| `lax` \| `none` |
| `SESSION_TTL_SECONDS` | no | `2592000` (30 days) | api | Server-side session expiry |
| `SESSION_SECRET` | yes | — | api | Used to sign/verify the session cookie value; min 32 bytes |
| `CSRF_SECRET` | yes | — | api | Used to sign CSRF tokens; min 32 bytes |
| `PASSWORD_ARGON2_MEMORY_KIB` | no | `19456` | api | Argon2id memory parameter |
| `PASSWORD_ARGON2_ITERATIONS` | no | `2` | api | Argon2id iteration count |
| `PASSWORD_ARGON2_PARALLELISM` | no | `1` | api | Argon2id parallelism |
| `ATTACHMENT_ROOT_DIR` | no | `/data/attachments` | api | Filesystem root for attachments (ADR-006) |
| `ATTACHMENT_MAX_FILE_BYTES` | no | `20971520` (20 MiB) | api | Upper bound for file uploads |
| `ATTACHMENT_MAX_IMAGE_BYTES` | no | `3145728` (3 MiB) | api | Upper bound for image uploads |
| `SMTP_HOST` | no | `mailsink` | api | Mail sink host for password reset |
| `SMTP_PORT` | no | `1025` | api | Mail sink port |
| `SMTP_FROM` | no | `no-reply@chat.local` | api | `From` header for password reset mail |
| `ALLOWED_ORIGINS` | yes | — | api | Comma-separated list of allowed CORS origins (`http://localhost:5173` for dev) |
| `LOG_LEVEL` | no | `info` | api | Pino log level |
| `WEBSOCKET_HEARTBEAT_INTERVAL_MS` | no | `15000` | api | Expected client heartbeat cadence (architecture §12.3) |
| `WEBSOCKET_STALE_TIMEOUT_MS` | no | `45000` | api | Stale-socket threshold (architecture §12.3) |
| `WEBSOCKET_AFK_THRESHOLD_MS` | no | `60000` | api | AFK threshold across all live tabs (architecture §12.3) |
| `WEBSOCKET_BUFFER_SIZE` | no | `500` | api | Per-socket outbound event buffer (architecture §20.4) |
| `WEBSOCKET_BUFFER_HIGH_WATER_MARK` | no | `400` | api | Stop fan-out above this size and schedule disconnect (architecture §20.4) |

### 6.2 Frontend (`web` service)

Vite exposes any var starting with `VITE_` to the browser. Everything else is server-only and MUST NOT be prefixed with `VITE_`.

| Variable | Required | Default | Consumed by | Purpose |
|---|---|---|---|---|
| `VITE_API_BASE_URL` | no | `''` (same-origin) | web | REST base URL. Leave empty to route through the dev-server proxy (the default in compose); set to a fully qualified URL only when the SPA is served from a different origin than the API in deploy. |
| `VITE_WEBSOCKET_URL` | no | (same-origin `/ws`) | web | WebSocket URL. Default constructs `wss://` (or `ws://` for plain HTTP) plus `${location.host}/ws` so the dev-server WS proxy handles the upgrade. |
| `VITE_API_PROXY_TARGET` | no | `http://api:3000` | web (build-time, dev) | Tells the Vite dev-server proxy where to forward `/auth`, `/sessions`, `/rooms`, `/chats`, `/dm`, `/friends`, `/blocks`, `/messages`, `/attachments`, `/healthz`, `/__test`, and `/ws`. Override with `http://localhost:3000` when running `pnpm --filter web dev` outside compose. |
| `VITE_APP_ENV` | no | `development` | web | Shown in a "dev" badge when not production |

### 6.3 PostgreSQL service

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `POSTGRES_USER` | yes | `chat` | Superuser within the dev container only |
| `POSTGRES_PASSWORD` | yes | — | Set in `.env.local`, never committed |
| `POSTGRES_DB` | yes | `chat` | Database name |

The `DATABASE_URL` passed to `api` is constructed from these values in `compose.yaml`.

### 6.4 Redis service

No env vars required. Redis is configured via a `redis.conf` in `compose.yaml` if persistence is enabled.

### 6.5 Mail sink (Mailpit)

No env vars required. Exposed on host port 8025 for the developer to read captured mail in the browser.

## 7. Secrets and `.env.local`

- A file `.env.local` at the repo root holds secret values for local development.
- `.env.local` is git-ignored.
- A committed `.env.example` shows the required keys with placeholder values and a short description matching this table.
- CI does NOT use `.env.local`; CI sets env vars directly in the workflow.

Generate local secrets once:

```
pnpm dlx generate-secret --bytes 32   # SESSION_SECRET
pnpm dlx generate-secret --bytes 32   # CSRF_SECRET
```

(The `generate-secret` helper is a one-file TS script under `scripts/` — it is NOT a real pnpm package.)

## 8. Local bootstrap (first-time)

```
# 1. Clone and install
git clone <repo>
cd online-chat-server
pnpm install

# 2. Create local secrets
cp .env.example .env.local
# Edit .env.local: fill SESSION_SECRET and CSRF_SECRET with generated 32-byte values
#                  and a POSTGRES_PASSWORD of your choice.

# 3. Start the stack
docker compose up -d

# 4. Verify health
curl -s http://localhost:3000/healthz
# → {"status":"ok","checks":{"db":"ok","redis":"ok"}}

# 5. (Optional) seed dev data
pnpm --filter api db:seed
```

When all services are healthy, open `http://localhost:5173` in a browser.

## 9. Bootstrapping subsequent runs

```
docker compose up -d     # starts all services
pnpm --filter api dev    # only needed if running the API outside Compose for debugging
pnpm --filter web dev    # only needed if running the web outside Compose
```

For clean slate (destroys all local data):

```
docker compose down -v
```

## 10. CI runtime

CI uses GitHub Actions services for `postgres` and `redis` (see `docs/ci-pipeline.md` → `ci.yml`). It does NOT use Docker Compose, to keep CI fast and avoid image-pull cost. The API and web containers are built on-demand only by the E2E job, which runs against a full Compose stack for a single "smoke" run per PR.

## 11. Resource expectations

MVP is local-only. No performance SLAs are committed. Observed during initial dev:

- `postgres` idle: ~50 MiB RAM
- `redis` idle: ~20 MiB RAM
- `api` idle: ~80 MiB RAM
- `web` (Vite dev): ~200 MiB RAM

Total: well under 500 MiB. Runs on any developer laptop.

## 12. Troubleshooting

| Symptom | Likely cause | Remedy |
|---|---|---|
| `api` exits on startup with "DATABASE_URL is required" | Missing env var | Populate `.env.local`, ensure it's mounted in Compose |
| `api` hangs on "running migrations" | `postgres` not healthy yet | Wait for the healthcheck; check `docker compose logs postgres` |
| Login succeeds but API calls return 401 on next request | Cookie not sent back by the browser | Check `VITE_API_BASE_URL` origin matches `ALLOWED_ORIGINS`, and cookie `SameSite` / `Secure` are compatible with the scheme |
| WebSocket fails to connect | `VITE_WEBSOCKET_URL` wrong scheme (`ws` vs `wss`) | Match the API scheme; `ws://` for local HTTP |
| `GET /healthz` returns 503 with `"redis":"down"` | Redis container not running or unreachable | `$CONTAINER_CLI compose ps redis`, check logs |
| Podman: "Cannot connect to the Docker daemon" or socket errors | Podman machine not running | `podman machine start`. If persistent, `podman machine init --now` to recreate |
| Podman: bind mount shows empty directory inside container | Host path not in the podman-machine VM's mount set | Check `podman machine inspect --format '{{.Mounts}}'`; on recent podman `/Users` is mounted by default; if not, re-init with `podman machine init --volume /Users:/Users --now` |
| Testcontainers (integration tests) fails with "docker socket not found" on podman | Testcontainers hunts for a Docker socket; podman uses a different path | Set `export DOCKER_HOST=$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')` before `pnpm test:integration`. Or symlink: `ln -sf $(podman machine inspect podman-machine-default -f '{{.ConnectionInfo.PodmanSocket.Path}}') /var/run/docker.sock` (requires sudo). |
| CI green locally but red on GitHub Actions (or vice versa) | Runtime mismatch (podman locally, docker in CI) exposes a Compose-spec ambiguity | Pick whichever side is wrong per the Compose Specification and file an issue; the project's position is that both must work identically |

## 13. What this document enforces

- Any change to Compose services, ports, or volumes MUST update §2 / §3 / §4 here in the same PR.
- Any new environment variable MUST be added to §6 in the same PR that reads it. `scripts/lint-compose.ts` + `apps/api/src/config/` schema diffing flags drift.
- Any change to startup sequence, bootstrap steps, or troubleshooting entries MUST land here — the root README links here and does not duplicate runtime detail.
