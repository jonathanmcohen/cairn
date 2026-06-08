# v0.9.16 Plan F — MCP OAuth 2.1 authorization server

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (- [ ]) syntax. Each task is bite-sized TDD (write the failing spec first, then the implementation). Prefix every shell command with `source ~/.zshenv && `. Do NOT push — the controller/human pushes.

## Goal

Today an MCP client (Claude Desktop, Cursor) connects to Cairn's `/api/mcp` endpoint only by pasting a long-lived `cairn_pat_…` Personal Access Token into a JSON config (`src/components/dev-settings/mcp-connection-info.tsx:11-36`). That is the only auth path: `src/app/api/mcp/route.ts:52-59` calls `resolveToken(Authorization)` and rejects anything that is not `kind === 'pat'`.

This plan adds a first-class **OAuth 2.1 authorization server** so an MCP client can connect by URL alone (`https://<host>/api/mcp`), get redirected to a browser **consent screen**, click **Allow**, and receive a short-lived access token + rotating refresh token — **no token paste**. This is the auth flow the MCP spec (2025-06-18, "Authorization") expects: an unauthenticated request to the resource returns `401 WWW-Authenticate: Bearer resource_metadata="…"`, the client discovers the AS via RFC 8414 metadata, dynamically registers (RFC 7591), runs the PKCE authorization-code flow (RFC 7636, S256 mandatory), and exchanges the code for tokens.

OAuth access tokens resolve through the **same enforcement path as PATs** — `resolveToken` (`src/lib/auth/token.ts:77-113`) gains a third dispatch branch — so scope checks (`requireScope`, `src/lib/auth/token.ts:119-123`) and the MCP `mcp:*` scope gate (`src/app/api/mcp/route.ts:60-63`) work unchanged. **PATs keep working** (backward compat): the existing `cairn_pat_` and `cairn_sk_` branches are untouched.

Tokens are hashed at rest using the exact SHA-256 approach PATs use (`hashPat`/`verifyPat`, `src/lib/auth/pat.ts:13-24`). Every consent grant, token issuance, and revocation is recorded via `recordAudit` (`src/lib/audit/record.ts:135`) under four new audit actions.

## Architecture

```
NEW migration  drizzle/migrations/0069_mcp_oauth.sql   (next in sequence — latest is 0068_backfill_legacy_orange_covers.sql)
NEW schema     src/db/schema/oauth-clients.ts          oauth_clients
               src/db/schema/oauth-authorization-codes.ts  oauth_authorization_codes
               src/db/schema/oauth-tokens.ts           oauth_tokens
               (re-export all three from src/db/schema/index.ts)

NEW lib        src/lib/oauth/tokens.ts      hashOauthToken / verifyOauthToken (reuse PAT sha256), mint helpers
               src/lib/oauth/pkce.ts        S256 verify (base64url(sha256(verifier)) === challenge)
               src/lib/oauth/clients.ts     registerClient / loadClient (dynamic registration)
               src/lib/oauth/codes.ts       issueAuthCode / consumeAuthCode (one-shot, expiry, PKCE binding)
               src/lib/oauth/exchange.ts    codeToTokens / refreshTokens (rotation) / revokeToken
               src/lib/oauth/scopes.ts      OAUTH_PRESETS + scope validation (reuses PAT scope vocab)
               src/lib/oauth/metadata.ts    buildAsMetadata / buildResourceMetadata (publicOrigin-aware)

NEW routes     src/app/.well-known/oauth-authorization-server/route.ts   GET (RFC 8414)
               src/app/.well-known/oauth-protected-resource/route.ts     GET (resource metadata for /api/mcp)
               src/app/api/oauth/register/route.ts     POST (RFC 7591)
               src/app/api/oauth/authorize/route.ts    GET  (auth check → consent screen; POST Allow → code)
               src/app/(app)/oauth/consent/page.tsx    themed consent screen (RSC, reuses settings page shell)
               src/app/api/oauth/token/route.ts        POST (code→token + refresh grant w/ rotation)
               src/app/api/oauth/revoke/route.ts        POST (RFC 7009)

EXTEND         src/lib/auth/token.ts        resolveToken gains `cairn_oauth_` (kind: 'oauth') branch
               src/app/api/mcp/route.ts     401 → WWW-Authenticate header; accept kind 'pat' OR 'oauth'
               src/lib/audit/actions.ts     +oauth.client_registered, oauth.consent_granted, oauth.token_issued, oauth.token_revoked  +target types oauth_client, oauth_token

NEW UI         src/components/dev-settings/oauth-connections-list.tsx   (Active-Sessions-style list + Revoke)
EXTEND         src/app/(app)/settings/developer/tokens/page.tsx        OAuth-preferred copy + connections list
               src/components/dev-settings/mcp-connection-info.tsx     "OAuth (recommended)" + "use a bearer token instead" disclosure

NEW i18n       messages/{en,es,ar}.json   oauthConsent.* + oauthConnections.* keys
```

### Token formats (all SHA-256 hashed at rest, never stored plaintext)

| token | prefix | lifetime | stored |
| --- | --- | --- | --- |
| authorization code | `cairn_oac_` | 60 s, one-shot | sha256 hash, `consumed_at` flag, PKCE `code_challenge` |
| access token | `cairn_oauth_` | 1 h | sha256 hash, `revoked_at`, `last_used_at` |
| refresh token | `cairn_oart_` | 30 d, rotated | sha256 hash; rotation marks old `revoked_at` |
| client secret (optional) | `cairn_ocs_` | — | sha256 hash (public PKCE clients may register without one) |

`resolveToken` dispatches on `cairn_oauth_` only (the access token); refresh tokens are presented only at `/api/oauth/token`. Reusing the `cairn_` namespace keeps every secret tripping the audit-leak guard (`FORBIDDEN_SUBSTRINGS`, `src/lib/audit/record.ts:24-32`) — **add `cairn_oauth_`, `cairn_oart_`, `cairn_oac_`, `cairn_ocs_` to that list in Task 8's audit step**.

### Scope model (reuses the PAT vocabulary verbatim — no new scope strings)

The 16 PAT scopes (`src/components/dev-settings/mint-token-dialog.tsx:24-41`: `pages:read|write|destructive`, `databases:*`, `comments:*`, `files:*`, `mcp:read|write|destructive`, `admin`) are the OAuth scope vocabulary. `src/lib/oauth/scopes.ts` defines presets mirroring the existing MCP presets (`mint-token-dialog.tsx:70-82`):

```
mcp:read  → ['mcp:read',  'pages:read','databases:read','comments:read','files:read']
mcp:write → ['mcp:read','mcp:write','pages:read','pages:write','databases:read','databases:write','comments:read','comments:write','files:read','files:write']
admin     → full CRUD + 'admin'
```

The OAuth token's persisted `scopes` are intersected with the user's effective workspace role at consent time (a viewer cannot grant `pages:write`). Enforcement at the API layer is unchanged: `requireScope` and the MCP `mcp:*` gate already operate on `TokenContext.scopes`.

### Why these RFCs / why PKCE-only

- **RFC 8414** discovery + **RFC 9728** protected-resource metadata is exactly what the MCP 2025-06 client probes after a `401 WWW-Authenticate`.
- **PKCE S256 is REQUIRED** for every client (public + confidential). MCP desktop clients are public clients with no safely-storable secret; PKCE is the only thing preventing authorization-code interception.
- **Refresh-token rotation**: each refresh issues a new refresh token and revokes the presented one, so a captured refresh token is single-use and replay is detectable.
- We implement the AS by hand (no `oauth4webapi`/`node-oidc-provider` server dep) because the surface is small, must share Cairn's hash + audit + DB conventions, and a heavyweight server lib would fight the `jwt`-only Auth.js setup (CLAUDE.md gotcha).

## Tech Stack

- Next.js 16 App Router route handlers (`runtime = 'nodejs'`, `dynamic = 'force-dynamic'` — same as `src/app/api/mcp/route.ts:13-14`).
- Postgres 16 + Drizzle. New migration **0069** hand-authored after `db:generate` (the generator does not emit CHECK constraints / partial indexes — append by hand per CLAUDE.md "`db:generate` doesn't emit extensions/triggers").
- `node:crypto` `createHash('sha256')` + `timingSafeEqual` + `randomBytes` — reuse the PAT helpers' exact pattern (`src/lib/auth/pat.ts:1-24`).
- Auth.js v5 `auth()` for the consent-screen session gate (`src/lib/auth/config`), same as `src/app/(app)/settings/developer/tokens/page.tsx:13-14`.
- `publicOrigin()` (`src/lib/url.ts:38`) for forwarded-host-aware metadata URLs.
- Vitest 4 + Testcontainers Postgres; specs follow `tests/api/mcp.test.ts` (vi.mock `@/db/client`, `runMigrations`, TRUNCATE in `beforeEach`, `createTestWorkspaceWithUser`). New specs use the `.spec.ts` convention (discovered per v0.9.14 Plan V).
- i18n via `messages/{en,es,ar}.json` + `useT()` (`src/lib/i18n/provider`), same keys-everywhere convention as the Mint-Token dialog scope tooltips (`mint-token-dialog.tsx:209`).

---

## Task 1 — Migration 0069 + Drizzle tables (oauth_clients, oauth_authorization_codes, oauth_tokens)

- [ ] Write `tests/db/oauth-schema.spec.ts` FIRST: spins up the test container, `runMigrations`, then asserts the three tables exist with their columns/constraints by inserting a representative row into each (FK to `users`/`workspaces` enforced, `consumed_at` defaults null, unique index on each token-hash column, `oauth_authorization_codes.code_challenge_method` CHECK accepts only `'S256'`). Assert a duplicate `token_hash` insert into `oauth_tokens` throws (unique).

- [ ] Add `src/db/schema/oauth-clients.ts`:

```ts
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * v0.9.16 Plan F — RFC 7591 dynamically-registered OAuth clients. `client_secret_hash`
 * is null for public (PKCE) clients (Claude Desktop / Cursor). `redirect_uris` is the
 * exact-match allowlist enforced at /authorize and /token.
 */
export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: text('client_id').notNull(),
    clientSecretHash: text('client_secret_hash'),
    clientName: text('client_name').notNull(),
    redirectUris: text('redirect_uris').array().notNull(),
    grantTypes: text('grant_types').array().notNull().default(['authorization_code', 'refresh_token']),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('oauth_clients_client_id_idx').on(t.clientId)],
);

export type OauthClient = typeof oauthClients.$inferSelect;
export type NewOauthClient = typeof oauthClients.$inferInsert;
```

- [ ] Add `src/db/schema/oauth-authorization-codes.ts`:

```ts
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * v0.9.16 Plan F — short-lived (60 s) one-shot authorization codes. `code_hash`
 * is sha256 of the plaintext `cairn_oac_…` code (never stored plaintext). PKCE:
 * `code_challenge` is the S256 challenge bound at /authorize, verified at /token.
 * `consumed_at` flips on first exchange — a second exchange is rejected.
 */
export const oauthAuthorizationCodes = pgTable(
  'oauth_authorization_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeHash: text('code_hash').notNull(),
    clientId: text('client_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('oauth_auth_codes_client_idx').on(t.clientId)],
);

export type OauthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type NewOauthAuthorizationCode = typeof oauthAuthorizationCodes.$inferInsert;
```

- [ ] Add `src/db/schema/oauth-tokens.ts`:

```ts
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * v0.9.16 Plan F — issued access + refresh tokens. Both hashes sha256 of their
 * plaintext (`cairn_oauth_…` / `cairn_oart_…`). One row carries both so refresh
 * rotation revokes the access+refresh pair atomically. `revoked_at` set on
 * rotation/revoke; `last_used_at` stamped fire-and-forget like PATs.
 */
export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accessTokenHash: text('access_token_hash').notNull(),
    refreshTokenHash: text('refresh_token_hash'),
    clientId: text('client_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('oauth_tokens_access_hash_unique').on(t.accessTokenHash),
    index('oauth_tokens_refresh_hash_idx').on(t.refreshTokenHash),
    index('oauth_tokens_user_idx').on(t.userId, t.workspaceId),
  ],
);

export type OauthToken = typeof oauthTokens.$inferSelect;
export type NewOauthToken = typeof oauthTokens.$inferInsert;
```

- [ ] Re-export all three from `src/db/schema/index.ts` (alphabetical, matching existing lines).
- [ ] Generate + hand-finish the migration:
  ```sh
  source ~/.zshenv && pnpm db:generate
  ```
  Rename/verify the generated file is `drizzle/migrations/0069_mcp_oauth.sql`. **Append by hand** (generator omits CHECK + unique-on-text): the `code_challenge_method` CHECK `IN ('S256')`, the three unique indexes, and verify FK `ON DELETE` clauses match the schema. Confirm `drizzle/migrations/meta/_journal.json` lists 0069 last.
- [ ] Run the spec: `source ~/.zshenv && pnpm test tests/db/oauth-schema.spec.ts`
- [ ] `source ~/.zshenv && pnpm lint && pnpm typecheck`
- [ ] Commit:
  ```sh
  source ~/.zshenv && git add drizzle/migrations/0069_mcp_oauth.sql drizzle/migrations/meta src/db/schema/oauth-clients.ts src/db/schema/oauth-authorization-codes.ts src/db/schema/oauth-tokens.ts src/db/schema/index.ts tests/db/oauth-schema.spec.ts && git commit -m "feat(oauth): migration 0069 + Drizzle tables for MCP OAuth"
  ```

## Task 2 — OAuth crypto + PKCE + scope helpers (`src/lib/oauth/{tokens,pkce,scopes}.ts`)

- [ ] Write `tests/lib/oauth-pkce.spec.ts` FIRST: asserts `verifyPkceS256(verifier, challenge)` returns true when `challenge === base64url(sha256(verifier))` and false otherwise; asserts a non-S256 method is rejected. Use a hardcoded RFC 7636 Appendix-B vector (`verifier = dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`, `challenge = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`).
- [ ] Write `tests/lib/oauth-tokens.spec.ts`: `mintOauthSecret('cairn_oauth_')` returns a `cairn_oauth_`-prefixed string; `hashOauthToken` is deterministic sha256-hex; `verifyOauthToken(secret, hash)` is constant-time true/false.
- [ ] Write `tests/lib/oauth-scopes.spec.ts`: `OAUTH_PRESETS['mcp:read']` etc. match the table above; `validateScopes(requested, allowedForRole)` drops scopes the role cannot grant (viewer requesting `pages:write` → filtered out) and rejects unknown scope strings.
- [ ] Implement `src/lib/oauth/pkce.ts` (`createHash('sha256').update(verifier).digest('base64url')`), `src/lib/oauth/tokens.ts` (mirror `hashPat`/`verifyPat`/`randomBytes(32).toString('base64url')` from `src/lib/auth/pat.ts:13-24,54`), `src/lib/oauth/scopes.ts` (import the canonical scope list; presets per Architecture).
- [ ] Run: `source ~/.zshenv && pnpm test tests/lib/oauth-pkce.spec.ts tests/lib/oauth-tokens.spec.ts tests/lib/oauth-scopes.spec.ts`
- [ ] Lint+typecheck, then commit:
  ```sh
  source ~/.zshenv && git add src/lib/oauth/pkce.ts src/lib/oauth/tokens.ts src/lib/oauth/scopes.ts tests/lib/oauth-pkce.spec.ts tests/lib/oauth-tokens.spec.ts tests/lib/oauth-scopes.spec.ts && git commit -m "feat(oauth): PKCE S256 + token-hash + scope-preset helpers"
  ```

## Task 3 — Discovery metadata (`/.well-known/*`) + `src/lib/oauth/metadata.ts`

> **SPEC FILE: `tests/api/oauth/discovery.spec.ts`** — asserts `GET /.well-known/oauth-authorization-server` returns 200 JSON with `issuer`, `authorization_endpoint` (`…/api/oauth/authorize`), `token_endpoint`, `registration_endpoint`, `revocation_endpoint`, `scopes_supported` (the 16 PAT scopes), `response_types_supported: ['code']`, `grant_types_supported: ['authorization_code','refresh_token']`, `code_challenge_methods_supported: ['S256']`, and `token_endpoint_auth_methods_supported` including `none` (public PKCE clients). Asserts `GET /.well-known/oauth-protected-resource` returns 200 with `resource` = `…/api/mcp` and `authorization_servers: ['…issuer']`. Both must be `publicOrigin()`-derived (set forwarded-host header, assert the URL reflects it).

- [ ] Write the spec FIRST (call the route `GET` handlers directly with a `Request`, mock `@/db/client` is not needed — metadata is DB-free but uses `publicOrigin()`; set `NEXTAUTH_URL`).
- [ ] Implement `src/lib/oauth/metadata.ts` (`buildAsMetadata(origin)` / `buildResourceMetadata(origin)` pure functions) and the two route handlers under `src/app/.well-known/…/route.ts`. Use `runtime='nodejs'`, return `Response.json(...)` with `cache-control: public, max-age=3600`.
- [ ] Run the spec; lint+typecheck; commit:
  ```sh
  source ~/.zshenv && git add src/lib/oauth/metadata.ts "src/app/.well-known" tests/api/oauth/discovery.spec.ts && git commit -m "feat(oauth): RFC 8414 + protected-resource discovery metadata"
  ```

## Task 4 — Dynamic client registration (`POST /api/oauth/register`)

> **SPEC FILE: `tests/api/oauth/dynamic-registration.spec.ts`** — asserts a `POST /api/oauth/register` with `{client_name, redirect_uris}` returns 201 with `client_id` (and `client_secret` only if the request asked for a confidential client), echoes `redirect_uris`, and persists an `oauth_clients` row (secret stored hashed, never echoed back in plaintext on a re-fetch). Asserts a missing/empty `redirect_uris` → 400 `invalid_redirect_uri`. Asserts a non-http(s) redirect scheme is rejected. Asserts an audit row `oauth.client_registered` is written (targetType `oauth_client`, metadata `{clientName, redirectUriCount}` — never the secret).

- [ ] Write the spec FIRST (mock `@/db/client` per `tests/api/mcp.test.ts`).
- [ ] Implement `src/lib/oauth/clients.ts` (`registerClient` + `loadClientByClientId`) and `src/app/api/oauth/register/route.ts`. Generate `client_id` = `randomBytes(16).toString('hex')`; hash any client secret with `hashOauthToken`. Validate every redirect URI is absolute http/https. Wrap insert + `recordAudit('oauth.client_registered')` in one `db.transaction` (mirror `mintPat`, `src/lib/auth/pat.ts:59-92`). Registration is unauthenticated per RFC 7591 (MCP clients self-register) — but rate-limit-friendly and audited.
- [ ] Run spec; lint+typecheck; commit:
  ```sh
  source ~/.zshenv && git add src/lib/oauth/clients.ts src/app/api/oauth/register tests/api/oauth/dynamic-registration.spec.ts && git commit -m "feat(oauth): RFC 7591 dynamic client registration"
  ```

## Task 5 — Authorize endpoint + themed consent screen (`/api/oauth/authorize` + consent page)

> **SPEC FILE: `tests/api/oauth/authorize-consent.spec.ts`** — asserts `GET /api/oauth/authorize` with valid `client_id,redirect_uri,response_type=code,code_challenge,code_challenge_method=S256,scope,state`:
> - when **unauthenticated** (no session) → 302 to `/login?returnTo=<url-encoded authorize URL>`;
> - when **authenticated** → 200 rendering the consent screen showing the client name, requested scopes (friendly labels), and target workspace;
> - rejects an unknown `client_id` → 400 `invalid_client`;
> - rejects a `redirect_uri` not in the client's exact-match allowlist → 400 `invalid_redirect_uri` (and does NOT redirect to the bad URI);
> - rejects missing `code_challenge` or `code_challenge_method !== 'S256'` → 400 `invalid_request` (PKCE required);
> - on **Allow** (POST consent action) issues a one-shot `cairn_oac_` code (row in `oauth_authorization_codes`, hashed, 60 s expiry, bound `code_challenge`+scopes intersected with role) and 302s to `redirect_uri?code=…&state=…`;
> - on **Cancel** 302s to `redirect_uri?error=access_denied&state=…`;
> - writes audit `oauth.consent_granted` on Allow (metadata `{clientName, scopes, workspaceId}`).

- [ ] Write the spec FIRST. For the session, follow the API-route test convention from CLAUDE.md: `vi.mock('@/lib/auth/config')` exposing a `__set` helper to fake `auth()`.
- [ ] Implement `src/lib/oauth/codes.ts` (`issueAuthCode`, `consumeAuthCode`). `issueAuthCode` runs insert + `recordAudit('oauth.consent_granted')` in a transaction.
- [ ] Implement `src/app/api/oauth/authorize/route.ts` `GET` (validate client + redirect_uri exact-match + PKCE present; session gate → `/login?returnTo=`; otherwise render/redirect to the consent page passing the validated params) and the `POST` consent action (Allow → issue code → 302; Cancel → 302 error).
- [ ] Implement `src/app/(app)/oauth/consent/page.tsx` — themed RSC reusing the settings page shell (`mx-auto max-w-… p-6`, `Card`, `Button` from `@/components/ui`), the friendly scope labels/tooltips reused from the Mint-Token dialog (`devTokens.scope.<scope>.tip` i18n keys, `mint-token-dialog.tsx:209`), showing client name + workspace name + **Allow**/**Cancel** buttons posting to the authorize action.
- [ ] Run spec; lint+typecheck; commit:
  ```sh
  source ~/.zshenv && git add src/lib/oauth/codes.ts src/app/api/oauth/authorize "src/app/(app)/oauth" tests/api/oauth/authorize-consent.spec.ts && git commit -m "feat(oauth): authorize endpoint + themed PKCE consent screen"
  ```

## Task 6 — Token endpoint: code exchange + PKCE-required (`POST /api/oauth/token`)

> **SPEC FILE: `tests/api/oauth/token-exchange.spec.ts`** — drives the full flow (register → issue code via lib helper → exchange): asserts `POST /api/oauth/token` with `grant_type=authorization_code, code, redirect_uri, client_id, code_verifier` returns 200 `{access_token (cairn_oauth_), refresh_token (cairn_oart_), token_type:'Bearer', expires_in:3600, scope}`; persists an `oauth_tokens` row (both hashes, scopes copied from the code); writes audit `oauth.token_issued`. Asserts a **reused** code (second exchange) → 400 `invalid_grant` AND revokes any tokens already issued from it (replay defense). Asserts an **expired** code → 400 `invalid_grant`. Asserts a `redirect_uri` mismatch → 400 `invalid_grant`.
>
> **SPEC FILE: `tests/api/oauth/pkce-required.spec.ts`** — asserts exchange with a **wrong** `code_verifier` (PKCE mismatch) → 400 `invalid_grant`; asserts exchange with a **missing** `code_verifier` → 400 `invalid_request`; asserts (defense in depth) the `/authorize` step already rejected a request that omitted `code_challenge` (cross-checks Task 5's PKCE gate).

- [ ] Write BOTH specs FIRST.
- [ ] Implement `src/lib/oauth/exchange.ts#codeToTokens`: load+consume the code (one-shot via `consumeAuthCode` setting `consumed_at`), verify `redirect_uri` matches the code's bound URI, verify `verifyPkceS256(code_verifier, code.codeChallenge)`, then insert an `oauth_tokens` row (mint access + refresh, hash both) + `recordAudit('oauth.token_issued')`, all in one transaction. On a code already `consumed_at` → revoke its descendant tokens and return `invalid_grant`.
- [ ] Implement `src/app/api/oauth/token/route.ts` `POST` parsing `application/x-www-form-urlencoded` (OAuth standard), dispatching on `grant_type` (authorization_code now; refresh_token in Task 7).
- [ ] Run specs; lint+typecheck; commit:
  ```sh
  source ~/.zshenv && git add src/lib/oauth/exchange.ts src/app/api/oauth/token tests/api/oauth/token-exchange.spec.ts tests/api/oauth/pkce-required.spec.ts && git commit -m "feat(oauth): authorization-code → token exchange with PKCE verification"
  ```

## Task 7 — Refresh-token grant with rotation (`grant_type=refresh_token`)

> **SPEC FILE: `tests/api/oauth/refresh.spec.ts`** — asserts `POST /api/oauth/token` with `grant_type=refresh_token, refresh_token, client_id` returns 200 with a **new** access token AND a **new** refresh token (rotation); asserts the OLD refresh token is now `revoked_at` and a second use of it → 400 `invalid_grant`; asserts the issued scopes are ≤ the original token's scopes (no scope escalation); asserts an expired or revoked refresh token → 400 `invalid_grant`; asserts audit `oauth.token_issued` is written on each refresh.

- [ ] Write the spec FIRST.
- [ ] Implement `src/lib/oauth/exchange.ts#refreshTokens`: look up by `verifyOauthToken(refresh_token, refresh_token_hash)`, reject revoked/expired, then in one transaction: revoke the old row (`revoked_at = now()`) and insert a fresh `oauth_tokens` row with copied scopes + new hashes + `recordAudit('oauth.token_issued')`. Wire the `refresh_token` branch into `src/app/api/oauth/token/route.ts`.
- [ ] Run spec; lint+typecheck; commit:
  ```sh
  source ~/.zshenv && git add src/lib/oauth/exchange.ts src/app/api/oauth/token/route.ts tests/api/oauth/refresh.spec.ts && git commit -m "feat(oauth): refresh-token grant with rotation"
  ```

## Task 8 — Revocation (`POST /api/oauth/revoke`) + audit vocabulary + leak-guard

> **SPEC FILE: `tests/api/oauth/revoke.spec.ts`** — asserts `POST /api/oauth/revoke` with `{token, token_type_hint}` (RFC 7009) returns 200 (always 200, even for unknown tokens, per spec) and sets `revoked_at` on the matching `oauth_tokens` row whether the presented token is the access or refresh hash; asserts a subsequent `resolveToken` of a revoked access token returns null (cross-checks Task 9); asserts audit `oauth.token_revoked` is written for a real revocation; asserts an unknown token writes NO audit row (silent 200).

- [ ] First extend `src/lib/audit/actions.ts`: append to `AUDIT_ACTIONS` (with a `// v0.9.16 Plan F` comment) `'oauth.client_registered'`, `'oauth.consent_granted'`, `'oauth.token_issued'`, `'oauth.token_revoked'`; append `'oauth_client'` and `'oauth_token'` to `AuditTargetType`.
- [ ] Extend the leak guard: add `'cairn_oauth_'`, `'cairn_oart_'`, `'cairn_oac_'`, `'cairn_ocs_'` to `FORBIDDEN_SUBSTRINGS` in `src/lib/audit/record.ts:24-32`. Add a case to the existing PAT secret-leak suite (find it: `tests/security/*pat*` / `tests/security/*audit*`) asserting these prefixes throw `assertAuditMetadataClean`.
- [ ] Write the revoke spec FIRST, then implement `src/lib/oauth/exchange.ts#revokeToken` (match by access OR refresh hash; transaction with `recordAudit('oauth.token_revoked')` only on a real hit) and `src/app/api/oauth/revoke/route.ts`.
- [ ] Run spec; lint+typecheck; commit:
  ```sh
  source ~/.zshenv && git add src/lib/audit/actions.ts src/lib/audit/record.ts src/lib/oauth/exchange.ts src/app/api/oauth/revoke tests/api/oauth/revoke.spec.ts tests/security && git commit -m "feat(oauth): RFC 7009 revocation + audit vocab + leak-guard prefixes"
  ```

## Task 9 — resolveToken `oauth` branch + scope enforcement (extend `src/lib/auth/token.ts`)

> **SPEC FILE: `tests/api/oauth/scope-enforcement.spec.ts`** — issues an OAuth access token via the lib helpers with scopes `['mcp:read','pages:read']`, then asserts `resolveToken('Bearer cairn_oauth_…')` returns `{kind:'oauth', userId, workspaceId, scopes, mcpTools:[]}`; asserts `requireScope(ctx,'pages:read')` passes and `requireScope(ctx,'pages:write')` throws `HttpError(403)`; asserts a token with `['admin']` passes any `requireScope` (admin superset, `token.ts:120`); asserts an expired access token (`access_expires_at` in the past) → `resolveToken` returns null; asserts a revoked token → null; asserts `last_used_at` is stamped (fire-and-forget). Confirms PAT + api_key resolution still works (regression: seed a PAT, assert `kind:'pat'`).

- [ ] Write the spec FIRST.
- [ ] Implement `src/lib/oauth/tokens.ts#verifyOauthAccessToken(db, token)` returning a context `{kind:'oauth', tokenId, userId, workspaceId, scopes, mcpTools:[]}` — mirror `verifyPatToken` (`src/lib/auth/pat.ts:111-149`): hash, look up active non-revoked row, reject expired, stamp `last_used_at` via `void db.update(...).catch(...)`.
- [ ] Extend `TokenContext.kind` union in `src/lib/auth/token.ts:10` to include `'oauth'`, and add the dispatch branch to `resolveToken` (after the `cairn_pat_` branch, before `cairn_sk_`):
  ```ts
  if (secret.startsWith('cairn_oauth_')) {
    const oauth = await verifyOauthAccessToken(db, secret);
    if (!oauth) return null;
    return oauth;
  }
  ```
  Leave the `cairn_pat_` and `cairn_sk_` branches untouched (backward compat).
- [ ] Run spec; lint+typecheck; commit:
  ```sh
  source ~/.zshenv && git add src/lib/auth/token.ts src/lib/oauth/tokens.ts tests/api/oauth/scope-enforcement.spec.ts && git commit -m "feat(oauth): resolve access tokens through the PAT enforcement path"
  ```

## Task 10 — MCP endpoint: WWW-Authenticate challenge + accept OAuth tokens

> **SPEC FILE: `tests/api/mcp/www-authenticate-resource-metadata.spec.ts`** — asserts `POST /api/mcp` with **no** Authorization header returns **401** with header `WWW-Authenticate: Bearer resource_metadata="<publicOrigin>/.well-known/oauth-protected-resource"` (the MCP 2025-06 discovery trigger); asserts the body is still the existing `{error:'unauthorized'}`. Asserts a valid **OAuth** access token carrying an `mcp:*` scope is accepted (200 / dispatches), proving OAuth tokens flow through the same gate as PATs. Asserts an OAuth token WITHOUT any `mcp:*` scope → 403 (reuses the existing `mint-token` gate, `route.ts:60-63`). Asserts a PAT still works (regression).

- [ ] Write the spec FIRST (extends `tests/api/mcp.test.ts` patterns; add `oauth_tokens, oauth_clients, oauth_authorization_codes` to the `TRUNCATE` list).
- [ ] Edit `src/app/api/mcp/route.ts`:
  - replace the bare 401 (`route.ts:52-55`) with a 401 carrying `WWW-Authenticate: Bearer resource_metadata="${await publicOrigin()}/.well-known/oauth-protected-resource"`;
  - change the `ctx.kind !== 'pat'` rejection (`route.ts:56-59`) to accept `kind === 'pat' || kind === 'oauth'` (still reject `api_key`, which has no `mcp:*` scopes by design — keep that comment accurate);
  - leave the `hasMcpScope` gate (`route.ts:60-63`) unchanged.
- [ ] Run spec + the existing `tests/api/mcp.test.ts` (regression); lint+typecheck; commit:
  ```sh
  source ~/.zshenv && git add src/app/api/mcp/route.ts tests/api/mcp/www-authenticate-resource-metadata.spec.ts && git commit -m "feat(mcp): WWW-Authenticate challenge + accept OAuth access tokens"
  ```

## Task 11 — Settings → Developer → MCP page: OAuth-preferred copy + connections list

> **SPEC FILE: `tests/ui/oauth-consent-screen.spec.ts`** — renders the consent screen component with a fake client + scopes + workspace and asserts: the client name is shown, each requested scope renders its friendly label (from the shared `devTokens.scope.*` tooltips), the workspace name is shown, and both **Allow** and **Cancel** controls are present and reachable (a11y: buttons have accessible names, ≥44px touch target like `mcp-connection-info.tsx:64`).
>
> **SPEC FILE: `tests/ui/oauth-connections-list.spec.ts`** — renders `OauthConnectionsList` with two fake connection rows and asserts each shows client name, granted scopes, last-used (relative), and a **Revoke** button; clicking Revoke calls the revoke action and removes the row (optimistic), mirroring the Active-Sessions list interaction.

- [ ] Write BOTH UI specs FIRST (component-level, following `tests/ui/*.spec.ts` convention).
- [ ] Implement `src/components/dev-settings/oauth-connections-list.tsx` — client component listing active `oauth_tokens` grouped per client (name, scopes, last used, **Revoke**), styled like the Active-Sessions list (`src/app/(app)/settings/security`). Revoke posts to `/api/oauth/revoke` (or a thin `/api/dev/oauth-connections/[id]` DELETE wrapper) and removes the row.
- [ ] Update `src/app/(app)/settings/developer/tokens/page.tsx`: load the signed-in user's active OAuth connections (query `oauth_tokens` joined to `oauth_clients`, non-revoked) and render `<OauthConnectionsList>` above the PAT `<TokenList>`; update the header copy to lead with OAuth ("Connect Claude Desktop / Cursor with OAuth — no token to paste").
- [ ] Update `src/components/dev-settings/mcp-connection-info.tsx`: lead with **"OAuth (recommended)"** — show just the `…/api/mcp` URL and a one-line "your client will open a browser to approve access"; move the PAT JSON snippets under a collapsed **"Use a bearer token instead"** `<details>` disclosure (keep the existing copy buttons + a11y attributes).
- [ ] Add `oauthConsent.*` + `oauthConnections.*` keys to `messages/en.json`, `messages/es.json`, `messages/ar.json` (label/allow/cancel/revoke/lastUsed/scopesHeading). Reuse the existing `devTokens.scope.*.tip` keys for scope tooltips — do not duplicate.
- [ ] Run both UI specs; lint+typecheck; `source ~/.zshenv && pnpm build`; commit:
  ```sh
  source ~/.zshenv && git add src/components/dev-settings/oauth-connections-list.tsx src/components/dev-settings/mcp-connection-info.tsx "src/app/(app)/settings/developer/tokens/page.tsx" messages tests/ui/oauth-consent-screen.spec.ts tests/ui/oauth-connections-list.spec.ts && git commit -m "feat(oauth): OAuth-preferred MCP settings copy + connections list"
  ```

---

## Threat model

| Threat | Mitigation (where) |
| --- | --- |
| Authorization-code interception (public client, no secret) | **PKCE S256 REQUIRED** for every client — `/authorize` rejects a missing/`!=S256` `code_challenge` (Task 5); `/token` rejects a `code_verifier` that doesn't hash to the bound challenge (Task 6, `src/lib/oauth/pkce.ts`). |
| Refresh-token replay | **Rotation** — each refresh revokes the presented refresh token and issues a new one; reuse of a rotated token → `invalid_grant` (Task 7). |
| Authorization-code replay | One-shot codes — `consumed_at` flips on first exchange; reuse → `invalid_grant` AND descendant tokens revoked (Task 6); 60 s expiry. |
| Silent / phishing grants | Browser **consent screen** (client name + scopes + workspace + Allow/Cancel) on every authorization; no implicit/auto-grant path (Task 5). |
| Open redirect / token exfiltration via redirect_uri | **Exact-match** redirect_uri allowlist; a non-matching URI is rejected WITHOUT redirecting to it (Tasks 4–6). Only absolute http/https URIs accepted at registration. |
| Token theft from DB | All codes/access/refresh/client-secrets **hashed (sha256) at rest** (`hashOauthToken`); plaintext returned once, never re-fetchable (Tasks 2–7). |
| Scope escalation | Granted scopes intersected with the user's workspace role at consent (Task 5); refresh cannot widen scopes (Task 7); `requireScope` admin-superset semantics unchanged (Task 9). |
| Secret leakage into audit/exports | OAuth secret prefixes added to `FORBIDDEN_SUBSTRINGS`; metadata carries ids/counts/scope-names only (Task 8). |
| Audit gap | Every register / consent / issue / refresh / revoke writes an audit row inside the same transaction as the state change (Tasks 4–8), so the log can never drift. |

## Coverage check

Every task pairs a failing spec with the implementation that makes it pass. Surface → spec mapping:

| Requirement | Spec file | Task |
| --- | --- | --- |
| Migration + 3 tables | `tests/db/oauth-schema.spec.ts` | 1 |
| PKCE / token-hash / scope helpers | `tests/lib/oauth-{pkce,tokens,scopes}.spec.ts` | 2 |
| RFC 8414 + resource metadata | `tests/api/oauth/discovery.spec.ts` | 3 |
| RFC 7591 registration | `tests/api/oauth/dynamic-registration.spec.ts` | 4 |
| Authorize + consent + PKCE-required-at-authorize | `tests/api/oauth/authorize-consent.spec.ts` | 5 |
| Code→token exchange + PKCE verify | `tests/api/oauth/token-exchange.spec.ts`, `tests/api/oauth/pkce-required.spec.ts` | 6 |
| Refresh + rotation | `tests/api/oauth/refresh.spec.ts` | 7 |
| RFC 7009 revoke + audit + leak-guard | `tests/api/oauth/revoke.spec.ts` (+ security suite case) | 8 |
| OAuth tokens through resolveToken + scope enforcement | `tests/api/oauth/scope-enforcement.spec.ts` | 9 |
| MCP 401 WWW-Authenticate + OAuth accepted | `tests/api/mcp/www-authenticate-resource-metadata.spec.ts` | 10 |
| Consent UI + connections list | `tests/ui/oauth-consent-screen.spec.ts`, `tests/ui/oauth-connections-list.spec.ts` | 11 |

All 10 user-specified spec files are present, plus the lib + schema specs the TDD steps require. Audit vocabulary, leak-guard prefixes, scope mapping, and backward-compat (PAT/api_key still resolve) are each asserted.

## Failure modes verified (each fails on current `release/v0.9.16`, passes after its task)

- `discovery.spec.ts` — fails: `/.well-known/oauth-authorization-server` 404 (no route). Passes after Task 3.
- `dynamic-registration.spec.ts` — fails: `/api/oauth/register` 404. Passes after Task 4.
- `authorize-consent.spec.ts` — fails: `/api/oauth/authorize` 404; no consent page. Passes after Task 5.
- `token-exchange.spec.ts` / `pkce-required.spec.ts` — fail: `/api/oauth/token` 404. Pass after Task 6.
- `refresh.spec.ts` — fails: refresh grant unhandled. Passes after Task 7.
- `revoke.spec.ts` — fails: `/api/oauth/revoke` 404; `oauth.token_revoked` not in `AUDIT_ACTIONS`. Passes after Task 8.
- `scope-enforcement.spec.ts` — fails: `resolveToken('Bearer cairn_oauth_…')` returns null (no branch). Passes after Task 9.
- `www-authenticate-resource-metadata.spec.ts` — fails: current `route.ts:52-55` returns 401 with **no** `WWW-Authenticate` header, and an OAuth token is rejected by the `ctx.kind !== 'pat'` guard (`route.ts:56-59`). Passes after Task 10.
- `oauth-consent-screen.spec.ts` / `oauth-connections-list.spec.ts` — fail: components don't exist. Pass after Task 11.
- `oauth-schema.spec.ts` — fails: tables absent (migration 0068 is latest). Passes after Task 1.

## Manual smoke (HUMAN-RUN — after all tasks green)

1. `source ~/.zshenv && pnpm dev`; sign in to a workspace.
2. **Claude Desktop**: add an MCP server with URL `http://localhost:3000/api/mcp` (no token). Claude probes `/api/mcp` → gets `401 WWW-Authenticate` → fetches resource metadata → AS metadata → self-registers → opens the browser to the Cairn **consent screen**. Confirm the screen shows "Claude" (client name) + the requested scopes + the workspace. Click **Allow**. Confirm Claude reports the server connected and `tools/list` returns Cairn tools — **with no token pasted anywhere**.
3. **Cursor**: same with `http://localhost:3000/api/mcp`. Confirm browser consent → tools usable.
4. In **Settings → Developer → Personal tokens**, confirm the new **OAuth connections** list shows the two clients (name, scopes, last used). Click **Revoke** on one; confirm that client can no longer call tools (next request 401s and re-prompts consent).
5. Confirm the old PAT path still works: paste a `cairn_pat_` token via the collapsed "Use a bearer token instead" disclosure config → tools still work.
6. In **Settings → Admin → Audit**, confirm `oauth.client_registered`, `oauth.consent_granted`, `oauth.token_issued`, `oauth.token_revoked` rows appear with no secrets in metadata.

## Out of scope

- **JWT / introspection access tokens** — Cairn uses opaque hashed tokens resolved by DB lookup (same as PATs); no signed JWT access tokens, no RFC 7662 introspection endpoint.
- **Authorization-server UI for managing registered clients** beyond the per-user connections list (no admin "registered apps" console).
- **`client_credentials` / device-code / implicit grants** — only `authorization_code` + `refresh_token` are supported.
- **Consent "remember this app" / scope step-up re-consent flows** — every authorization shows the full consent screen.
- **Rate-limiting the OAuth endpoints** beyond the existing global auth rate-limit middleware (no per-client OAuth quota; PAT quotas are unchanged and OAuth tokens are not yet wired into `pat-quota`).
- **Migrating existing PAT-based MCP configs** — PATs remain fully supported indefinitely; no forced migration.

## Gate

- Biome 0 errors (`pnpm lint`) · `pnpm typecheck` clean · `pnpm build` clean.
- All new specs green: `pnpm test tests/db/oauth-schema.spec.ts tests/lib/oauth-*.spec.ts tests/api/oauth tests/api/mcp tests/ui/oauth-*.spec.ts`.
- Regression: existing `tests/api/mcp.test.ts`, PAT auth, and the security/secret-leak suite stay green.
- CI matrix on PR.
- **Do NOT push.** The controller/human pushes and opens the PR.
