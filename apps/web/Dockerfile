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
