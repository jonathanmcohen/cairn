# Contributing to Cairn

Thanks for your interest. Cairn is currently in early development; please open
an issue before working on significant changes.

## Local setup

```sh
git clone https://github.com/jonathanmcohen/cairn.git
cd cairn
cp .env.example .env
pnpm install
pnpm dev   # or `docker compose up -d`
```

## Tests + lint

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Tests use [Testcontainers](https://node.testcontainers.org/) — Docker must be
running locally. CI exercises the same suite against a Postgres service container.

## Commit style

Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`,
`refactor:`. Keep subjects under 72 chars.

## License

By contributing you agree your work will be licensed under the MIT license in
[LICENSE](LICENSE).
