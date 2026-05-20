# Cairn

Self-hosted, Notion-style block-based notes for homelab deployment.

> Status: under active development. v0.1.0 not yet released.

## Quickstart (Docker)

```sh
git clone https://github.com/<your-user>/cairn.git
cd cairn
cp .env.example .env
# edit .env — at minimum set DB_PASSWORD and AUTH_SECRET to your own values
docker compose up -d
```

Visit `http://localhost:3000`. The first user to sign up becomes the workspace owner.

## Local development

For `pnpm dev`, `pnpm build`, or `pnpm test` run outside the container, the same
`.env` file is consumed directly by Next.js — so it must contain the full set of
variables defined in `.env.example`, not just the docker-compose subset.

```sh
cp .env.example .env       # full set; both compose AND pnpm read from here
pnpm install
pnpm dev                   # http://localhost:3000
pnpm test                  # 32 tests, requires Docker for testcontainers
```

`DATABASE_URL` in `.env` should point at your dev Postgres (e.g. one started
with `docker compose up db`). The `DB_PASSWORD` / `PUBLIC_URL` shorthand keys
are only read by `docker-compose.yml` to interpolate the full URLs — `pnpm`
commands need the full `DATABASE_URL` and `NEXTAUTH_URL` directly.

## License

MIT — see [LICENSE](./LICENSE).
