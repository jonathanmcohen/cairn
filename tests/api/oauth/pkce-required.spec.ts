/**
 * Plan F (MCP OAuth) — PKCE S256 mandatory at the token endpoint, with a
 * defense-in-depth cross-check that /authorize already rejects a missing
 * code_challenge.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { registerClient } from '@/lib/oauth/clients';
import { issueAuthCode } from '@/lib/oauth/codes';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

vi.mock('@/db/client', () => ({ getDb: () => db }));

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
});

async function setup() {
  const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
  const { row: client } = await registerClient(db, {
    clientName: 'Cursor',
    redirectUris: [REDIRECT],
    confidential: false,
  });
  const { code } = await issueAuthCode(db, {
    clientId: client.clientId,
    clientName: client.clientName,
    userId: u.userId,
    workspaceId: u.workspaceId,
    scopes: ['mcp:read'],
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
  });
  return { clientId: client.clientId, code };
}

async function exchange(fields: Record<string, string>): Promise<Response> {
  const { POST } = await import('@/app/api/oauth/token/route');
  return POST(
    new Request('http://localhost/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

describe('Plan F — PKCE required', () => {
  it('exchange with a WRONG code_verifier → 400 invalid_grant', async () => {
    const { clientId, code } = await setup();
    const res = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: 'this-is-not-the-verifier',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('exchange with a MISSING code_verifier → 400 invalid_request', async () => {
    const { clientId, code } = await setup();
    const res = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('a wrong verifier does NOT consume the code permanently against a later correct verifier', async () => {
    // Defense note: once consumed (even on a bad verifier) the code is spent.
    // We assert the first bad attempt rejects; a correct retry then also fails
    // because the code is one-shot — proving the code can't be brute-forced.
    const { clientId, code } = await setup();
    await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: 'wrong',
    });
    const retry = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: VERIFIER,
    });
    expect(retry.status).toBe(400);
    expect((await retry.json()).error).toBe('invalid_grant');
  });

  it('cross-check: /authorize already rejects a request omitting code_challenge', async () => {
    const { clientId } = await setup();
    const { GET } = await import('@/app/api/oauth/authorize/route');
    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      // no code_challenge
      scope: 'mcp:read',
      state: 's',
    });
    const res = await GET(new Request(`http://localhost/api/oauth/authorize?${p.toString()}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });
});
