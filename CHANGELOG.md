# Changelog

All notable changes to Cairn will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Multi-tenant workspace model with email/password authentication.
- First-user bootstrap (creates workspace, becomes owner) and invite-token signup for subsequent users.
- Roles: owner, admin, editor, viewer (enforced via `requireRole` helper).
- Admin-only invite token issuance API.
- Health endpoint at `/api/health` with database probe and version reporting.
- Light/dark/system theme with toggle.
- Authenticated dashboard shell with sidebar (workspace name, version footer).
- Dockerfile (multi-stage) and docker-compose for app + postgres.
- GitHub Actions CI: lint, typecheck, test with Postgres service container, build smoke.
- Repository scaffolding: Biome (lint/format), Vitest with testcontainers, Drizzle ORM with migrations applied at startup.
