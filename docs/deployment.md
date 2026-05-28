# Cairn — Deployment Guide

Cairn ships as three containers wired together in `docker-compose.yml`:

| Service        | Image                                              | Purpose                          |
| -------------- | -------------------------------------------------- | -------------------------------- |
| `cairn`        | `ghcr.io/jonathanmcohen/cairn`                     | Next.js app (HTTP on :3000)      |
| `cairn-collab` | `ghcr.io/jonathanmcohen/cairn-collab`              | Hocuspocus real-time server      |
| `db`           | `ghcr.io/jonathanmcohen/postgres-pgvector:18-alpine` | Postgres 18 + pgvector         |

> **The Postgres image is a private GHCR package.** Every host that pulls it
> must `docker login ghcr.io` first with a GitHub PAT (classic) carrying
> `read:packages`. The `cairn` / `cairn-collab` images are public.

## Prerequisites on the target host

- Docker Engine + the Compose v2 plugin (`docker compose version` ≥ 2.24 if you
  use the TLS proxy overlay — it relies on the `!reset` list directive).
  Quick install: `curl -fsSL https://get.docker.com | sh`.
- A GitHub PAT with `read:packages` (for the private Postgres image).

## Quick deploy with `scripts/deploy.sh`

The helper copies the compose file(s) + your `.env` to a remote host over SSH
and (re)starts the stack. Run it from your workstation (it needs SSH access to
the box — the cloud sandbox cannot reach a private LAN).

```sh
# 1. Build your env file from the template and edit the secrets.
cp .env.example .env
#    At minimum set DB_PASSWORD and AUTH_SECRET. Generate them with:
#      openssl rand -base64 32           # AUTH_SECRET
#      openssl rand -base64 24 | tr -d '/+='   # DB_PASSWORD
#    Pin a release:  CAIRN_VERSION=0.9.1
#    Point the URLs at the box, e.g. for a LAN deploy:
#      PUBLIC_URL=http://10.1.50.109:3000
#      COLLAB_URL=ws://10.1.50.109:1234

# 2. Deploy (GHCR_TOKEN triggers an automatic `docker login` on the remote).
export GHCR_USER=<your-github-username>
export GHCR_TOKEN=<your-read-packages-PAT>
./scripts/deploy.sh --host jonco@10.1.50.109 --dir /home/jonco/apps/cairn
```

Open `http://10.1.50.109:3000` — the first account you create becomes the
workspace owner.

### Doing it by hand

If you'd rather not use the script:

```sh
ssh jonco@10.1.50.109 'mkdir -p /home/jonco/apps/cairn'
scp docker-compose.yml .env jonco@10.1.50.109:/home/jonco/apps/cairn/
ssh jonco@10.1.50.109 '
  cd /home/jonco/apps/cairn &&
  echo "$GHCR_TOKEN" | docker login ghcr.io -u <user> --password-stdin &&
  docker compose pull &&
  docker compose up -d &&
  docker compose ps'
```

## Adding HTTPS with the Caddy proxy

`docker-compose.proxy.yml` + `deploy/Caddyfile` add a Caddy container that
terminates TLS on :443, proxies everything to the app, routes `/collab*` to the
collab websocket, and stops the app/collab containers from publishing their raw
HTTP ports to the host (Caddy becomes the only public entrypoint).

1. In `.env`, set the domain and switch the URLs to TLS:

   ```env
   CAIRN_DOMAIN=cairn.example.com
   PUBLIC_URL=https://cairn.example.com
   NEXTAUTH_URL=https://cairn.example.com
   COLLAB_URL=wss://cairn.example.com/collab
   # Passkeys (optional) — RP id is the host only, origin is the full URL:
   # CAIRN_RP_ID=cairn.example.com
   # CAIRN_RP_ORIGIN=https://cairn.example.com
   ```

2. Deploy with the overlay:

   ```sh
   ./scripts/deploy.sh --host jonco@10.1.50.109 --with-proxy
   # or by hand:
   docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
   ```

### Which certificate?

The bundled `deploy/Caddyfile` defaults to `tls internal` — Caddy's own CA,
which issues a cert for any hostname **or bare IP** with zero external
dependencies. Perfect for a LAN box, but browsers warn until you trust Caddy's
root CA:

```sh
docker compose -f docker-compose.yml -f docker-compose.proxy.yml \
  exec caddy cat /data/caddy/pki/authorities/local/root.crt
```

Import that `root.crt` into your devices' trust stores to clear the warning.

- **Public domain, ports 80+443 reachable:** delete the `tls internal` line in
  `deploy/Caddyfile` and Caddy auto-provisions a free, browser-trusted
  Let's Encrypt cert — nothing else to configure.
- **Public domain behind NAT (no inbound 80/443):** use a DNS-01 challenge (see
  the commented block in the Caddyfile); needs a Caddy build with your DNS
  provider's plugin.

## Day-2 operations

- **Upgrade:** bump `CAIRN_VERSION` in `.env`, then re-run `scripts/deploy.sh`
  (it re-`pull`s and recreates the containers). Migrations apply automatically
  at container startup via `src/server/entrypoint.ts`.
- **Logs:** `ssh <host> 'cd <dir> && docker compose logs -f cairn'`.
- **Data lives in named volumes** (`cairn_db`, `cairn_uploads`) — see
  `docs/operations.md` for backups, scheduled jobs, and restore.
