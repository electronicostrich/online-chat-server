# Online Chat Server

A self-contained, browser-based online chat application: public and private rooms,
one-to-one direct messages, friend lists, persistent history, unread indicators,
presence (online / AFK / offline), file and image attachments, active session
management, and room moderation. Runs locally via Docker Compose. The full product
scope is in [`docs/product-requirements.md`](docs/product-requirements.md).

## Quickstart

Prerequisites: [Docker](https://docs.docker.com/get-docker/) 24+ with Compose v2,
and `openssl` (preinstalled on macOS and most Linux distros). The stack publishes
host ports `3000` (API), `5173` (web), `5432` (postgres), `6379` (redis),
`1025` / `8025` (Mailpit SMTP and UI) — keep them free.

```bash
git clone <repo-url>
cd online-chat-server

# 1. Create env files. The api container reads .env.local; Compose reads .env
#    for ${VAR} interpolation.
cp .env.example .env.local

# 2. Replace the CHANGE_ME_32_BYTES placeholders with real 32-byte hex secrets.
sed -i.bak "s|SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env.local
sed -i.bak "s|CSRF_SECRET=.*|CSRF_SECRET=$(openssl rand -hex 32)|" .env.local
rm -f .env.local.bak
cp .env.local .env

# 3. Build and start the stack.
docker compose up
```

Once `web` reports healthy, open <http://localhost:5173>.

| Service | URL                                        |
| ------- | ------------------------------------------ |
| Web     | <http://localhost:5173>                    |
| API     | <http://localhost:3000/healthz>            |
| Mailpit | <http://localhost:8025> (captured outbound email) |

> **Compose file naming**: Docker Compose v2 reads `compose.yaml` natively — it is
> the modern equivalent of `docker-compose.yml`, and both filenames work with the
> `docker compose up` command.

### Shortcut

If you have `pnpm` and `node` on the host, [`scripts/dev-bootstrap.sh`](scripts/dev-bootstrap.sh)
does the env setup, runs `pnpm install`, brings the stack up with `--wait`, and
polls `/healthz` in one command:

```bash
./scripts/dev-bootstrap.sh
```

## Tearing down

```bash
docker compose down -v
```

The `-v` flag removes the postgres, redis, and attachment volumes — use it when
you want a clean slate.

## Where to go next

- [`docs/README.md`](docs/README.md) — full documentation index
- [`docs/runtime-and-environment.md`](docs/runtime-and-environment.md) — services, env vars, troubleshooting
- [`docs/repo-layout.md`](docs/repo-layout.md) — what lives where
- [`CLAUDE.md`](CLAUDE.md) — rules for AI coding sessions on this repo
