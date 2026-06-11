/**
 * v0.10.0 D3 — admin OAuth client registry.
 *
 * Covers the lib (`src/lib/oauth/admin-clients.ts`: grant-count listing +
 * delete-with-cascade-revoke) and the thin admin routes
 * (GET /api/admin/oauth-clients, DELETE /api/admin/oauth-clients/[id])
 * including the admin/owner role gate. Real tokens are minted through the
 * actual PKCE exchange so the cascade-revoke assertion runs against rows the
 * production path created.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { deleteRegisteredClient, listRegisteredClients } from '@/lib/oauth/admin-clients';
import { registerClient } from '@/lib/oauth/clients';
import { issueAuthCode } from '@/lib/oauth/codes';
import { codeToTokens, type IssuedTokens } from '@/lib/oauth/exchange';
import { verifyOauthAccessToken } from '@/lib/oauth/tokens';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let activeCookie: { name: string; value: string } | undefined;

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => activeCookie,
    set: () => {},
    delete: () => {},
  }),
}));

vi.mock('@/db/client', () => ({ getDb: () => db }));

async function actAs(userId: string, workspaceId: string): Promise<void> {
  const a = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  a.__set({ userId });
  activeCookie = { name: 'cairn_ws', value: workspaceId };
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const REDIRECT = 'http://localhost:33418/callback';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(32);
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE oauth_tokens, oauth_authorization_codes, oauth_clients, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  activeCookie = undefined;
});

/** Mint a real token pair for `client` via the production PKCE exchange. */
async function issueTokensFor(
  client: schema.OauthClient,
  user: { userId: string; workspaceId: string },
): Promise<IssuedTokens> {
  const { code } = await issueAuthCode(db, {
    clientId: client.clientId,
    clientName: client.clientName,
    userId: user.userId,
    workspaceId: user.workspaceId,
    scopes: ['mcp:read', 'pages:read'],
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
  });
  const tokens = await codeToTokens(db, {
    code,
    redirectUri: REDIRECT,
    clientId: client.clientId,
    codeVerifier: VERIFIER,
  });
  if ('kind' in tokens) throw new Error('exchange failed');
  return tokens;
}

describe('listRegisteredClients', () => {
  it('returns every client with confidential flag + active/total grant counts', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const { row: pub } = await registerClient(db, {
      clientName: 'Cursor',
      redirectUris: [REDIRECT],
      confidential: false,
    });
    const { row: conf } = await registerClient(db, {
      clientName: 'Server App',
      redirectUris: ['https://server.example/cb'],
      confidential: true,
    });

    // Two grants for the public client; revoke one (refresh rotation also
    // counts: a rotated-away row stays as a revoked total).
    const first = await issueTokensFor(pub, u);
    await issueTokensFor(pub, u);
    await db
      .update(schema.oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.oauthTokens.id, first.row.id));

    const clients = await listRegisteredClients(db);
    expect(clients).toHaveLength(2);

    const pubSummary = clients.find((c) => c.clientId === pub.clientId);
    const confSummary = clients.find((c) => c.clientId === conf.clientId);
    expect(pubSummary).toMatchObject({
      name: 'Cursor',
      confidential: false,
      activeGrants: 1,
      totalGrants: 2,
      redirectUris: [REDIRECT],
    });
    expect(confSummary).toMatchObject({
      name: 'Server App',
      confidential: true,
      activeGrants: 0,
      totalGrants: 0,
    });
  });
});

describe('deleteRegisteredClient', () => {
  it('revokes every active token, deletes the client row, writes oauth.client_deleted', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const { row: client } = await registerClient(db, {
      clientName: 'Cursor',
      redirectUris: [REDIRECT],
      confidential: false,
    });
    const a = await issueTokensFor(client, u);
    const b = await issueTokensFor(client, u);

    const result = await deleteRegisteredClient(db, {
      id: client.id,
      actorUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    expect(result).toMatchObject({
      clientId: client.clientId,
      name: 'Cursor',
      revokedGrants: 2,
    });

    // Client row is gone; both token rows remain but are soft-revoked.
    const remaining = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.id, client.id));
    expect(remaining).toHaveLength(0);
    for (const tokens of [a, b]) {
      const [row] = await db
        .select()
        .from(schema.oauthTokens)
        .where(eq(schema.oauthTokens.id, tokens.row.id));
      expect(row?.revokedAt).not.toBeNull();
    }

    // The revoked access token no longer resolves — the cascade plugs straight
    // into verifyOauthAccessToken's isNull(revoked_at) guard.
    expect(await verifyOauthAccessToken(db, a.accessToken)).toBeNull();

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'oauth.client_deleted'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.targetType).toBe('oauth_client');
    expect(audits[0]?.targetId).toBe(client.id);
    expect(audits[0]?.metadata).toMatchObject({
      clientId: client.clientId,
      name: 'Cursor',
      revokedGrants: 2,
    });
  });

  it('counts only newly-revoked grants (already-revoked rows are untouched)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const { row: client } = await registerClient(db, {
      clientName: 'Cursor',
      redirectUris: [REDIRECT],
      confidential: false,
    });
    const first = await issueTokensFor(client, u);
    await issueTokensFor(client, u);
    const earlier = new Date(Date.now() - 60_000);
    await db
      .update(schema.oauthTokens)
      .set({ revokedAt: earlier })
      .where(eq(schema.oauthTokens.id, first.row.id));

    const result = await deleteRegisteredClient(db, {
      id: client.id,
      actorUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    expect(result?.revokedGrants).toBe(1);

    // The pre-revoked row keeps its original revoked_at stamp.
    const [row] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.id, first.row.id));
    expect(row?.revokedAt?.getTime()).toBe(earlier.getTime());
  });

  it('returns null for an unknown id (no audit row)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const result = await deleteRegisteredClient(db, {
      id: '00000000-0000-4000-8000-000000000000',
      actorUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    expect(result).toBeNull();
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'oauth.client_deleted'));
    expect(audits).toHaveLength(0);
  });
});

describe('GET /api/admin/oauth-clients', () => {
  it('lists clients for an admin and never exposes the secret hash', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await registerClient(db, {
      clientName: 'Claude Desktop',
      redirectUris: [REDIRECT],
      confidential: true,
    });
    await actAs(admin.userId, admin.workspaceId);
    const { GET } = await import('@/app/api/admin/oauth-clients/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clients: Array<Record<string, unknown>> };
    expect(body.clients).toHaveLength(1);
    expect(body.clients[0]).toMatchObject({ name: 'Claude Desktop', confidential: true });
    expect(JSON.stringify(body)).not.toContain('clientSecretHash');
    expect(JSON.stringify(body)).not.toContain('client_secret_hash');
  });

  it('answers 403 for an editor', async () => {
    const editor = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(editor.userId, editor.workspaceId);
    const { GET } = await import('@/app/api/admin/oauth-clients/route');
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/oauth-clients/[id]', () => {
  function call(id: string): Promise<Response> {
    return import('@/app/api/admin/oauth-clients/[id]/route').then(({ DELETE }) =>
      DELETE(new Request(`http://localhost/api/admin/oauth-clients/${id}`, { method: 'DELETE' }), {
        params: Promise.resolve({ id }),
      }),
    );
  }

  it('deletes the client + revokes its tokens for an admin', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const { row: client } = await registerClient(db, {
      clientName: 'Cursor',
      redirectUris: [REDIRECT],
      confidential: false,
    });
    const tokens = await issueTokensFor(client, admin);

    await actAs(admin.userId, admin.workspaceId);
    const res = await call(client.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, revokedGrants: 1 });

    const remaining = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.id, client.id));
    expect(remaining).toHaveLength(0);
    const [tokenRow] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.id, tokens.row.id));
    expect(tokenRow?.revokedAt).not.toBeNull();
  });

  it('answers 403 for an editor (client untouched)', async () => {
    const editor = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { row: client } = await registerClient(db, {
      clientName: 'Cursor',
      redirectUris: [REDIRECT],
      confidential: false,
    });

    await actAs(editor.userId, editor.workspaceId);
    const res = await call(client.id);
    expect(res.status).toBe(403);
    const remaining = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.id, client.id));
    expect(remaining).toHaveLength(1);
  });

  it('answers 404 for an unknown uuid and for a non-uuid id', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(admin.userId, admin.workspaceId);
    expect((await call('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await call('not-a-uuid')).status).toBe(404);
  });
});
