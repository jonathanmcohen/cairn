/**
 * Plan F (MCP OAuth) — /authorize endpoint + consent screen + PKCE-required.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { registerClient } from '@/lib/oauth/clients';
import { hashOauthToken } from '@/lib/oauth/tokens';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

vi.mock('@/db/client', () => ({ getDb: () => db }));
vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(c: { userId: string } | null): Promise<void> {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(c);
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const REDIRECT = 'http://localhost:33418/callback';
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
  await sql`TRUNCATE oauth_authorization_codes, oauth_clients, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await setUser(null);
});

async function seedClient(redirectUris = [REDIRECT]): Promise<string> {
  const { row } = await registerClient(db, {
    clientName: 'Cursor',
    redirectUris,
    confidential: false,
  });
  return row.clientId;
}

function authorizeUrl(clientId: string, overrides: Record<string, string> = {}): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    scope: 'mcp:read',
    state: 'xyz',
    ...overrides,
  });
  return `http://localhost/api/oauth/authorize?${p.toString()}`;
}

async function getAuthorize(url: string): Promise<Response> {
  const { GET } = await import('@/app/api/oauth/authorize/route');
  return GET(new Request(url));
}

async function postConsent(fields: Record<string, string>): Promise<Response> {
  const { POST } = await import('@/app/api/oauth/authorize/route');
  const body = new URLSearchParams(fields);
  return POST(
    new Request('http://localhost/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }),
  );
}

describe('Plan F — authorize + consent', () => {
  it('unauthenticated GET → 302 to /login with the authorize URL as returnTo', async () => {
    const clientId = await seedClient();
    const res = await getAuthorize(authorizeUrl(clientId));
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/login');
    expect(loc).toContain('returnTo=');
    expect(decodeURIComponent(loc)).toContain('/api/oauth/authorize');
  });

  it('authenticated GET renders the consent screen with client name, scopes, workspace', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor', workspaceName: 'Homelab' });
    const clientId = await seedClient();
    await setUser({ userId: u.userId });

    const res = await getAuthorize(authorizeUrl(clientId));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Cursor');
    expect(html).toContain('Homelab');
    // mcp:read preset expands to read scopes; friendly label present.
    expect(html).toContain('Use read-only MCP tools');
    expect(html).toContain('value="allow"');
    expect(html).toContain('value="deny"');
  });

  it('rejects an unknown client_id → 400 invalid_client', async () => {
    const res = await getAuthorize(authorizeUrl('deadbeef'.repeat(4)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_client');
  });

  it('rejects a redirect_uri not in the allowlist (no redirect to the bad URI) → 400', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const clientId = await seedClient();
    await setUser({ userId: u.userId });
    const res = await getAuthorize(
      authorizeUrl(clientId, { redirect_uri: 'http://evil.example.com/steal' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_redirect_uri');
    expect(res.headers.get('location')).toBeNull();
  });

  it('rejects a missing code_challenge → 400 invalid_request (PKCE required)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const clientId = await seedClient();
    await setUser({ userId: u.userId });
    const url = authorizeUrl(clientId);
    const u2 = new URL(url);
    u2.searchParams.delete('code_challenge');
    const res = await getAuthorize(u2.toString());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('rejects code_challenge_method=plain → 400 invalid_request (only S256)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const clientId = await seedClient();
    await setUser({ userId: u.userId });
    const res = await getAuthorize(authorizeUrl(clientId, { code_challenge_method: 'plain' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('Allow issues a one-shot code bound to user+workspace+scopes+redirect+challenge', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const clientId = await seedClient();
    await setUser({ userId: u.userId });

    const res = await postConsent({
      decision: 'allow',
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      scope: 'mcp:read',
      state: 'xyz',
    });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location') ?? '');
    const code = loc.searchParams.get('code');
    expect(code).toBeTruthy();
    expect(code?.startsWith('cairn_oac_')).toBe(true);
    expect(loc.searchParams.get('state')).toBe('xyz');

    const rows = await db
      .select()
      .from(schema.oauthAuthorizationCodes)
      .where(eq(schema.oauthAuthorizationCodes.clientId, clientId));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.codeHash).toBe(hashOauthToken(code ?? ''));
    expect(row?.userId).toBe(u.userId);
    expect(row?.workspaceId).toBe(u.workspaceId);
    expect(row?.redirectUri).toBe(REDIRECT);
    expect(row?.codeChallenge).toBe(CHALLENGE);
    expect(row?.consumedAt).toBeNull();
    expect(row?.scopes).toContain('mcp:read');

    // audit oauth.consent_granted written
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'oauth.consent_granted'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.workspaceId).toBe(u.workspaceId);
  });

  it('scope is intersected with role at consent: a viewer cannot grant pages:write', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'viewer' });
    const clientId = await seedClient();
    await setUser({ userId: u.userId });

    const res = await postConsent({
      decision: 'allow',
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      scope: 'pages:read pages:write',
      state: 's',
    });
    expect(res.status).toBe(302);
    const rows = await db.select().from(schema.oauthAuthorizationCodes);
    expect(rows[0]?.scopes).toContain('pages:read');
    expect(rows[0]?.scopes).not.toContain('pages:write');
  });

  it('Cancel → 302 access_denied to the client redirect_uri', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const clientId = await seedClient();
    await setUser({ userId: u.userId });

    const res = await postConsent({
      decision: 'deny',
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      scope: 'mcp:read',
      state: 'zzz',
    });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe('zzz');
    expect(loc.searchParams.get('code')).toBeNull();

    const rows = await db.select().from(schema.oauthAuthorizationCodes);
    expect(rows).toHaveLength(0);
  });
});
