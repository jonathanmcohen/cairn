#!/usr/bin/env bash
#
# Cairn remote deploy helper.
#
# Copies the compose file(s) + your .env to a remote host over SSH and
# (re)starts the stack from the published GHCR images. Optionally enables the
# Caddy TLS proxy overlay (--with-proxy).
#
# Usage:
#   DEPLOY_HOST=jonco@10.1.50.109 ./scripts/deploy.sh
#   ./scripts/deploy.sh --host jonco@10.1.50.109 --dir /home/jonco/apps/cairn
#   ./scripts/deploy.sh --host jonco@10.1.50.109 --with-proxy --env-file .env.prod
#
# Options (all also settable via env vars):
#   --host      user@host to deploy to        (DEPLOY_HOST, required)
#   --dir       remote app directory           (DEPLOY_DIR, default /home/jonco/apps/cairn)
#   --env-file  local env file to ship as .env (DEPLOY_ENV_FILE, default ./.env)
#   --with-proxy  also deploy the Caddy TLS reverse proxy
#
# Secrets are never baked into this script. They live in your local env file
# (copied to the remote as .env). The Postgres image on GHCR is public, so
# in GHCR_USER + GHCR_TOKEN — when GHCR_TOKEN is exported the script runs
# `docker login ghcr.io` on the remote before pulling.
set -euo pipefail

HOST="${DEPLOY_HOST:-}"
DIR="${DEPLOY_DIR:-/home/jonco/apps/cairn}"
ENV_FILE="${DEPLOY_ENV_FILE:-.env}"
WITH_PROXY=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--host) HOST="$2"; shift 2 ;;
		--dir) DIR="$2"; shift 2 ;;
		--env-file) ENV_FILE="$2"; shift 2 ;;
		--with-proxy) WITH_PROXY=1; shift ;;
		-h|--help) sed -n '2,40p' "$0" | sed 's/^#\s\{0,1\}//'; exit 0 ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

[[ -n "$HOST" ]] || { echo "error: --host user@host (or DEPLOY_HOST) is required" >&2; exit 2; }
[[ -f "$ENV_FILE" ]] || { echo "error: env file not found: $ENV_FILE (copy .env.example and edit it)" >&2; exit 2; }

# Run from the repo root so the relative file paths below resolve.
cd "$(dirname "$0")/.."

COMPOSE=(-f docker-compose.yml)
if [[ "$WITH_PROXY" == 1 ]]; then
	COMPOSE+=(-f docker-compose.proxy.yml)
fi

echo "==> Ensuring remote directory: $DIR"
ssh "$HOST" "mkdir -p '$DIR' '$DIR/deploy'"

echo "==> Copying compose file(s) + env"
scp docker-compose.yml "$HOST:$DIR/docker-compose.yml"
scp "$ENV_FILE" "$HOST:$DIR/.env"
if [[ "$WITH_PROXY" == 1 ]]; then
	scp docker-compose.proxy.yml "$HOST:$DIR/docker-compose.proxy.yml"
	scp deploy/Caddyfile "$HOST:$DIR/deploy/Caddyfile"
fi

if [[ -n "${GHCR_TOKEN:-}" ]]; then
	echo "==> Logging remote Docker into ghcr.io (optional; the Postgres image is public)"
	ssh "$HOST" "echo '$GHCR_TOKEN' | docker login ghcr.io -u '${GHCR_USER:-jonathanmcohen}' --password-stdin"
fi

echo "==> Pulling images"
ssh "$HOST" "cd '$DIR' && docker compose ${COMPOSE[*]} pull"

echo "==> Starting stack"
ssh "$HOST" "cd '$DIR' && docker compose ${COMPOSE[*]} up -d"

echo "==> Status"
ssh "$HOST" "cd '$DIR' && docker compose ${COMPOSE[*]} ps"

echo
echo "Done. Follow startup logs with:"
echo "  ssh $HOST 'cd $DIR && docker compose ${COMPOSE[*]} logs -f cairn'"
