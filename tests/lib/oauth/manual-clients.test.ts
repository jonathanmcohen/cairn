/**
 * Post-v0.10.0 — manual OAuth client provisioning
 * (src/lib/oauth/admin-clients.ts: createManualClient + rotateClientSecret).
 *
 * Pins the security contract: the plaintext `cairn_ocs_` secret is returned
 * exactly once while ONLY the sha256-hex hash lands in oauth_clients;
 * validation rejects bad names / redirect URIs with typed results (no row
 * inserted); rotation replaces the hash in place so the OLD secret stops
 * verifying immediately; and a public (PKCE-only) client can never be rotated
 * into having a secret. Route-level enforcement (role gate, 201/400/404
 * mapping, audit rows) is e2e-covered in
 * tests/e2e/oauth-manual-clients.spec.ts.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  createManualClient,
  MANUAL_CLIENT_MAX_REDIRECT_URIS,
  MANUAL_CLIENT_NAME_MAX,
  rotateClientSecret,
} from '@/lib/oauth/admin-clients';
import { hashOauthToken, OAUTH_PREFIX, verifyOauthToken } from '@/lib/oauth/tokens';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const REDIRECT = 'http://192.168.1.50:33418/callback';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.AUTH_SECRET = 'z'.repeat(32);
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE oauth_clients, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function clientCount(): Promise<number> {
  const rows = await db.select({ id: schema.oauthClients.id }).from(schema.oauthClients);
  return rows.length;
}

describe('createManualClient', () => {
  it('confidential: mints a cairn_ocs_ secret once and stores ONLY the sha256 hash', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const result = await createManualClient(db, {
      clientName: 'LAN MCP client',
      redirectUris: [REDIRECT, 'https://lan.example/cb'],
      confidential: true,
      createdBy: u.userId,
    });
    if ('kind' in result) throw new Error(`unexpected validation error: ${result.kind}`);

    expect(result.clientSecret).toMatch(/^cairn_ocs_/);
    expect(result.row.clientId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.row.clientName).toBe('LAN MCP client');
    expect(result.row.redirectUris).toEqual([REDIRECT, 'https://lan.example/cb']);
    expect(result.row.createdBy).toBe(u.userId);
    // Hash at rest, never the plaintext.
    expect(result.row.clientSecretHash).toBe(hashOauthToken(result.clientSecret as string));
    expect(result.row.clientSecretHash).not.toContain(OAUTH_PREFIX.clientSecret);

    const [stored] = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.id, result.row.id));
    expect(stored?.clientSecretHash).toBe(result.row.clientSecretHash);
  });

  it('public: no secret minted, hash stays null', async () => {
    const result = await createManualClient(db, {
      clientName: 'Public PKCE client',
      redirectUris: [REDIRECT],
      confidential: false,
    });
    if ('kind' in result) throw new Error(`unexpected validation error: ${result.kind}`);
    expect(result.clientSecret).toBeNull();
    expect(result.row.clientSecretHash).toBeNull();
    expect(result.row.createdBy).toBeNull();
  });

  it('trims the client name', async () => {
    const result = await createManualClient(db, {
      clientName: '  padded  ',
      redirectUris: [REDIRECT],
      confidential: false,
    });
    if ('kind' in result) throw new Error(`unexpected validation error: ${result.kind}`);
    expect(result.row.clientName).toBe('padded');
  });

  it('rejects an empty / whitespace-only / over-long name (no row inserted)', async () => {
    for (const clientName of ['', '   ', 'x'.repeat(MANUAL_CLIENT_NAME_MAX + 1)]) {
      const result = await createManualClient(db, {
        clientName,
        redirectUris: [REDIRECT],
        confidential: true,
      });
      expect(result).toMatchObject({ kind: 'invalid_client_name' });
    }
    expect(await clientCount()).toBe(0);
  });

  it('rejects 0 and >10 redirect URIs (no row inserted)', async () => {
    const tooMany = Array.from(
      { length: MANUAL_CLIENT_MAX_REDIRECT_URIS + 1 },
      (_, i) => `https://example.com/cb${i}`,
    );
    for (const redirectUris of [[], tooMany]) {
      const result = await createManualClient(db, {
        clientName: 'ok',
        redirectUris,
        confidential: true,
      });
      expect(result).toMatchObject({ kind: 'invalid_redirect_uris' });
    }
    expect(await clientCount()).toBe(0);
  });

  it('rejects non-absolute and non-http(s) redirect URIs (same guard as RFC 7591 registration)', async () => {
    for (const bad of [
      'not-a-url',
      '/relative/path',
      'ftp://example.com/cb',
      'javascript:alert(1)',
    ]) {
      const result = await createManualClient(db, {
        clientName: 'ok',
        redirectUris: [REDIRECT, bad],
        confidential: true,
      });
      expect(result).toMatchObject({ kind: 'invalid_redirect_uris' });
    }
    expect(await clientCount()).toBe(0);
  });

  it('accepts exactly the boundary: 100-char name, 10 URIs', async () => {
    const result = await createManualClient(db, {
      clientName: 'x'.repeat(MANUAL_CLIENT_NAME_MAX),
      redirectUris: Array.from(
        { length: MANUAL_CLIENT_MAX_REDIRECT_URIS },
        (_, i) => `https://example.com/cb${i}`,
      ),
      confidential: false,
    });
    expect('kind' in result).toBe(false);
  });
});

describe('rotateClientSecret', () => {
  it('mints a new secret; the OLD secret no longer verifies against the stored hash', async () => {
    const created = await createManualClient(db, {
      clientName: 'rotate-me',
      redirectUris: [REDIRECT],
      confidential: true,
    });
    if ('kind' in created) throw new Error('setup failed');
    const oldSecret = created.clientSecret as string;
    const oldHash = created.row.clientSecretHash as string;

    const rotated = await rotateClientSecret(db, created.row.clientId);
    expect(rotated.kind).toBe('rotated');
    if (rotated.kind !== 'rotated') throw new Error('unreachable');

    expect(rotated.clientSecret).toMatch(/^cairn_ocs_/);
    expect(rotated.clientSecret).not.toBe(oldSecret);
    expect(rotated.row.clientSecretHash).not.toBe(oldHash);

    const [stored] = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.id, created.row.id));
    const newHash = stored?.clientSecretHash as string;
    // The exact invalidation the token endpoint enforces: old plaintext fails
    // the constant-time compare, the new one passes.
    expect(verifyOauthToken(oldSecret, newHash)).toBe(false);
    expect(verifyOauthToken(rotated.clientSecret, newHash)).toBe(true);
  });

  it('rejects rotating a PUBLIC client with a typed result (hash stays null)', async () => {
    const created = await createManualClient(db, {
      clientName: 'public-no-rotate',
      redirectUris: [REDIRECT],
      confidential: false,
    });
    if ('kind' in created) throw new Error('setup failed');

    const rotated = await rotateClientSecret(db, created.row.clientId);
    expect(rotated).toEqual({ kind: 'public_client' });

    const [stored] = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.id, created.row.id));
    expect(stored?.clientSecretHash).toBeNull();
  });

  it('answers not_found for an unknown client_id', async () => {
    expect(await rotateClientSecret(db, 'f'.repeat(32))).toEqual({ kind: 'not_found' });
  });
});
