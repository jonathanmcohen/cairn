# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
# pnpm-workspace.yaml carries the pnpm 10+ allowBuilds + minimumReleaseAgeExclude
# policy; without it the in-container `pnpm install --frozen-lockfile` applies
# pnpm's default minimum-release-age policy and rejects freshly-published deps
# (ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time placeholder env vars so the Next.js page-data collection passes
# env validation. These are NOT baked into the runtime image; they are
# overridden by real values when the container starts.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
ENV AUTH_SECRET=build-only-placeholder-secret-32chars
ENV NEXTAUTH_URL=http://localhost:3000
# v0.7.0 trips Node's default ~2 GB old-space limit during `next build` (SWC +
# Turbopack workload). 6 GB matches the CI workflow's NODE_OPTIONS so the
# Docker build behaves the same as CI.
ENV NODE_OPTIONS=--max-old-space-size=6144
RUN pnpm build

FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# v0.9.0 G8 P41 — cairn-upgrade CLI spawns pg_dump + psql for snapshot/
# restore during upgrade orchestration. The postgresql-client package on the
# Alpine repo ships both binaries (~6 MB compressed). Pinned to v17 so the
# wire-protocol matches the Postgres 17/18 server image used in production.
RUN apk add --no-cache postgresql17-client

RUN addgroup -g 1001 -S cairn && adduser -u 1001 -S cairn -G cairn

# Standalone bundle from Next.js
COPY --from=builder --chown=cairn:cairn /app/.next/standalone ./
COPY --from=builder --chown=cairn:cairn /app/.next/static ./.next/static
COPY --from=builder --chown=cairn:cairn /app/public ./public

# Drizzle migration files + transpiled entrypoint + minimal deps
COPY --from=builder --chown=cairn:cairn /app/drizzle ./drizzle
COPY --from=builder --chown=cairn:cairn /app/dist ./dist
COPY --from=deps --chown=cairn:cairn /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps --chown=cairn:cairn /app/node_modules/postgres ./node_modules/postgres
COPY --from=deps --chown=cairn:cairn /app/node_modules/dotenv ./node_modules/dotenv
# zod is bundled into the Next standalone server chunks (not left in
# node_modules), so the separate dist/ tree (e.g. embed-page CLI via
# dist/lib/env.js) can't resolve it. Copy it explicitly. zod is dependency-free.
COPY --from=deps --chown=cairn:cairn /app/node_modules/zod ./node_modules/zod

RUN mkdir -p /data/uploads && chown -R cairn:cairn /data
VOLUME ["/data/uploads"]

USER cairn
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/server/entrypoint.js"]
