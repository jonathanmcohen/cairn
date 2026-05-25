# syntax=docker/dockerfile:1.7
#
# Postgres 18 + pgvector, alpine base.
#
# Cairn's embedding pipeline (v0.7.0 P11) issues `CREATE EXTENSION vector`
# at migration time, so every Postgres consumer — docker-compose `db`,
# Testcontainers (`tests/helpers/db.ts`), the CI a11y/lighthouse services —
# needs an image where the `vector.so` + `vector.control` files are on
# disk. The community `pgvector/pgvector` image only ships up to pg17 at
# the time of v0.8.0 and is debian-slim based, so this image fills two
# gaps: pg18 support, and an alpine base (preferred per the project's
# image-size / supply-chain budget).
#
# Published to `ghcr.io/jonathanmcohen/postgres-pgvector` by the
# `.github/workflows/postgres-pgvector-image.yml` workflow on every push
# that touches this directory.

ARG POSTGRES_VERSION=18-alpine
FROM postgres:${POSTGRES_VERSION}

# pgvector tag/branch to build from. Default to `master` while a tagged
# release with formal pg18 support is in flight; pin once an official tag
# (v0.9.0+) ships pg18 in its support matrix.
ARG PGVECTOR_REF=master

USER root

RUN set -eux; \
    apk add --no-cache --virtual .pgvector-build-deps \
        build-base \
        git; \
    cd /tmp; \
    git clone --depth 1 --branch "${PGVECTOR_REF}" https://github.com/pgvector/pgvector.git; \
    cd pgvector; \
    # postgres:18-alpine is built --with-llvm and pulls in clang-19 for
    # JIT bitcode generation. We skip JIT entirely (`with_llvm=no`) so
    # the build avoids the multi-hundred-megabyte llvm/clang toolchain;
    # pgvector index ops + queries do not benefit measurably from JIT for
    # the workload Cairn drives. `OPTFLAGS=""` keeps the build portable
    # across amd64 + arm64 (the default `-march=native` would bake the
    # runner's instruction set in, breaking cross-arch reuse).
    make OPTFLAGS="" with_llvm=no; \
    make install with_llvm=no; \
    cd /; \
    rm -rf /tmp/pgvector; \
    apk del .pgvector-build-deps; \
    # Sanity: the install step must have dropped the extension files where
    # the server looks for them. If they're missing the image is useless.
    test -f "$(pg_config --pkglibdir)/vector.so"; \
    test -f "$(pg_config --sharedir)/extension/vector.control"

# Inherit the upstream entrypoint + CMD; nothing else to change.
