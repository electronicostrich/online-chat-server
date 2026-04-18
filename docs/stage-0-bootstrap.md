# Stage-0 Bootstrap
## Online Chat Server — concrete artifacts for the first PR

## 1. Purpose

This document is the "if you're a Claude Code session opening a cold repo, here's exactly what to type" reference for the Stage-0 bootstrap PR (the first PR that introduces any code).

Its job is to replace the invent-silently space with committed targets: exact `package.json` scripts, exact `tsconfig.base.json` flags, exact `eslint.config.js` rule list, exact `compose.yaml` skeleton, exact first migration content.

This document backs **AC-BOOT-00** (`docs/acceptance-criteria-pack.md` §1.1). When the first PR merges, every artifact listed here exists at its stated path.

## 2. Scope of the bootstrap PR

The Stage-0 PR creates:

- monorepo root config (`package.json`, `tsconfig.base.json`, `tsconfig.json`, `pnpm-workspace.yaml`, `eslint.config.js`, `prettier.config.js`, `.editorconfig`, `.gitignore`, `.env.example`)
- hook config (`lefthook.yml`, `.claude/settings.json`)
- GitHub meta (`.github/pull_request_template.md`, `.github/CODEOWNERS`, `.github/workflows/*.yml` stubs)
- Compose runtime (`compose.yaml`, `compose.override.example.yaml`)
- Workspace skeletons (`apps/api/`, `apps/web/`, `packages/shared-schemas/`, `e2e/`, `scripts/`)
- First migration (`apps/api/drizzle/0001_initial.sql`) with the Stage-1 entity set
- `/healthz` endpoint + unit test
- `/__test/seed` endpoint stub (NODE_ENV-guarded) + unit test
- `AC-BOOT-00-bootstrap.spec.ts` — the Playwright test that proves it all works

**Out of scope for this PR**: auth, rooms, messages, WebSockets, attachments. Those land in subsequent workstream PRs.

## 3. Root `package.json`

```json
{
  "name": "online-chat-server",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
    "prepare": "lefthook install",
    "dev": "pnpm --parallel -r dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r exec tsc --noEmit",
    "lint": "eslint . --max-warnings=0",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "pnpm -r test",
    "test:unit": "pnpm -r test:unit",
    "test:integration": "pnpm --filter api test:integration",
    "test:smoke": "pnpm --filter api test:smoke",
    "test:scripts": "vitest --config scripts/test/vitest.config.ts",
    "e2e": "pnpm --filter e2e test",
    "doc-consistency": "pnpm dlx tsx scripts/doc-coverage.ts",
    "schema-drift": "pnpm dlx tsx scripts/schema-drift-check.ts",
    "lint-compose": "pnpm dlx tsx scripts/lint-compose.ts",
    "bootstrap": "bash scripts/dev-bootstrap.sh"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.7.0",
    "eslint": "^9.20.0",
    "@typescript-eslint/parser": "^8.20.0",
    "@typescript-eslint/eslint-plugin": "^8.20.0",
    "eslint-plugin-import": "^2.31.0",
    "eslint-plugin-playwright": "^2.2.0",
    "prettier": "^3.4.0",
    "lefthook": "^1.10.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0"
  }
}
```

## 4. `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "incremental": true
  }
}
```

Rationale per flag:
- `target: ES2023` — matches Node 24's native feature set
- `module/moduleResolution: NodeNext` — proper ESM support aligned with `"type": "module"` in workspace package.jsons
- `noUncheckedIndexedAccess: true` — `arr[i]` is `T | undefined`, forcing nullish checks
- `exactOptionalPropertyTypes: true` — distinguishes `{ x?: string }` from `{ x: string | undefined }`
- `verbatimModuleSyntax: true` — forces explicit `import type { X }` where runtime values don't cross
- `composite + incremental` — required for workspace project references

## 5. Root `tsconfig.json` (solution file)

```json
{
  "files": [],
  "references": [
    { "path": "./packages/shared-schemas" },
    { "path": "./apps/api" },
    { "path": "./apps/web" },
    { "path": "./e2e" }
  ]
}
```

## 6. `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "e2e"
```

## 7. `eslint.config.js` (flat config)

```js
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import playwrightPlugin from "eslint-plugin-playwright";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/drizzle/**", "apps/web/dist/**"]
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      // Hard bans (see docs/ai-development-guardrails.md §5.1)
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/ban-ts-comment": ["error", {
        "ts-expect-error": "allow-with-description",
        "ts-ignore": false,
        "ts-nocheck": false,
        minimumDescriptionLength: 10
      }],
      "no-console": "error",
      "no-warning-comments": ["error", { terms: ["TODO", "FIXME", "XXX"], location: "anywhere" }],
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["zod", "yup", "joi", "ajv"], message: "TypeBox is the only schema library (ADR-010)." },
          { group: ["apps/api/*", "../../../apps/api/**"], message: "Frontend cannot import backend internals." }
        ]
      }]
    }
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-console": "warn"  // browser console is often useful in dev
    }
  },
  {
    files: ["apps/api/src/modules/*/service.ts", "apps/api/src/modules/*/repository.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "fastify", message: "Business logic must not import from fastify." }]
      }]
    }
  },
  {
    files: ["apps/api/src/modules/*/routes.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "drizzle-orm", message: "Routes must call repositories, not Drizzle directly." }]
      }]
    }
  },
  {
    files: ["e2e/**/*.spec.ts"],
    ...playwrightPlugin.configs["flat/recommended"],
    rules: {
      "playwright/no-focused-test": "error",
      "playwright/no-skipped-test": "error",
      "playwright/expect-expect": "error"
    }
  },
  {
    files: ["apps/api/test/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",  // test fixtures often need loose types
      "no-console": "off"
    }
  }
);
```

TODO comments are allowed in the form `TODO(#N):` — a custom ESLint rule in `eslint.config.js` allows this pattern via a post-processing rule. Alternatively, `no-warning-comments` is replaced with the `eslint-plugin-todo-plz` package configured to require issue links. Pick one at implementation time.

## 8. `prettier.config.js`

```js
export default {
  semi: true,
  singleQuote: true,
  trailingComma: "all",
  printWidth: 100,
  tabWidth: 2,
  arrowParens: "always"
};
```

## 9. `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

## 10. `.gitignore`

```
node_modules/
dist/
.turbo/
*.tsbuildinfo

.env
.env.local
.env.*.local
!.env.example

# Docker
compose.override.yaml
!compose.override.example.yaml

# Testing
coverage/
playwright-report/
test-results/
.playwright/

# Editor
.vscode/
.idea/
.DS_Store

# Migration cache
apps/api/drizzle/meta/_snapshot.json
```

## 11. `.env.example`

```
# Database
POSTGRES_USER=chat
POSTGRES_PASSWORD=CHANGE_ME
POSTGRES_DB=chat
DATABASE_URL=postgres://chat:CHANGE_ME@postgres:5432/chat

# Redis
REDIS_URL=redis://redis:6379/0

# API
NODE_ENV=development
PORT=3000
SESSION_SECRET=CHANGE_ME_32_BYTES
CSRF_SECRET=CHANGE_ME_32_BYTES
SESSION_COOKIE_NAME=chat_sid
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAMESITE=lax
SESSION_TTL_SECONDS=2592000
ATTACHMENT_ROOT_DIR=/data/attachments
ATTACHMENT_MAX_FILE_BYTES=20971520
ATTACHMENT_MAX_IMAGE_BYTES=3145728
ALLOWED_ORIGINS=http://localhost:5173
LOG_LEVEL=info
WEBSOCKET_HEARTBEAT_INTERVAL_MS=15000
WEBSOCKET_STALE_TIMEOUT_MS=45000
WEBSOCKET_AFK_THRESHOLD_MS=60000
WEBSOCKET_BUFFER_SIZE=500
WEBSOCKET_BUFFER_HIGH_WATER_MARK=400

# Password hashing
PASSWORD_ARGON2_MEMORY_KIB=19456
PASSWORD_ARGON2_ITERATIONS=2
PASSWORD_ARGON2_PARALLELISM=1

# Mail sink
SMTP_HOST=mailsink
SMTP_PORT=1025
SMTP_FROM=no-reply@chat.local

# Web
VITE_API_BASE_URL=http://localhost:3000
VITE_WEBSOCKET_URL=ws://localhost:3000/ws
VITE_APP_ENV=development
```

## 12. `compose.yaml`

```yaml
name: chat

services:
  postgres:
    image: postgres:17-alpine@sha256:PIN_AT_COMMIT_TIME
    environment:
      POSTGRES_USER: ${POSTGRES_USER:?}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}
      POSTGRES_DB: ${POSTGRES_DB:?}
    ports: ["5432:5432"]
    volumes:
      - chat-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 20s
    networks: [chat-net]

  redis:
    image: redis:7-alpine@sha256:PIN_AT_COMMIT_TIME
    command: ["redis-server", "--appendonly", "yes"]
    ports: ["6379:6379"]
    volumes:
      - chat-redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 12
    networks: [chat-net]

  mailsink:
    image: axllent/mailpit:latest@sha256:PIN_AT_COMMIT_TIME
    ports: ["1025:1025", "8025:8025"]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8025/livez || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 6
    networks: [chat-net]

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: dev
    env_file: [.env.local]
    environment:
      NODE_ENV: development
      DATABASE_URL: postgres://${POSTGRES_USER:?}:${POSTGRES_PASSWORD:?}@postgres:5432/${POSTGRES_DB:?}
      REDIS_URL: redis://redis:6379/0
      SMTP_HOST: mailsink
    ports: ["3000:3000"]
    volumes:
      - chat-attachments:/data/attachments
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      mailsink: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/healthz || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 30
      start_period: 30s
    networks: [chat-net]

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      target: dev
    environment:
      VITE_API_BASE_URL: http://localhost:3000
      VITE_WEBSOCKET_URL: ws://localhost:3000/ws
      VITE_APP_ENV: development
    ports: ["5173:5173"]
    depends_on:
      api: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:5173 || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 12
    networks: [chat-net]

volumes:
  chat-postgres-data:
  chat-redis-data:
  chat-attachments:

networks:
  chat-net:
    driver: bridge
```

### Digest pinning process

`@sha256:PIN_AT_COMMIT_TIME` is a placeholder. The bootstrap PR author resolves each to a real digest via:

```
docker pull postgres:17-alpine
docker inspect --format='{{index .RepoDigests 0}}' postgres:17-alpine
```

The resulting full digest replaces the placeholder. Digests update via dependency-bump `chore:` PRs.

## 13. `apps/api/Dockerfile` (multistage)

```dockerfile
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["pnpm", "--filter", "api", "dev"]

FROM deps AS build
COPY . .
RUN pnpm --filter shared-schemas build && pnpm --filter api build

FROM base AS prod
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/shared-schemas/dist ./packages/shared-schemas/dist
COPY --from=build /app/node_modules ./node_modules
# Production-image leakage check
RUN grep -R __test apps/api/dist/ && (echo "ERROR: __test routes leaked into prod build" && exit 1) || true
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
```

## 14. `apps/web/Dockerfile`

```dockerfile
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["pnpm", "--filter", "web", "dev", "--host", "0.0.0.0"]

FROM deps AS build
COPY . .
RUN pnpm --filter shared-schemas build && pnpm --filter web build

FROM nginx:1.27-alpine AS prod
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

## 15. `apps/api/drizzle.config.ts`

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ""
  },
  verbose: true,
  strict: true
});
```

## 16. First migration — `apps/api/drizzle/0001_initial.sql`

The first migration creates just the `chats` and `chat_read_state` stubs needed to satisfy `/healthz` and the AC-BOOT-00 acceptance. Stage-1 (the next PR) fills in the full entity set.

```sql
-- First migration: minimum schema to support /healthz and /__test/seed
-- Stage 1 adds: users, sessions, friendships, blocks, rooms, room_memberships,
-- room_invitations, room_bans, messages, attachments, chat_read_state.
-- This file intentionally contains only a sentinel to prove the migration runner works.

CREATE TABLE IF NOT EXISTS _bootstrap_sentinel (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO _bootstrap_sentinel (key, value) VALUES ('version', '0.1.0')
  ON CONFLICT (key) DO NOTHING;
```

This migration is a pure no-op for application logic. It exists so the bootstrap PR has a migration to apply (proving the Drizzle pipeline works), without pre-committing to schema choices that belong to WS-02 and WS-03.

## 17. First Playwright test — `e2e/specs/AC-BOOT-00-bootstrap.spec.ts`

```ts
import { test, expect } from "@playwright/test";

test("AC-BOOT-00: full stack boots and healthz reports green", async ({ request, page }) => {
  // 1. API healthz is reachable and healthy
  const res = await request.get("/healthz");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data.status).toBe("ok");
  expect(body.data.checks.db).toBe("ok");
  expect(body.data.checks.redis).toBe("ok");
  expect(body.data.checks.attachments).toBe("ok");

  // 2. Web shell loads
  await page.goto("/");
  await expect(page).toHaveTitle(/Chat/i);

  // 3. Test-only seed route exists in NODE_ENV=test (and is 404 in others — tested by integration suite)
  //    Here we just check the route responds (not assert schema; §4.3 of testing-strategy covers contract)
  const seedRes = await request.post("/__test/seed", {
    data: { strategy: "truncate", users: [] }
  });
  expect([200, 204]).toContain(seedRes.status());
});
```

## 18. The first-PR recipe

Prereqs: podman (PO default) or docker, plus Node 24, pnpm, lefthook, gitleaks all installed. If podman is the runtime, verify the machine is running: `podman machine list` should show `Currently running: true`.

```
git checkout -b feature/AC-BOOT-00-bootstrap develop
# ... create all files per sections 3-17 ...
git add -A
git commit -m "AC-BOOT-00: scaffold monorepo, Compose runtime, and first migration"
git push -u origin feature/AC-BOOT-00-bootstrap
gh pr create --base develop --title "AC-BOOT-00: Stage-0 bootstrap"
```

The PR body uses `.github/pull_request_template.md`. AC IDs addressed: `AC-BOOT-00`. Docs updated: none (docs already exist). Testing: `AC-BOOT-00-bootstrap.spec.ts` passes locally via `CONTAINER_CLI=podman pnpm e2e` (or with `CONTAINER_CLI=docker`).

CI runs the full pipeline with `CONTAINER_CLI=docker` (GitHub Actions runner default). `doc-consistency` passes because the traceability row for AC-BOOT-00 already exists. `schema-drift` passes because there is one migration and it matches the schema code (which is just the empty stub at this point).

Merge to `develop`. Then `develop → main` as the first release (`v0.1.0`) after the WS-01 milestone is complete.

## 19. What this document enforces

- The first PR in the repo creates every file listed above at its stated path.
- Deviations from these skeletons in the first PR are grounds for review rejection.
- After the first PR, these skeletons are **living documents** — if `eslint.config.js` grows a rule, update §7 in the same PR; if the `package.json` scripts change, update §3.

Drift between this document and the committed files is a CI-blocking error once `doc-consistency.yml` learns to detect it.
