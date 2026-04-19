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
# Production-image leakage check: __test routes must never reach the prod image.
RUN grep -R __test apps/api/dist/ && (echo "ERROR: __test routes leaked into prod build" && exit 1) || true
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
