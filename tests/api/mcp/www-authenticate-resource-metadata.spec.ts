/**
 * Plan F (MCP OAuth) — unauthenticated /api/mcp advertises OAuth via
 * WWW-Authenticate, and a valid OAuth access token reaches MCP tools (with PAT
 * backward-compat). See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
import { resetMcpRateLimit } from '@/lib/mcp/dispatcher';
import { hashOauthToken, mintOauthSecret, OAUTH_PREFIX } from '@/lib/oauth/tokens';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

vi.mock('@/db/client', () => ({ getDb: () => db }));
vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve(
      new Headers({ 'x-forwarded-host': 'cairn.example.com', 'x-forwarded-proto': 'https' }),
    ),
}));

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(32);
  // Force publicOrigin() to resolve via the forwarded-host header (not the
  // localhost build-defaults from .env).
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  delete process.env.PUBLIC_URL;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE oauth_tokens, oauth_authorization_codes, oauth_clients, token_usage_log, personal_access_tokens, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  resetMcpRateLimit();
});

async function seedOauthToken(scopes: string[]): Promise<string> {
  const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
  const token = mintOauthSecret(OAUTH_PREFIX.accessToken);
  await db.insert(schema.oauthTokens).values({
    accessTokenHash: hashOauthToken(token),
    refreshTokenHash: hashOauthToken(mintOauthSecret(OAUTH_PREFIX.refreshToken)),
    clientId: 'client-abc',
    userId: u.userId,
    workspaceId: u.workspaceId,
    scopes,
    accessExpiresAt: new Date(Date.now() + 3_600_000),
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
  return token;
}

async function postMcp(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const { POST } = await import('@/app/api/mcp/route');
  return POST(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe('Plan F — MCP WWW-Authenticate', () => {
  it('no Authorization → 401 with WWW-Authenticate pointing at protected-resource metadata', async () => {
    const res = await postMcp({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.status).toBe(401);
    const www = res.headers.get('WWW-Authenticate') ?? '';
    expect(www).toContain('Bearer');
    expect(www).toContain(
      'resource_metadata="https://cairn.example.com/.well-known/oauth-protected-resource"',
    );
    // body still the existing shape
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('a valid OAuth access token with mcp:read reaches MCP tools (tools/list)', async () => {
    const token = await seedOauthToken(['mcp:read', 'pages:read']);
    const res = await postMcp(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    // OAuth grants gate by scope alone (no per-tool allowlist) — read tools visible.
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain('pages.read');
  });

  it('an OAuth token without any mcp:* scope → 403', async () => {
    const token = await seedOauthToken(['pages:read']);
    const res = await postMcp(
      { jsonrpc: '2.0', id: 3, method: 'ping' },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(403);
  });

  it('regression: a PAT with mcp:read still works (backward compat)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'pat-mcp',
      scopes: ['mcp:read', 'pages:read'],
      mcpTools: ['pages.read'],
      expiresAt: null,
    });
    const res = await postMcp(
      { jsonrpc: '2.0', id: 4, method: 'ping' },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: Record<string, unknown> };
    expect(body.result).toEqual({});
  });
});
