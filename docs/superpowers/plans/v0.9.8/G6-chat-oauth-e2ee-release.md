# Cairn v0.9.8 — G6: Chat OAuth + E2EE finish + release (audit F, E)

**For agentic workers: REQUIRED SUB-SKILL — `superpowers:test-driven-development`.** Every task below is a strict TDD cycle: write the failing test, run it to confirm it fails for the right reason, write the minimal implementation, run it to green, then commit. Do not skip the run-to-fail step. Do not batch tasks.

**Goal:** Land the only genuinely-new chat work for v0.9.8 — full Slack + Discord OAuth installers (audit item **F**, zero scaffolding exists today) — backed by a new encrypted-at-rest install table (migration **0060**); finish + verify + document the env-gated end-to-end encryption path (audit item **E**, keep `CAIRN_ENABLE_E2E_ENCRYPTION` default-off); then cut the v0.9.8 release (version bump, CHANGELOG, single held PR `patches/v0.9.8 → main`).

**Architecture:** OAuth installs are stored in a dedicated `chat_oauth_installs` table separate from the legacy `webhooks` rows and the P37 `chat_bridge_installs` table — the manual webhook+secret path (`src/app/api/admin/chat-bridge/route.ts`) stays as a working fallback and is NOT touched. Bot tokens are sealed with the existing AEAD primitive `src/lib/crypto/secret-box.ts` (`sealSecret`/`openSecret`, AES-256-GCM, key = `AUTH_SECRET`). CSRF state is a short-TTL HS256 JWT minted by the existing `src/lib/sso/state-jwt.ts` signer (10-min default), mirroring `src/lib/sso/oidc-state.ts`. Redirect URIs are derived from `publicOrigin()` (`src/lib/url.ts:38`) and the external callback exchange URL is SSRF-gated by `assertPublicUrl()` (`src/lib/webhooks/ssrf.ts:45`). E2EE is verification + docs + copy only — no crypto changes; the flag and libs (`src/lib/e2e/*`) already exist.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Drizzle ORM + Postgres 16, Auth.js v5 (`requireRole('admin')`), `jose` (HS256), Biome v2, Vitest 4 + Testcontainers v12, Tailwind v4 + shadcn/ui, i18n en/es/ar via `useT()` (`src/lib/i18n/provider.tsx`).

---

## Conventions for every task

- Prefix every shell command with `source ~/.zshenv && ` (Homebrew/pnpm/docker are not on PATH otherwise; this also sets `DOCKER_HOST` for Testcontainers).
- Tests need Docker (Colima): `source ~/.zshenv && docker info` should succeed; `colima start` if not.
- TDD order per task: (1) write failing test, (2) run it → confirm RED, (3) minimal impl, (4) run it → GREEN, (5) `git add <paths> && git commit -m "..."`.
- New user-facing strings get `chatOauth.*` / `e2ee.*` keys in `messages/en.json`, `messages/es.json`, `messages/ar.json` and are read via `useT()`. `pnpm i18n:check` must report no NEW missing keys.
- Bot tokens / signing secrets are NEVER logged and NEVER returned to the client. The pino redaction sink already strips `botToken`/`bot_token`/`signingSecret` (see `tests/lib/chat/secret-leak.test.ts`); we extend it for the OAuth path.

---

## Files

### Task 1 — Migration 0060 + Drizzle table `chat_oauth_installs`
- **Create** `drizzle/migrations/0060_chat_oauth_installs.sql` (next number after `0057`; 0058/0059/0061 are owned by G5 but G6 builds independently — use **0060** as assigned).
- **Create** `src/db/schema/chat-oauth.ts`
- **Modify** `src/db/schema/index.ts` (add `export * from './chat-oauth';` near the other chat-bridge exports, line ~12)
- **Create** `tests/db/chat-oauth-schema.test.ts`

### Task 2 — Bot-token sealing helper (typed wrapper around secret-box)
- **Create** `src/lib/chat/oauth-token.ts`
- **Create** `tests/lib/chat/oauth-token.test.ts`

### Task 3 — OAuth CSRF state (sign + verify, short TTL)
- **Create** `src/lib/chat/oauth-state.ts`
- **Create** `tests/lib/chat/oauth-state.test.ts`

### Task 4 — Provider config + redirect-URI builder (SSRF-gated, PUBLIC_URL)
- **Create** `src/lib/chat/oauth-providers.ts`
- **Create** `tests/lib/chat/oauth-providers.test.ts`

### Task 5 — Install-start routes (Slack + Discord authorize redirect)
- **Create** `src/app/api/admin/chat-bridge/oauth/slack/start/route.ts`
- **Create** `src/app/api/admin/chat-bridge/oauth/discord/start/route.ts`
- **Create** `tests/api/chat-oauth-start.test.ts`

### Task 6 — Token-exchange lib (Slack `oauth.v2.access` + Discord token grant)
- **Create** `src/lib/chat/oauth-exchange.ts`
- **Create** `tests/lib/chat/oauth-exchange.test.ts`

### Task 7 — Callback routes (exchange → seal → persist)
- **Create** `src/app/api/admin/chat-bridge/oauth/slack/callback/route.ts`
- **Create** `src/app/api/admin/chat-bridge/oauth/discord/callback/route.ts`
- **Create** `src/lib/chat/oauth-install.ts` (persist helper, shared by both callbacks)
- **Create** `tests/api/chat-oauth-callback.test.ts`

### Task 8 — Extend secret-leak suite for OAuth bot tokens
- **Modify** `tests/lib/chat/secret-leak.test.ts`
- **Modify** `src/lib/observability/logger.ts` (only if a new redaction path is needed — add `accessToken`/`access_token` to the redact list)

### Task 9 — OAuth UI + i18n + remove "v0.10" copy
- **Modify** `src/app/(app)/admin/chat-bridge/page.tsx` (remove v0.10 copy line 48; pass OAuth-install status props)
- **Modify** `src/app/(app)/admin/chat-bridge/chat-bridge-form.tsx` (add OAuth install buttons above the manual-fallback form)
- **Modify** `messages/en.json`, `messages/es.json`, `messages/ar.json` (`chatOauth.*` keys)
- **Create** `tests/components/chat-oauth-buttons.test.tsx`

### Task 10 — E2EE flag-ON round-trip verification test
- **Create** `tests/e2e-flag/encryption-roundtrip.test.ts`

### Task 11 — E2EE admin copy fix + i18n + admin docs
- **Modify** `src/app/(app)/settings/admin/encryption/page.tsx` (lines 54-57 copy)
- **Modify** `messages/en.json`, `messages/es.json`, `messages/ar.json` (`e2ee.*` keys)
- **Create** `docs/admin/e2e-encryption.md`
- **Create** `tests/components/encryption-page-copy.test.tsx`

### Task 12 — Per-group gate
- (no new files; runs the full gate)

### Task 13 — Release: version bump + CHANGELOG + held PR
- **Modify** `package.json` (`"version": "0.9.8"`)
- **Modify** `CHANGELOG.md` (`## [0.9.8]` section)

---

## Task 1 — Migration 0060 + Drizzle table `chat_oauth_installs`

**Step 1 — Write the failing test.**

Create `tests/db/chat-oauth-schema.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { getTestDb, resetDb, startPostgres, stopPostgres } from '../helpers/db';

describe('chat_oauth_installs schema (migration 0060)', () => {
  beforeAll(startPostgres);
  afterAll(stopPostgres);
  beforeEach(resetDb);

  it('round-trips an install row with encrypted bot token + scopes array', async () => {
    const db = getTestDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'WS', slug: 'ws-oauth' })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'admin@example.com', name: 'Admin', passwordHash: 'x' })
      .returning();

    const [row] = await db
      .insert(schema.chatOauthInstalls)
      .values({
        workspaceId: ws.id,
        platform: 'slack',
        externalTeamId: 'T123',
        botTokenEncrypted: Buffer.from('sealed-bytes'),
        scopes: ['chat:write', 'channels:read'],
        installedBy: user.id,
      })
      .returning();

    expect(row.platform).toBe('slack');
    expect(row.externalTeamId).toBe('T123');
    expect(row.scopes).toEqual(['chat:write', 'channels:read']);
    expect(row.revokedAt).toBeNull();
    expect(Buffer.isBuffer(row.botTokenEncrypted)).toBe(true);

    const found = await db
      .select()
      .from(schema.chatOauthInstalls)
      .where(eq(schema.chatOauthInstalls.id, row.id));
    expect(found).toHaveLength(1);
  });

  it('enforces unique (workspace_id, platform, external_team_id)', async () => {
    const db = getTestDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'WS', slug: 'ws-uniq' })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'u@example.com', name: 'U', passwordHash: 'x' })
      .returning();
    const base = {
      workspaceId: ws.id,
      platform: 'discord' as const,
      externalTeamId: 'G999',
      botTokenEncrypted: Buffer.from('s'),
      scopes: ['bot'],
      installedBy: user.id,
    };
    await db.insert(schema.chatOauthInstalls).values(base);
    await expect(db.insert(schema.chatOauthInstalls).values(base)).rejects.toThrow();
  });
});
```

**Step 2 — Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/db/chat-oauth-schema.test.ts
```
Expected: FAIL — `Property 'chatOauthInstalls' does not exist on type ...` / `relation "chat_oauth_installs" does not exist`.

**Step 3 — Minimal impl: Drizzle schema.**

Create `src/db/schema/chat-oauth.ts`:

```ts
/**
 * v0.9.8 G6 (audit F) — chat OAuth installs.
 *
 * Distinct from the legacy `webhooks` rows (manual webhook+secret fallback) and
 * the P37 `chat_bridge_installs` table: this records full-OAuth installs only.
 * `bot_token_encrypted` is an AES-256-GCM envelope (src/lib/crypto/secret-box.ts);
 * the plaintext token never leaves the server and is never logged.
 */

import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

// Postgres bytea — Drizzle has no first-class bytea (matches src/db/schema/e2e.ts).
const bytea = customType<{ data: Buffer; default: false; notNull: true }>({
  dataType() {
    return 'bytea';
  },
});

export const chatOauthInstalls = pgTable(
  'chat_oauth_installs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // 'slack' | 'discord' — guarded by a CHECK constraint appended in the migration.
    platform: text('platform').notNull(),
    externalTeamId: text('external_team_id').notNull(),
    botTokenEncrypted: bytea('bot_token_encrypted').notNull(),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    installedBy: uuid('installed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('chat_oauth_installs_workspace_idx').on(t.workspaceId),
    uniqueIndex('chat_oauth_installs_team_uniq').on(
      t.workspaceId,
      t.platform,
      t.externalTeamId,
    ),
  ],
);

export type ChatOauthInstall = typeof chatOauthInstalls.$inferSelect;
export type NewChatOauthInstall = typeof chatOauthInstalls.$inferInsert;
```

Add to `src/db/schema/index.ts` immediately after the existing `export * from './chat-bridge';` (line ~12):

```ts
// v0.9.8 G6 (audit F) — chat OAuth installs (full Slack/Discord OAuth).
export * from './chat-oauth';
```

**Step 4 — Write the migration SQL by hand.** `db:generate` does not emit the platform CHECK or array default reliably — hand-write it. Create `drizzle/migrations/0060_chat_oauth_installs.sql`:

```sql
CREATE TABLE "chat_oauth_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_team_id" text NOT NULL,
	"bot_token_encrypted" "bytea" NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"installed_by" uuid NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "chat_oauth_installs_platform_check" CHECK ("platform" IN ('slack','discord'))
);
--> statement-breakpoint
ALTER TABLE "chat_oauth_installs" ADD CONSTRAINT "chat_oauth_installs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_oauth_installs" ADD CONSTRAINT "chat_oauth_installs_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_oauth_installs_workspace_idx" ON "chat_oauth_installs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_oauth_installs_team_uniq" ON "chat_oauth_installs" USING btree ("workspace_id","platform","external_team_id");
```

Append a journal entry to `drizzle/migrations/meta/_journal.json` (one entry per migration, following the existing pattern: increment `idx`, set `tag` to `0060_chat_oauth_installs`, set `when` to the current epoch-ms, keep `version`/`breakpoints` consistent with the prior entries).

**Step 5 — Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/db/chat-oauth-schema.test.ts
```
Expected: PASS (2 tests).

**Step 6 — Commit.**

```sh
git add drizzle/migrations/0060_chat_oauth_installs.sql drizzle/migrations/meta/_journal.json src/db/schema/chat-oauth.ts src/db/schema/index.ts tests/db/chat-oauth-schema.test.ts && git commit -m "feat(chat): add chat_oauth_installs table (migration 0060)"
```

---

## Task 2 — Bot-token sealing helper

A thin, typed wrapper over `sealSecret`/`openSecret` so the OAuth path has one obvious call-site and the key source (`AUTH_SECRET`) is centralized.

**Step 1 — Write the failing test.**

Create `tests/lib/chat/oauth-token.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { openBotToken, sealBotToken } from '@/lib/chat/oauth-token';

describe('chat oauth bot-token sealing', () => {
  const SECRET = 'x'.repeat(32);

  it('round-trips a bot token through seal/open', () => {
    const sealed = sealBotToken('xoxb-real-token', SECRET);
    expect(Buffer.isBuffer(sealed)).toBe(true);
    expect(sealed.toString('utf8')).not.toContain('xoxb-real-token');
    expect(openBotToken(sealed, SECRET)).toBe('xoxb-real-token');
  });

  it('throws when opened with the wrong key', () => {
    const sealed = sealBotToken('xoxb-real-token', SECRET);
    expect(() => openBotToken(sealed, 'y'.repeat(32))).toThrow();
  });

  it('rejects an AUTH_SECRET shorter than 32 chars', () => {
    expect(() => sealBotToken('t', 'short')).toThrow(/AUTH_SECRET/);
  });
});
```

**Step 2 — Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/chat/oauth-token.test.ts
```
Expected: FAIL — cannot find module `@/lib/chat/oauth-token`.

**Step 3 — Minimal impl.**

Create `src/lib/chat/oauth-token.ts`:

```ts
/**
 * v0.9.8 G6 (audit F) — bot-token sealing for chat OAuth installs.
 *
 * Wraps the project AEAD primitive (src/lib/crypto/secret-box.ts) with a fixed
 * key source (AUTH_SECRET) so the OAuth callback has one obvious seal/open
 * call-site. Plaintext bot tokens are NEVER persisted and NEVER logged.
 */

import { openSecret, sealSecret } from '@/lib/crypto/secret-box';

function requireKey(key: string): string {
  if (!key || key.length < 32) {
    throw new Error('AUTH_SECRET missing or too short (need >=32 chars) to seal bot token');
  }
  return key;
}

export function sealBotToken(plaintext: string, key = process.env.AUTH_SECRET ?? ''): Buffer {
  return sealSecret(plaintext, requireKey(key));
}

export function openBotToken(sealed: Buffer, key = process.env.AUTH_SECRET ?? ''): string {
  return openSecret(sealed, requireKey(key));
}
```

**Step 4 — Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/chat/oauth-token.test.ts
```
Expected: PASS (3 tests).

**Step 5 — Commit.**

```sh
git add src/lib/chat/oauth-token.ts tests/lib/chat/oauth-token.test.ts && git commit -m "feat(chat): add sealBotToken/openBotToken helper for OAuth installs"
```

---

## Task 3 — OAuth CSRF state (sign + verify, short TTL)

Mirrors `src/lib/sso/oidc-state.ts` — a short-TTL HS256 JWT minted by `src/lib/sso/state-jwt.ts`, carrying the workspace id, platform, and a nonce; verified in the callback to defeat CSRF.

**Step 1 — Write the failing test.**

Create `tests/lib/chat/oauth-state.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signOauthState, verifyOauthState } from '@/lib/chat/oauth-state';

describe('chat oauth CSRF state', () => {
  const prev = process.env.AUTH_SECRET;
  beforeEach(() => {
    process.env.AUTH_SECRET = 'a'.repeat(40);
  });
  afterEach(() => {
    process.env.AUTH_SECRET = prev;
  });

  it('round-trips a signed state for the matching platform', async () => {
    const token = await signOauthState({
      workspaceId: 'ws-1',
      platform: 'slack',
      nonce: 'n1',
    });
    const payload = await verifyOauthState(token, 'slack');
    expect(payload.workspaceId).toBe('ws-1');
    expect(payload.platform).toBe('slack');
    expect(payload.nonce).toBe('n1');
  });

  it('rejects a platform mismatch', async () => {
    const token = await signOauthState({ workspaceId: 'ws-1', platform: 'slack', nonce: 'n' });
    await expect(verifyOauthState(token, 'discord')).rejects.toThrow(/platform mismatch/);
  });

  it('rejects an expired state', async () => {
    const token = await signOauthState({
      workspaceId: 'ws-1',
      platform: 'slack',
      nonce: 'n',
      ttlSeconds: -1,
    });
    await expect(verifyOauthState(token, 'slack')).rejects.toThrow();
  });
});
```

**Step 2 — Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/chat/oauth-state.test.ts
```
Expected: FAIL — cannot find module `@/lib/chat/oauth-state`.

**Step 3 — Minimal impl.**

Create `src/lib/chat/oauth-state.ts`:

```ts
/**
 * v0.9.8 G6 (audit F) — CSRF state for chat OAuth installs.
 *
 * A short-TTL HS256 JWT (default 600s) signed with AUTH_SECRET, mirroring
 * src/lib/sso/oidc-state.ts. The install-start route mints it; the callback
 * verifies it (platform + signature + expiry) before exchanging the code.
 */

import { signStateJwt, verifyStateJwt } from '@/lib/sso/state-jwt';

export type ChatOauthPlatform = 'slack' | 'discord';

export type ChatOauthStatePayload = {
  workspaceId: string;
  platform: ChatOauthPlatform;
  nonce: string;
};

export async function signOauthState(
  input: ChatOauthStatePayload & { ttlSeconds?: number },
): Promise<string> {
  return signStateJwt(
    { workspaceId: input.workspaceId, platform: input.platform, nonce: input.nonce },
    { ttlSeconds: input.ttlSeconds ?? 600 },
  );
}

export async function verifyOauthState(
  value: string,
  expectedPlatform: ChatOauthPlatform,
): Promise<ChatOauthStatePayload> {
  const payload = await verifyStateJwt(value);
  const workspaceId = payload.workspaceId;
  const platform = payload.platform;
  const nonce = payload.nonce;
  if (
    typeof workspaceId !== 'string' ||
    (platform !== 'slack' && platform !== 'discord') ||
    typeof nonce !== 'string'
  ) {
    throw new Error('invalid oauth state payload shape');
  }
  if (platform !== expectedPlatform) {
    throw new Error('platform mismatch');
  }
  return { workspaceId, platform, nonce };
}
```

**Step 4 — Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/chat/oauth-state.test.ts
```
Expected: PASS (3 tests).

**Step 5 — Commit.**

```sh
git add src/lib/chat/oauth-state.ts tests/lib/chat/oauth-state.test.ts && git commit -m "feat(chat): add signed short-TTL OAuth CSRF state"
```

---

## Task 4 — Provider config + redirect-URI builder

Per-platform authorize-URL + token-URL config, plus a redirect-URI builder derived from `publicOrigin()` and SSRF-gated by `assertPublicUrl()`.

**Step 1 — Write the failing test.**

Create `tests/lib/chat/oauth-providers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  oauthRedirectUri,
  PROVIDERS,
} from '@/lib/chat/oauth-providers';

describe('chat oauth providers', () => {
  it('builds a public, SSRF-safe redirect URI from a public origin', async () => {
    const uri = await oauthRedirectUri('https://cairn.example.com', 'slack');
    expect(uri).toBe('https://cairn.example.com/api/admin/chat-bridge/oauth/slack/callback');
  });

  it('rejects a private/loopback origin', async () => {
    await expect(oauthRedirectUri('http://127.0.0.1:3000', 'slack')).rejects.toThrow(/Refusing/);
  });

  it('builds a Slack authorize URL with scopes, client id, redirect and state', () => {
    const url = new URL(
      buildAuthorizeUrl('slack', {
        clientId: 'CID',
        redirectUri: 'https://c.example.com/api/admin/chat-bridge/oauth/slack/callback',
        state: 'STATE',
      }),
    );
    expect(url.origin + url.pathname).toBe(PROVIDERS.slack.authorizeUrl);
    expect(url.searchParams.get('client_id')).toBe('CID');
    expect(url.searchParams.get('state')).toBe('STATE');
    expect(url.searchParams.get('scope')).toBe(PROVIDERS.slack.scopes.join(','));
    expect(url.searchParams.get('redirect_uri')).toContain('/slack/callback');
  });

  it('builds a Discord authorize URL (space-delimited scopes + permissions)', () => {
    const url = new URL(
      buildAuthorizeUrl('discord', {
        clientId: 'DID',
        redirectUri: 'https://c.example.com/api/admin/chat-bridge/oauth/discord/callback',
        state: 'ST',
      }),
    );
    expect(url.searchParams.get('scope')).toBe(PROVIDERS.discord.scopes.join(' '));
    expect(url.searchParams.get('client_id')).toBe('DID');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});
```

**Step 2 — Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/chat/oauth-providers.test.ts
```
Expected: FAIL — cannot find module `@/lib/chat/oauth-providers`.

**Step 3 — Minimal impl.**

Create `src/lib/chat/oauth-providers.ts`:

```ts
/**
 * v0.9.8 G6 (audit F) — Slack + Discord OAuth provider config.
 *
 * Slack: oauth.v2.access (comma-delimited bot scopes). Discord: bot
 * authorization-code grant (space-delimited scopes + bot permissions integer).
 * Redirect URIs are always derived from publicOrigin() and SSRF-gated so we
 * never hand an internal callback URL to an external IdP.
 */

import type { ChatOauthPlatform } from '@/lib/chat/oauth-state';
import { assertPublicUrl } from '@/lib/webhooks/ssrf';

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeDelimiter: string;
  // Discord-only: bot permissions bitfield (View Channels + Send Messages + Read History).
  permissions?: string;
};

export const PROVIDERS: Record<ChatOauthPlatform, ProviderConfig> = {
  slack: {
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read', 'channels:history', 'commands'],
    scopeDelimiter: ',',
  },
  discord: {
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scopes: ['bot', 'applications.commands'],
    scopeDelimiter: ' ',
    permissions: '68608', // View Channel (1024) + Send Messages (2048) + Read History (65536)
  },
};

export async function oauthRedirectUri(
  origin: string,
  platform: ChatOauthPlatform,
): Promise<string> {
  const uri = `${origin.replace(/\/$/, '')}/api/admin/chat-bridge/oauth/${platform}/callback`;
  // Re-validate the origin is public (defends against a spoofed PUBLIC_URL / host header).
  await assertPublicUrl(uri);
  return uri;
}

export function buildAuthorizeUrl(
  platform: ChatOauthPlatform,
  input: { clientId: string; redirectUri: string; state: string },
): string {
  const cfg = PROVIDERS[platform];
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('scope', cfg.scopes.join(cfg.scopeDelimiter));
  url.searchParams.set('response_type', 'code');
  if (cfg.permissions) url.searchParams.set('permissions', cfg.permissions);
  return url.toString();
}
```

**Step 4 — Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/chat/oauth-providers.test.ts
```
Expected: PASS (4 tests). Note: the private-origin test exercises `assertPublicUrl` against `127.0.0.1` — it is blocked by literal-IP check without DNS, so no network is hit.

**Step 5 — Commit.**

```sh
git add src/lib/chat/oauth-providers.ts tests/lib/chat/oauth-providers.test.ts && git commit -m "feat(chat): add Slack/Discord OAuth provider config + SSRF-gated redirect URI"
```

---

## Task 5 — Install-start routes (authorize redirect)

Admin-gated GET routes that mint state and 302 to the provider's authorize URL. Requires `CAIRN_SLACK_CLIENT_ID` / `CAIRN_DISCORD_CLIENT_ID` env. Add these to `src/lib/env.ts` as optional strings in this task (they are read directly via `process.env` in the route to avoid the cached-env gotcha, but adding the schema keys documents them).

**Step 1 — Write the failing test.**

Create `tests/api/chat-oauth-start.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/config')>('@/lib/auth/config');
  let session: unknown = null;
  return {
    ...actual,
    auth: vi.fn(async () => session),
    __set: (s: unknown) => {
      session = s;
    },
  };
});

vi.mock('@/lib/url', () => ({ publicOrigin: vi.fn(async () => 'https://cairn.example.com') }));

vi.mock('@/lib/auth/require-role', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/require-role')>('@/lib/auth/require-role');
  return {
    ...actual,
    requireRole: vi.fn(async () => ({
      userId: 'u1',
      workspaceId: 'ws1',
      role: 'admin' as const,
    })),
  };
});

describe('GET chat-bridge oauth start', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'a'.repeat(40);
    process.env.CAIRN_SLACK_CLIENT_ID = 'SLACK_CID';
  });
  afterEach(() => {
    process.env.CAIRN_SLACK_CLIENT_ID = undefined;
  });

  it('redirects to slack.com authorize with state + redirect_uri', async () => {
    const { GET } = await import(
      '@/app/api/admin/chat-bridge/oauth/slack/start/route'
    );
    const res = await GET(new Request('https://cairn.example.com/api/admin/chat-bridge/oauth/slack/start'));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.origin).toBe('https://slack.com');
    expect(loc.searchParams.get('client_id')).toBe('SLACK_CID');
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect(loc.searchParams.get('redirect_uri')).toContain('/slack/callback');
  });

  it('500s when the client id env is missing', async () => {
    process.env.CAIRN_SLACK_CLIENT_ID = undefined;
    const { GET } = await import(
      '@/app/api/admin/chat-bridge/oauth/slack/start/route'
    );
    const res = await GET(new Request('https://cairn.example.com/x'));
    expect(res.status).toBe(500);
  });
});
```

**Step 2 — Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/api/chat-oauth-start.test.ts
```
Expected: FAIL — cannot find the route module.

**Step 3 — Minimal impl.** First add env schema keys to `src/lib/env.ts` (after `CAIRN_FEDERATION_SHARED_SECRET`, before any `NEXT_PUBLIC_` block end — just add the lines):

```ts
  // v0.9.8 G6 (audit F) — chat OAuth installer credentials (optional; the
  // manual webhook+secret fallback works without them). Read via process.env
  // in the route to avoid the cached-env() gotcha.
  CAIRN_SLACK_CLIENT_ID: z.string().optional(),
  CAIRN_SLACK_CLIENT_SECRET: z.string().optional(),
  CAIRN_DISCORD_CLIENT_ID: z.string().optional(),
  CAIRN_DISCORD_CLIENT_SECRET: z.string().optional(),
```

Create `src/app/api/admin/chat-bridge/oauth/slack/start/route.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildAuthorizeUrl, oauthRedirectUri } from '@/lib/chat/oauth-providers';
import { signOauthState } from '@/lib/chat/oauth-state';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { publicOrigin } from '@/lib/url';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const clientId = process.env.CAIRN_SLACK_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: 'Slack OAuth is not configured' }, { status: 500 });
    }
    const origin = await publicOrigin();
    const redirectUri = await oauthRedirectUri(origin, 'slack');
    const state = await signOauthState({
      workspaceId: ctx.workspaceId,
      platform: 'slack',
      nonce: randomUUID(),
    });
    const authorizeUrl = buildAuthorizeUrl('slack', { clientId, redirectUri, state });
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
```

Create `src/app/api/admin/chat-bridge/oauth/discord/start/route.ts` — identical except `CAIRN_DISCORD_CLIENT_ID`, `'discord'` everywhere, and error message `'Discord OAuth is not configured'`.

**Step 4 — Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/api/chat-oauth-start.test.ts
```
Expected: PASS (2 tests).

**Step 5 — Commit.**

```sh
git add src/lib/env.ts "src/app/api/admin/chat-bridge/oauth/slack/start/route.ts" "src/app/api/admin/chat-bridge/oauth/discord/start/route.ts" tests/api/chat-oauth-start.test.ts && git commit -m "feat(chat): add Slack/Discord OAuth install-start routes"
```

---

## Task 6 — Token-exchange lib

Pure, fetch-injected exchange of an authorization code for a bot token + external team id. Slack uses `oauth.v2.access` (returns `{ ok, access_token, team: { id } }`); Discord's token grant returns `{ access_token, guild: { id } }` when the `bot` scope is granted.

**Step 1 — Write the failing test.**

Create `tests/lib/chat/oauth-exchange.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { exchangeCode } from '@/lib/chat/oauth-exchange';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('chat oauth code exchange', () => {
  it('parses a Slack oauth.v2.access success', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, access_token: 'xoxb-tok', team: { id: 'T1' }, scope: 'chat:write,commands' }),
    );
    const out = await exchangeCode('slack', {
      code: 'C',
      clientId: 'CID',
      clientSecret: 'SEC',
      redirectUri: 'https://c.example.com/api/admin/chat-bridge/oauth/slack/callback',
      fetchImpl,
    });
    expect(out).toEqual({ botToken: 'xoxb-tok', externalTeamId: 'T1', scopes: ['chat:write', 'commands'] });
  });

  it('throws on a Slack { ok: false } response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, error: 'invalid_code' }));
    await expect(
      exchangeCode('slack', {
        code: 'C',
        clientId: 'CID',
        clientSecret: 'SEC',
        redirectUri: 'https://c.example.com/cb',
        fetchImpl,
      }),
    ).rejects.toThrow(/invalid_code/);
  });

  it('parses a Discord token grant with guild', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 'disc-tok', guild: { id: 'G1' }, scope: 'bot applications.commands' }),
    );
    const out = await exchangeCode('discord', {
      code: 'C',
      clientId: 'DID',
      clientSecret: 'SEC',
      redirectUri: 'https://c.example.com/api/admin/chat-bridge/oauth/discord/callback',
      fetchImpl,
    });
    expect(out).toEqual({
      botToken: 'disc-tok',
      externalTeamId: 'G1',
      scopes: ['bot', 'applications.commands'],
    });
  });
});
```

**Step 2 — Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/chat/oauth-exchange.test.ts
```
Expected: FAIL — cannot find module `@/lib/chat/oauth-exchange`.

**Step 3 — Minimal impl.**

Create `src/lib/chat/oauth-exchange.ts`:

```ts
/**
 * v0.9.8 G6 (audit F) — exchange an OAuth authorization code for a bot token.
 *
 * Pure + fetch-injected (tests pass a stub). Returns the bot token plaintext,
 * the external team/guild id, and granted scopes. The caller seals the token
 * (oauth-token.ts) before persisting and never logs it.
 */

import type { ChatOauthPlatform } from '@/lib/chat/oauth-state';
import { PROVIDERS } from '@/lib/chat/oauth-providers';

type FetchLike = typeof fetch;

export type ExchangeInput = {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
};

export type ExchangeResult = {
  botToken: string;
  externalTeamId: string;
  scopes: string[];
};

function parseScopes(raw: unknown, delimiter: string): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw.split(delimiter).map((s) => s.trim()).filter(Boolean);
}

export async function exchangeCode(
  platform: ChatOauthPlatform,
  input: ExchangeInput,
): Promise<ExchangeResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const cfg = PROVIDERS[platform];
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
  });

  const res = await doFetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (platform === 'slack') {
    if (data.ok !== true) {
      throw new Error(`Slack token exchange failed: ${String(data.error ?? res.status)}`);
    }
    const team = data.team as { id?: string } | undefined;
    return {
      botToken: String(data.access_token ?? ''),
      externalTeamId: String(team?.id ?? ''),
      scopes: parseScopes(data.scope, ','),
    };
  }

  // Discord
  if (!res.ok || typeof data.access_token !== 'string') {
    throw new Error(`Discord token exchange failed: ${String(data.error ?? res.status)}`);
  }
  const guild = data.guild as { id?: string } | undefined;
  return {
    botToken: String(data.access_token),
    externalTeamId: String(guild?.id ?? ''),
    scopes: parseScopes(data.scope, ' '),
  };
}
```

**Step 4 — Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/chat/oauth-exchange.test.ts
```
Expected: PASS (3 tests).

**Step 5 — Commit.**

```sh
git add src/lib/chat/oauth-exchange.ts tests/lib/chat/oauth-exchange.test.ts && git commit -m "feat(chat): add OAuth code-exchange for Slack + Discord"
```

---

## Task 7 — Callback routes (exchange → seal → persist)

The callback verifies state, exchanges the code, seals the bot token, and upserts the install row. A shared `persistInstall` helper keeps both callbacks identical except for platform + env credentials.

**Step 1 — Write the failing test.**

Create `tests/api/chat-oauth-callback.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signOauthState } from '@/lib/chat/oauth-state';
import { openBotToken } from '@/lib/chat/oauth-token';
import * as schema from '@/db/schema';
import { getTestDb, resetDb, startPostgres, stopPostgres } from '../helpers/db';

vi.mock('@/lib/chat/oauth-exchange', () => ({
  exchangeCode: vi.fn(async () => ({
    botToken: 'xoxb-secret',
    externalTeamId: 'T-INSTALL',
    scopes: ['chat:write'],
  })),
}));

describe('GET chat-bridge oauth callback (slack)', () => {
  beforeAll(startPostgres);
  afterAll(stopPostgres);
  beforeEach(async () => {
    await resetDb();
    process.env.AUTH_SECRET = 'a'.repeat(40);
    process.env.CAIRN_SLACK_CLIENT_ID = 'CID';
    process.env.CAIRN_SLACK_CLIENT_SECRET = 'SEC';
  });

  it('verifies state, exchanges, seals the token and persists the install', async () => {
    const db = getTestDb();
    const [ws] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w-cb' }).returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'a@b.c', name: 'A', passwordHash: 'x' })
      .returning();
    vi.doMock('@/lib/url', () => ({ publicOrigin: vi.fn(async () => 'https://c.example.com') }));
    vi.doMock('@/lib/auth/require-role', async () => {
      const actual =
        await vi.importActual<typeof import('@/lib/auth/require-role')>('@/lib/auth/require-role');
      return {
        ...actual,
        requireRole: vi.fn(async () => ({ userId: user.id, workspaceId: ws.id, role: 'admin' })),
      };
    });
    const state = await signOauthState({ workspaceId: ws.id, platform: 'slack', nonce: 'n' });
    const { GET } = await import('@/app/api/admin/chat-bridge/oauth/slack/callback/route');
    const res = await GET(
      new Request(`https://c.example.com/api/admin/chat-bridge/oauth/slack/callback?code=C&state=${state}`),
    );
    expect(res.status).toBe(307);

    const [row] = await db
      .select()
      .from(schema.chatOauthInstalls)
      .where(eq(schema.chatOauthInstalls.workspaceId, ws.id));
    expect(row.externalTeamId).toBe('T-INSTALL');
    expect(openBotToken(row.botTokenEncrypted)).toBe('xoxb-secret');
    expect(row.scopes).toEqual(['chat:write']);
  });

  it('rejects a tampered/missing state with 400', async () => {
    const { GET } = await import('@/app/api/admin/chat-bridge/oauth/slack/callback/route');
    const res = await GET(
      new Request('https://c.example.com/api/admin/chat-bridge/oauth/slack/callback?code=C&state=bogus'),
    );
    expect(res.status).toBe(400);
  });
});
```

**Step 2 — Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/api/chat-oauth-callback.test.ts
```
Expected: FAIL — cannot find the callback route module / `oauth-install`.

**Step 3 — Minimal impl.**

Create `src/lib/chat/oauth-install.ts`:

```ts
/**
 * v0.9.8 G6 (audit F) — persist a completed chat OAuth install.
 *
 * Upserts on (workspace_id, platform, external_team_id): a re-install rotates
 * the sealed bot token + scopes and clears revoked_at. The plaintext token is
 * sealed here and never returned.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { sealBotToken } from '@/lib/chat/oauth-token';
import type { ChatOauthPlatform } from '@/lib/chat/oauth-state';

export async function persistInstall(
  db: Db,
  input: {
    workspaceId: string;
    installedBy: string;
    platform: ChatOauthPlatform;
    externalTeamId: string;
    botToken: string;
    scopes: string[];
  },
): Promise<void> {
  const botTokenEncrypted = sealBotToken(input.botToken);

  const [existing] = await db
    .select({ id: schema.chatOauthInstalls.id })
    .from(schema.chatOauthInstalls)
    .where(
      and(
        eq(schema.chatOauthInstalls.workspaceId, input.workspaceId),
        eq(schema.chatOauthInstalls.platform, input.platform),
        eq(schema.chatOauthInstalls.externalTeamId, input.externalTeamId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.chatOauthInstalls)
      .set({
        botTokenEncrypted,
        scopes: input.scopes,
        installedBy: input.installedBy,
        installedAt: new Date(),
        revokedAt: null,
      })
      .where(eq(schema.chatOauthInstalls.id, existing.id));
  } else {
    await db.insert(schema.chatOauthInstalls).values({
      workspaceId: input.workspaceId,
      platform: input.platform,
      externalTeamId: input.externalTeamId,
      botTokenEncrypted,
      scopes: input.scopes,
      installedBy: input.installedBy,
    });
  }

  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.installedBy,
    action: 'chat.oauth_installed',
    targetType: 'chat_oauth_install',
    metadata: {
      platform: input.platform,
      externalTeamId: input.externalTeamId,
      op: existing ? 'updated' : 'created',
      scopeCount: input.scopes.length, // NEVER the token.
    },
  });
}
```

Create `src/app/api/admin/chat-bridge/oauth/slack/callback/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { exchangeCode } from '@/lib/chat/oauth-exchange';
import { persistInstall } from '@/lib/chat/oauth-install';
import { oauthRedirectUri } from '@/lib/chat/oauth-providers';
import { verifyOauthState } from '@/lib/chat/oauth-state';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { publicOrigin } from '@/lib/url';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      return NextResponse.json({ error: 'missing code/state' }, { status: 400 });
    }
    let payload: Awaited<ReturnType<typeof verifyOauthState>>;
    try {
      payload = await verifyOauthState(state, 'slack');
    } catch {
      return NextResponse.json({ error: 'invalid state' }, { status: 400 });
    }
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== payload.workspaceId) {
      return NextResponse.json({ error: 'workspace mismatch' }, { status: 403 });
    }
    const clientId = process.env.CAIRN_SLACK_CLIENT_ID;
    const clientSecret = process.env.CAIRN_SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: 'Slack OAuth not configured' }, { status: 500 });
    }
    const origin = await publicOrigin();
    const redirectUri = await oauthRedirectUri(origin, 'slack');
    const result = await exchangeCode('slack', { code, clientId, clientSecret, redirectUri });
    await persistInstall(getDb(), {
      workspaceId: ctx.workspaceId,
      installedBy: ctx.userId,
      platform: 'slack',
      externalTeamId: result.externalTeamId,
      botToken: result.botToken,
      scopes: result.scopes,
    });
    return NextResponse.redirect(`${origin}/admin/chat-bridge?installed=slack`);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
```

Create `src/app/api/admin/chat-bridge/oauth/discord/callback/route.ts` — identical except `'discord'`, `CAIRN_DISCORD_CLIENT_ID/SECRET`, `verifyOauthState(state, 'discord')`, the redirect `?installed=discord`, and the not-configured message `'Discord OAuth not configured'`.

**Step 4 — Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/api/chat-oauth-callback.test.ts
```
Expected: PASS (2 tests).

**Step 5 — Commit.**

```sh
git add src/lib/chat/oauth-install.ts "src/app/api/admin/chat-bridge/oauth/slack/callback/route.ts" "src/app/api/admin/chat-bridge/oauth/discord/callback/route.ts" tests/api/chat-oauth-callback.test.ts && git commit -m "feat(chat): add Slack/Discord OAuth callbacks (exchange, seal, persist)"
```

---

## Task 8 — Extend secret-leak suite for OAuth bot tokens

The pino sink already redacts `botToken`/`bot_token`/`signingSecret`. The OAuth exchange surfaces an `access_token` shape — confirm that is also redacted, adding it to the redact list if not.

**Step 1 — Add the failing assertion.** Append to `tests/lib/chat/secret-leak.test.ts` inside `describe('chat-bridge secret redaction', ...)`:

```ts
  it('redacts OAuth access_token / accessToken anywhere in the payload', () => {
    const lines: string[] = [];
    const log = createTestLogger((line) => lines.push(line));
    log.info({
      exchange: { accessToken: 'xoxb-oauth-secret', externalTeamId: 'T1', platform: 'slack' },
      raw: { access_token: 'disc-oauth-secret' },
    });
    const all = lines.join('\n');
    expect(all).not.toContain('xoxb-oauth-secret');
    expect(all).not.toContain('disc-oauth-secret');
    expect(all).toContain('T1');
    expect(all).toContain('[Redacted]');
  });
```

**Step 2 — Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/chat/secret-leak.test.ts
```
Expected: FAIL — `access_token`/`accessToken` not redacted (the secrets appear in output).

**Step 3 — Minimal impl.** In `src/lib/observability/logger.ts`, find the pino `redact.paths` (or equivalent redact key list) that already contains `botToken`/`bot_token`/`signingSecret` and add `accessToken` and `access_token`. Use the existing wildcard convention (e.g. `'*.accessToken'`, `'*.access_token'`, plus top-level `'accessToken'`, `'access_token'`) matching how `botToken` is listed. Do not change the `[Redacted]` censor string.

**Step 4 — Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/lib/chat/secret-leak.test.ts
```
Expected: PASS (all tests in the file).

**Step 5 — Commit.**

```sh
git add tests/lib/chat/secret-leak.test.ts src/lib/observability/logger.ts && git commit -m "test(chat): redact OAuth access tokens in log sink"
```

---

## Task 9 — OAuth UI + i18n + remove "v0.10" copy

Add "Connect with OAuth" buttons (linking to the `/start` routes) above the existing manual-fallback panels, remove the "full OAuth install is coming in v0.10" sentence, and i18n the new copy.

**Step 1 — Add i18n keys (write first; i18n:check gates them).** Add to `messages/en.json`:

```json
  "chatOauth.heading": "Connect via OAuth",
  "chatOauth.description": "Install the Cairn bot directly with one click. Prefer manual setup? Paste a webhook URL and signing secret below instead.",
  "chatOauth.connectSlack": "Add to Slack",
  "chatOauth.connectDiscord": "Add to Discord",
  "chatOauth.installedSlack": "Slack connected via OAuth (team {team}).",
  "chatOauth.installedDiscord": "Discord connected via OAuth (server {team}).",
  "chatOauth.manualFallback": "Manual webhook setup",
```

Add to `messages/es.json`:

```json
  "chatOauth.heading": "Conectar mediante OAuth",
  "chatOauth.description": "Instala el bot de Cairn directamente con un clic. ¿Prefieres la configuración manual? Pega abajo una URL de webhook y un secreto de firma.",
  "chatOauth.connectSlack": "Añadir a Slack",
  "chatOauth.connectDiscord": "Añadir a Discord",
  "chatOauth.installedSlack": "Slack conectado mediante OAuth (equipo {team}).",
  "chatOauth.installedDiscord": "Discord conectado mediante OAuth (servidor {team}).",
  "chatOauth.manualFallback": "Configuración manual de webhook",
```

Add to `messages/ar.json`:

```json
  "chatOauth.heading": "الاتصال عبر OAuth",
  "chatOauth.description": "ثبّت روبوت Cairn مباشرةً بنقرة واحدة. تفضّل الإعداد اليدوي؟ الصق عنوان webhook وسر التوقيع أدناه بدلاً من ذلك.",
  "chatOauth.connectSlack": "إضافة إلى Slack",
  "chatOauth.connectDiscord": "إضافة إلى Discord",
  "chatOauth.installedSlack": "تم ربط Slack عبر OAuth (الفريق {team}).",
  "chatOauth.installedDiscord": "تم ربط Discord عبر OAuth (الخادم {team}).",
  "chatOauth.manualFallback": "إعداد webhook اليدوي",
```

**Step 2 — Write the failing component test.** Create `tests/components/chat-oauth-buttons.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';
import { ChatOauthButtons } from '@/app/(app)/admin/chat-bridge/chat-oauth-buttons';

function wrap(ui: React.ReactElement) {
  return render(
    <I18nProvider locale="en" messages={en}>
      {ui}
    </I18nProvider>,
  );
}

describe('ChatOauthButtons', () => {
  it('renders OAuth install links to the start routes', () => {
    wrap(
      <ChatOauthButtons
        slackOauthInstalled={false}
        slackTeam={null}
        discordOauthInstalled={false}
        discordTeam={null}
      />,
    );
    const slack = screen.getByRole('link', { name: 'Add to Slack' });
    const discord = screen.getByRole('link', { name: 'Add to Discord' });
    expect(slack.getAttribute('href')).toBe('/api/admin/chat-bridge/oauth/slack/start');
    expect(discord.getAttribute('href')).toBe('/api/admin/chat-bridge/oauth/discord/start');
  });

  it('shows the connected-team status when installed', () => {
    wrap(
      <ChatOauthButtons
        slackOauthInstalled={true}
        slackTeam="T42"
        discordOauthInstalled={false}
        discordTeam={null}
      />,
    );
    expect(screen.getByText('Slack connected via OAuth (team T42).')).toBeInTheDocument();
  });
});
```

**Step 3 — Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/components/chat-oauth-buttons.test.tsx
```
Expected: FAIL — cannot find module `@/app/(app)/admin/chat-bridge/chat-oauth-buttons`.

**Step 4 — Minimal impl.** Create `src/app/(app)/admin/chat-bridge/chat-oauth-buttons.tsx`:

```tsx
'use client';

import { useT } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';

export type ChatOauthButtonsProps = {
  slackOauthInstalled: boolean;
  slackTeam: string | null;
  discordOauthInstalled: boolean;
  discordTeam: string | null;
};

export function ChatOauthButtons(props: ChatOauthButtonsProps) {
  const t = useT();
  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-lg font-semibold">{t('chatOauth.heading')}</h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">{t('chatOauth.description')}</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <a href="/api/admin/chat-bridge/oauth/slack/start">{t('chatOauth.connectSlack')}</a>
        </Button>
        <Button asChild>
          <a href="/api/admin/chat-bridge/oauth/discord/start">{t('chatOauth.connectDiscord')}</a>
        </Button>
      </div>
      {props.slackOauthInstalled ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t('chatOauth.installedSlack', { team: props.slackTeam ?? '?' })}
        </p>
      ) : null}
      {props.discordOauthInstalled ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {t('chatOauth.installedDiscord', { team: props.discordTeam ?? '?' })}
        </p>
      ) : null}
    </section>
  );
}
```

**Step 5 — Wire into the page + remove the v0.10 copy.** In `src/app/(app)/admin/chat-bridge/page.tsx`:

- Add the import: `import { ChatOauthButtons } from './chat-oauth-buttons';` and `import { chatOauthInstalls } from '@/db/schema';` (already exported via `* as schema`).
- After the existing `hooks` query, fetch OAuth installs:

```ts
  const oauthRows = await getDb()
    .select({
      platform: schema.chatOauthInstalls.platform,
      externalTeamId: schema.chatOauthInstalls.externalTeamId,
      revokedAt: schema.chatOauthInstalls.revokedAt,
    })
    .from(schema.chatOauthInstalls)
    .where(eq(schema.chatOauthInstalls.workspaceId, ctx.workspaceId));
  const slackOauth = oauthRows.find((r) => r.platform === 'slack' && r.revokedAt === null) ?? null;
  const discordOauth =
    oauthRows.find((r) => r.platform === 'discord' && r.revokedAt === null) ?? null;
```

- Replace the `<p>` body in the header (lines 45-49) so the sentence ending `; full OAuth install is coming in v0.10.` becomes simply `Forward page + comment events to Slack or Discord, and let teammates reply in-thread to create Cairn comments.` (drop the trailing manual-only clause).
- Render `<ChatOauthButtons ... />` above `<ChatBridgeForm ... />`:

```tsx
      <ChatOauthButtons
        slackOauthInstalled={!!slackOauth}
        slackTeam={slackOauth?.externalTeamId ?? null}
        discordOauthInstalled={!!discordOauth}
        discordTeam={discordOauth?.externalTeamId ?? null}
      />
```

**Step 6 — Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/components/chat-oauth-buttons.test.tsx
```
Expected: PASS (2 tests).

**Step 7 — Commit.**

```sh
git add "src/app/(app)/admin/chat-bridge/chat-oauth-buttons.tsx" "src/app/(app)/admin/chat-bridge/page.tsx" messages/en.json messages/es.json messages/ar.json tests/components/chat-oauth-buttons.test.tsx && git commit -m "feat(chat): OAuth install UI + remove v0.10 placeholder copy"
```

---

## Task 10 — E2EE flag-ON round-trip verification test

Audit item E: no code change to crypto — prove the enroll → encrypt → decrypt → rekey path holds using the existing libs (`src/lib/e2e/crypto.ts`, `page-cipher.ts`, `enroll-client.ts`). Mock the server `fetch` for enroll/rekey; exercise real crypto.

**Step 1 — Write the test.** Create `tests/e2e-flag/encryption-roundtrip.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { generateUserKeypair, generateDek, unlockUserKeypair, unwrapDek, wrapDek } from '@/lib/e2e/crypto';
import { decryptPageContent, encryptPageContent } from '@/lib/e2e/page-cipher';
import { enrollKeypair, SEALED_KEY, type StoredSealed } from '@/lib/e2e/enroll-client';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('E2EE flag-ON end-to-end (env-gated path)', () => {
  it('enroll → persist sealed blob → unlock → encrypt page → decrypt page', async () => {
    const storage = new MemStorage();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { publicKey } = await enrollKeypair('correct horse battery staple', {
      fetch: fetchImpl as unknown as typeof fetch,
      storage,
    });
    expect(publicKey.length).toBeGreaterThan(0);

    const stored = JSON.parse(storage.getItem(SEALED_KEY) as string) as StoredSealed;
    const unlocked = await unlockUserKeypair(
      {
        publicKey: Buffer.from(stored.publicKey, 'base64'),
        encryptedPrivateKey: Buffer.from(stored.encryptedPrivateKey, 'base64'),
        kdfSalt: Buffer.from(stored.kdfSalt, 'base64'),
        kdfIters: stored.kdfIters,
      },
      'correct horse battery staple',
    );

    // Wrap a DEK for self, encrypt a page, then decrypt it back.
    const dek = generateDek();
    const wrapped = wrapDek(dek, unlocked.publicKey);
    const recovered = unwrapDek(wrapped, unlocked.privateKey);
    expect(recovered.equals(dek)).toBe(true);

    const doc = { type: 'doc', content: [{ type: 'paragraph', text: 'secret note' }] };
    const ct = encryptPageContent(doc, dek);
    expect(ct.toString('utf8')).not.toContain('secret note');
    expect(decryptPageContent(ct, dek)).toEqual(doc);
  });

  it('workspace rekey re-encrypts ciphertext under a new WSK and the old WSK can no longer read it', () => {
    const oldWsk = generateDek();
    const newWsk = generateDek();
    const doc = { type: 'doc', content: [] };
    const ctOld = encryptPageContent(doc, oldWsk);
    // Rekey step: decrypt with old, re-encrypt with new.
    const plain = decryptPageContent(ctOld, oldWsk);
    const ctNew = encryptPageContent(plain, newWsk);
    expect(decryptPageContent(ctNew, newWsk)).toEqual(doc);
    expect(() => decryptPageContent(ctNew, oldWsk)).toThrow();
  });
});
```

**Step 2 — Run to confirm GREEN immediately** (this is a verification test — the impl already exists; it must pass on first run with no code change):

```sh
source ~/.zshenv && pnpm vitest run tests/e2e-flag/encryption-roundtrip.test.ts
```
Expected: PASS (2 tests). If it FAILS, that surfaces a real E2EE regression — debug with `superpowers:systematic-debugging` before proceeding; do not weaken the test.

**Step 3 — Commit.**

```sh
git add tests/e2e-flag/encryption-roundtrip.test.ts && git commit -m "test(e2ee): verify flag-ON enroll/encrypt/decrypt/rekey round-trip"
```

---

## Task 11 — E2EE admin copy fix + i18n + admin docs

Replace the bare "disabled in this build" line (`settings/admin/encryption/page.tsx:54-57`) with copy that names the env var and explains how to enable, i18n it, and add an admin docs page.

**Step 1 — Add i18n keys.** Add to `messages/en.json`:

```json
  "e2ee.disabledTitle": "End-to-end encryption is turned off in this build.",
  "e2ee.disabledBody": "This deployment was built with CAIRN_ENABLE_E2E_ENCRYPTION=false (the safe default). To enable it, set CAIRN_ENABLE_E2E_ENCRYPTION=true and NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=true in your environment, then rebuild and redeploy. See the admin docs for the full procedure.",
  "e2ee.docsLink": "Read the encryption admin guide"
```

Add to `messages/es.json`:

```json
  "e2ee.disabledTitle": "El cifrado de extremo a extremo está desactivado en esta compilación.",
  "e2ee.disabledBody": "Esta instalación se compiló con CAIRN_ENABLE_E2E_ENCRYPTION=false (el valor predeterminado seguro). Para habilitarlo, establece CAIRN_ENABLE_E2E_ENCRYPTION=true y NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=true en tu entorno, luego recompila y vuelve a desplegar. Consulta la documentación de administración para el procedimiento completo.",
  "e2ee.docsLink": "Leer la guía de administración del cifrado"
```

Add to `messages/ar.json`:

```json
  "e2ee.disabledTitle": "التشفير من طرف إلى طرف معطّل في هذه النسخة.",
  "e2ee.disabledBody": "تم بناء هذا النشر باستخدام CAIRN_ENABLE_E2E_ENCRYPTION=false (الإعداد الافتراضي الآمن). لتفعيله، اضبط CAIRN_ENABLE_E2E_ENCRYPTION=true و NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=true في بيئتك، ثم أعد البناء وأعد النشر. راجع وثائق الإدارة للحصول على الإجراء الكامل.",
  "e2ee.docsLink": "اقرأ دليل إدارة التشفير"
```

**Step 2 — Write the failing component test.** Because the page is a Server Component, extract the disabled-state block into a small client component `EncryptionDisabledNotice` that uses `useT()`, and test that. Create `tests/components/encryption-page-copy.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';
import { EncryptionDisabledNotice } from '@/components/admin/encryption-disabled-notice';

describe('EncryptionDisabledNotice', () => {
  it('names the env var and links to the admin docs', () => {
    render(
      <I18nProvider locale="en" messages={en}>
        <EncryptionDisabledNotice />
      </I18nProvider>,
    );
    expect(screen.getByText(/CAIRN_ENABLE_E2E_ENCRYPTION=true/)).toBeInTheDocument();
    expect(
      screen.getByText('End-to-end encryption is turned off in this build.'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Read the encryption admin guide' });
    expect(link.getAttribute('href')).toContain('e2e-encryption');
  });
});
```

**Step 3 — Run to fail.**

```sh
source ~/.zshenv && pnpm vitest run tests/components/encryption-page-copy.test.tsx
```
Expected: FAIL — cannot find module `@/components/admin/encryption-disabled-notice`.

**Step 4 — Minimal impl.** Create `src/components/admin/encryption-disabled-notice.tsx`:

```tsx
'use client';

import { useT } from '@/lib/i18n/provider';

export function EncryptionDisabledNotice() {
  const t = useT();
  return (
    <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
      <p className="font-medium">{t('e2ee.disabledTitle')}</p>
      <p className="mt-2 text-muted-foreground">{t('e2ee.disabledBody')}</p>
      <a
        className="mt-2 inline-block underline underline-offset-4"
        href="https://github.com/jonathanmcohen/cairn/blob/main/docs/admin/e2e-encryption.md"
      >
        {t('e2ee.docsLink')}
      </a>
    </div>
  );
}
```

In `src/app/(app)/settings/admin/encryption/page.tsx`, replace the disabled-state `<p className="text-destructive ...">...</p>` (lines 54-57) with `<EncryptionDisabledNotice />` and add `import { EncryptionDisabledNotice } from '@/components/admin/encryption-disabled-notice';` at the top.

Create `docs/admin/e2e-encryption.md`:

```md
# End-to-end encryption (E2EE)

Cairn ships with end-to-end encryption **disabled by default** for safety:
enabling it changes how every page in a workspace is stored and is reversible
only by restoring from backup.

## Default

- `CAIRN_ENABLE_E2E_ENCRYPTION=false` (server guard)
- `NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=false` (build-time UI mirror)

With the flag off, the admin **Workspace encryption** page shows an explanation
instead of the toggle, and the per-page **Encrypt page** action is hidden.

## Enabling

1. Set BOTH env vars to `true`:
   ```
   CAIRN_ENABLE_E2E_ENCRYPTION=true
   NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=true
   ```
   The `NEXT_PUBLIC_` mirror is inlined at build time, so a **rebuild** (not just
   a restart) is required.
2. Redeploy from a freshly built image (`ghcr.io/jonathanmcohen/cairn:v0.9.8`).
3. Each member enrolls a keypair (Settings → Security → Encryption): a passphrase
   seals an X25519 private key client-side; the server only ever stores the
   sealed blob and the public key.
4. Admins can then turn on per-page encryption or flip the workspace to
   `workspace_wide` mode under Settings → Admin → Encryption.

## How it works (no plaintext on the server)

- Per-user X25519 keypair, private key sealed under a scrypt-derived KEK.
- Per-page DEK (AES-256-GCM) wrapped to each member's public key.
- Workspace-wide mode wraps a single workspace key (WSK) per member.
- **Rekey / member removal** mints a new WSK, re-wraps it for the remaining
  roster, and re-encrypts every page — the removed member's cached old key
  cannot read the new ciphertext.

## Caveats

- **Lockout risk:** a lost passphrase with no other enrolled device strands that
  member's access. Keep the workspace roster > 1 enrolled member.
- **Search:** encrypted page bodies are not full-text searchable server-side.
- This release does **not** change the default; encryption stays opt-in.
```

**Step 5 — Run to pass.**

```sh
source ~/.zshenv && pnpm vitest run tests/components/encryption-page-copy.test.tsx
```
Expected: PASS (1 test).

**Step 6 — Commit.**

```sh
git add src/components/admin/encryption-disabled-notice.tsx "src/app/(app)/settings/admin/encryption/page.tsx" docs/admin/e2e-encryption.md messages/en.json messages/es.json messages/ar.json tests/components/encryption-page-copy.test.tsx && git commit -m "docs(e2ee): explain CAIRN_ENABLE_E2E_ENCRYPTION + admin enable guide"
```

---

## Task 12 — Per-group gate

Run the full gate. Every command must pass before the release task.

**Step 1 — Lint (0 errors).**

```sh
source ~/.zshenv && pnpm lint
```
Expected: `Checked N files ... No fixes applied` / no errors. If Biome auto-reorders imports or converts type-only imports, run `source ~/.zshenv && pnpm exec biome check --write .`, then re-stage and amend the relevant task commit (or add a `style:` commit).

**Step 2 — Typecheck.**

```sh
source ~/.zshenv && pnpm typecheck
```
Expected: no output, exit 0.

**Step 3 — i18n check (no NEW missing keys).**

```sh
source ~/.zshenv && pnpm i18n:check
```
Expected: passes against the baseline — the new `chatOauth.*` and `e2ee.*` keys are present in all three locales, so no NEW missing key is reported.

**Step 4 — Group vitest.**

```sh
source ~/.zshenv && pnpm vitest run tests/db/chat-oauth-schema.test.ts tests/lib/chat/oauth-token.test.ts tests/lib/chat/oauth-state.test.ts tests/lib/chat/oauth-providers.test.ts tests/lib/chat/oauth-exchange.test.ts tests/lib/chat/secret-leak.test.ts tests/api/chat-oauth-start.test.ts tests/api/chat-oauth-callback.test.ts tests/components/chat-oauth-buttons.test.tsx tests/e2e-flag/encryption-roundtrip.test.ts tests/components/encryption-page-copy.test.tsx
```
Expected: all PASS. (Testcontainers files need Docker up.)

**Step 5 — Build (BUILD_EXIT=0).**

```sh
source ~/.zshenv && pnpm build; echo "BUILD_EXIT=$?"
```
Expected: `BUILD_EXIT=0`. The in-build TS phase is skipped (types are gated by Step 2, per the v0.9.7 fix).

**Step 6 — Commit (only if Biome rewrote anything in Step 1).**

```sh
git add -A && git commit -m "style: biome formatting for G6 chat-oauth + e2ee"
```
If nothing changed, skip this commit.

---

## Task 13 — Release: version bump + CHANGELOG + held PR

This task assumes G1–G6 are all merged onto `patches/v0.9.8`. Do NOT merge the PR — open it and hold for explicit user merge.

**Step 1 — Bump the version.** In `package.json`:

```json
  "version": "0.9.8",
```
(change from `"0.9.7"`).

**Step 2 — Add the CHANGELOG entry.** In `CHANGELOG.md`, insert a new section directly under `## [Unreleased]` and above `## [0.9.7] - 2026-05-31`:

```md
## [0.9.8] - 2026-06-01

Hotfix release reconciling the v0.9.7 production browser audit (items A–L).
**Operators must redeploy from `ghcr.io/jonathanmcohen/cairn:v0.9.8`** — several
audit findings (cover default, Admin tab, SSO route, E2EE banner, bibliography
badge) were artifacts of a stale running container; the source was already
correct on `main` and is now verified by tests.

### Audit reconciliation (already-correct on main; verified + improved)
- **Cover (C)** — confirmed default preset is `slate-dusk` (no orange); expanded
  curated palette; contrast warning now evaluates against the title-overlay color.
- **Admin tab (A)** — fixed the Admin parent-nav click; added the federated-search
  admin page and a dedicated user-management page.
- **SSO (B)** — moved SSO pages under `/settings/admin/sso/*` with redirects from
  the old `/admin/sso/*` paths (API routes unchanged).
- **E2EE (E)** — kept `CAIRN_ENABLE_E2E_ENCRYPTION` default-off; verified the
  flag-ON enroll → encrypt → decrypt → rekey path end-to-end; rewrote the admin
  banner to explain the env var; added an encryption admin guide.
- **Bibliography (D)** — added a live citation count to the bibliography toggle.

### New / built (F, G, H, I, J)
- **Chat OAuth (F)** — full Slack + Discord OAuth installers (migration 0060
  `chat_oauth_installs`): signed short-TTL CSRF state, SSRF-gated redirect URIs,
  bot tokens AES-256-GCM-sealed at rest and never logged. The manual
  webhook+secret path remains as a fallback. Removed the "coming in v0.10" copy.
- **Live refetch (G)** — `router.refresh()` on comment-add, favorites-reorder, and
  notification mark-read so server-rendered counts/badges/ordering stay consistent.
- **Orphan sweep (H)** — new `pages:purge-orphans` CLI (dry-run + soft-delete).
- **Collab resilience (I)** — exponential backoff + token re-fetch retry +
  dismissible offline banner; DNS-dependency ops note.
- **Workflow builder (J)** — AND/OR condition grouping (migration 0058), drag-
  reorder actions (migration 0059), searchable templates gallery, and a run-history
  sub-tab (migration 0061).

### Migrations
- 0058 workflow condition tree · 0059 action ordering · 0060 chat OAuth installs
  · 0061 automation run history.
```

**Step 3 — Commit.**

```sh
git add package.json CHANGELOG.md && git commit -m "chore(release): v0.9.8"
```

**Step 4 — Open the held PR (do NOT merge).**

```sh
source ~/.zshenv && gh pr create --base main --head patches/v0.9.8 --title "v0.9.8 — audit reconciliation + chat OAuth, collab resilience, orphan sweep, workflow builder" --body "$(cat <<'EOF'
Resolves the v0.9.7 production browser audit (items A–L) in a single hotfix.

## Verification + reconciliation (source already correct on main)
- C cover default `slate-dusk`, expanded palette, title-color contrast warning
- A Admin parent nav + federated-search + user-management pages
- B SSO moved to `/settings/admin/sso/*` with redirects
- E E2EE flag-ON path verified end-to-end; banner copy + admin guide
- D bibliography live citation count

## New build
- F Slack + Discord OAuth installers (migration 0060), encrypted-at-rest bot
  tokens, SSRF-gated redirects, manual fallback preserved
- G live `router.refresh()` on comment-add / favorites-reorder / mark-read
- H `pages:purge-orphans` CLI
- I collab exponential backoff + offline banner
- J workflow AND/OR grouping (0058) + action ordering (0059) + run history (0061)

## Operator action required
Redeploy from `ghcr.io/jonathanmcohen/cairn:v0.9.8` after merge — several audit
findings were stale-container artifacts, not source bugs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**HOLD:** Report the PR URL and stop. Do not merge. The user merges explicitly.

---

## Per-task summary

| # | Title | Key files |
|---|-------|-----------|
| 1 | Migration 0060 + `chat_oauth_installs` table | `drizzle/migrations/0060_*.sql`, `src/db/schema/chat-oauth.ts` |
| 2 | Bot-token sealing helper | `src/lib/chat/oauth-token.ts` |
| 3 | OAuth CSRF state | `src/lib/chat/oauth-state.ts` |
| 4 | Provider config + redirect-URI builder | `src/lib/chat/oauth-providers.ts` |
| 5 | Install-start routes | `.../oauth/{slack,discord}/start/route.ts` |
| 6 | Token-exchange lib | `src/lib/chat/oauth-exchange.ts` |
| 7 | Callback routes + persist helper | `.../oauth/{slack,discord}/callback/route.ts`, `src/lib/chat/oauth-install.ts` |
| 8 | Secret-leak suite extension | `tests/lib/chat/secret-leak.test.ts`, `src/lib/observability/logger.ts` |
| 9 | OAuth UI + i18n + remove v0.10 copy | `chat-oauth-buttons.tsx`, `chat-bridge/page.tsx`, `messages/*` |
| 10 | E2EE flag-ON round-trip test | `tests/e2e-flag/encryption-roundtrip.test.ts` |
| 11 | E2EE copy fix + i18n + docs | `encryption-disabled-notice.tsx`, `encryption/page.tsx`, `docs/admin/e2e-encryption.md` |
| 12 | Per-group gate | (lint/typecheck/i18n/vitest/build) |
| 13 | Release: version + CHANGELOG + held PR | `package.json`, `CHANGELOG.md` |
