# Cairn

Self-hosted, Notion-style block-based notes for homelab deployment.

> Status: under active development. v0.1.0 not yet released.

## Quickstart

```sh
git clone https://github.com/<your-user>/cairn.git
cd cairn
cp .env.example .env
# edit .env to set DB_PASSWORD, AUTH_SECRET, PUBLIC_URL
docker compose up -d
```

Visit `http://localhost:3000`. The first user to sign up becomes the workspace owner.

## License

MIT — see [LICENSE](./LICENSE).
