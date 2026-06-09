/**
 * Plan F (MCP OAuth) — RFC 7591 dynamic client registration.
 *
 * NOTE (deviation from plan prose): dynamic registration is unauthenticated and
 * happens BEFORE any user/workspace is chosen, but `audit_log.workspace_id` is
 * NOT NULL. So registration does NOT write an audit row — the meaningful,
 * workspace-bound security events (oauth.consent_granted / token_issued /
 * token_revoked) are audited in their own tasks. The client_secret is still
 * stored hashed and never re-fetchable.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { hashOauthToken } from '@/lib/oauth/tokens';
import { startPostgres, stopPostgres } from '../../helpers/db';

vi.mock('@/db/client', () => ({ getDb: () => db }));

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

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
  await sql`TRUNCATE oauth_clients RESTART IDENTITY CASCADE`;
});

async function register(body: unknown): Promise<Response> {
  const { POST } = await import('@/app/api/oauth/register/route');
  return POST(
    new Request('http://localhost/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('Plan F — dynamic client registration', () => {
  it('POST with redirect_uris → 201 issues client_id (public client, no secret)', async () => {
    const res = await register({
      client_name: 'Claude Desktop',
      redirect_uris: ['http://localhost:33418/callback'],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.client_id).toBe('string');
    expect(body.client_secret).toBeUndefined();
    expect(body.redirect_uris).toEqual(['http://localhost:33418/callback']);

    const rows = await db.select().from(schema.oauthClients);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clientSecretHash).toBeNull();
    expect(rows[0]?.clientName).toBe('Claude Desktop');
  });

  it('confidential client (token_endpoint_auth_method=client_secret_post) gets a hashed secret', async () => {
    const res = await register({
      client_name: 'Server App',
      redirect_uris: ['https://app.example.com/cb'],
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const secret = body.client_secret as string;
    expect(typeof secret).toBe('string');
    expect(secret.startsWith('cairn_ocs_')).toBe(true);

    // Stored hashed, never echoed back in plaintext on a re-read of the row.
    const rows = await db.select().from(schema.oauthClients);
    expect(rows[0]?.clientSecretHash).toBe(hashOauthToken(secret));
    expect(rows[0]?.clientSecretHash).not.toBe(secret);
  });

  it('rejects registration with no redirect_uris → 400 invalid_redirect_uri', async () => {
    const res = await register({ client_name: 'X', redirect_uris: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_redirect_uri');
  });

  it('rejects a non-http(s) redirect scheme → 400 invalid_redirect_uri', async () => {
    const res = await register({
      client_name: 'X',
      redirect_uris: ['javascript:alert(1)'],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_redirect_uri');
  });
});
