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
# shared-schemas is imported at runtime via its package.json 'main' pointing at
# dist/index.js, so the dev image must build it before tsx starts watching.
# Without this, the container boots with ERR_MODULE_NOT_FOUND on first request.
RUN pnpm --filter shared-schemas build
EXPOSE 3000
CMD ["pnpm", "--filter", "api", "dev"]

FROM deps AS build
COPY . .
RUN pnpm --filter shared-schemas build && pnpm --filter api build

FROM base AS prod
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/shared-schemas/dist ./packages/shared-schemas/dist
COPY --from=build /app/node_modules ./node_modules
# Production-image leakage check: test files must never reach the prod image.
# The original 'grep ... || true' from stage-0-bootstrap.md \u00a713 was a no-op
# (flagged by CodeRabbit). Switched to checking for a committed test/ subtree
# in the compiled dist — tsc's rootDir:src should exclude them, but this
# belt-and-suspenders guard fails the build if any leak through.
RUN if [ -d apps/api/dist/test ] || find apps/api/dist -name '*.test.js' -print -quit | grep -q .; then \
      echo "ERROR: test files leaked into prod dist" >&2 && exit 1; \
    fi
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
