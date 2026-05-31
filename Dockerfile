# syntax=docker/dockerfile:1.7
# Debian (glibc) base — NOT Alpine/musl. The local embedder pulls
# onnxruntime-node, whose prebuilt native binary is glibc-linked and cannot run
# on musl (even via gcompat it aborts at runtime). A glibc base is required for
# the bundled Xenova/all-MiniLM embedder to load.
ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
# Build toolchain for any dependency that compiles a native addon during
# `pnpm install` (e.g. cpu-features). bookworm-slim ships no compiler/python.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
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

# v0.9.0 G8 P41 — cairn-upgrade CLI spawns pg_dump + psql for snapshot/restore.
# Install the v17 client from the PGDG apt repo (bookworm ships only v15),
# matching the Postgres 17/18 server. wget backs the container HEALTHCHECK and
# the embed-smoke boot probe.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg wget \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 cairn \
 && useradd -u 1001 -g cairn -M -s /usr/sbin/nologin cairn

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
# @xenova/transformers hard-loads the onnxruntime-node native binding at import;
# its .node sidecar dlopens libonnxruntime.so.<ver> from the same dir. Next's
# standalone file-trace copies the .node but not the dlopen'd .so, so overlay
# the full pnpm package (which includes the .so). @xenova/transformers@2 pins
# onnxruntime-node@1.14.0.
COPY --from=deps --chown=cairn:cairn /app/node_modules/.pnpm/onnxruntime-node@1.14.0 ./node_modules/.pnpm/onnxruntime-node@1.14.0
# @xenova/transformers@2 also pulls sharp@0.32.6 (image preprocessing), whose
# native build/Release/sharp-<platform>.node + vendored libvips are likewise
# dropped by Next's file-trace. Overlay the full pnpm package so the embedder's
# require('sharp') resolves its binary.
COPY --from=deps --chown=cairn:cairn /app/node_modules/.pnpm/sharp@0.32.6 ./node_modules/.pnpm/sharp@0.32.6

RUN mkdir -p /data/uploads && chown -R cairn:cairn /data
VOLUME ["/data/uploads"]

USER cairn
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/server/entrypoint.js"]
