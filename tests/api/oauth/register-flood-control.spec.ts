/**
 * v0.10.0 G5 — flood control on POST /api/oauth/register.
 *
 * Route-level contract (the lib internals are pinned in
 * tests/lib/oauth/register-rate-limit.test.ts and register-lock.test.ts):
 *   - rate limit runs FIRST: past the ceiling ⇒ 429 + parseable Retry-After,
 *     and the throttled request writes NO oauth_clients row;
 *   - error_description names the tripped bucket (per-address vs global);
 *   - a broken limiter FAILS CLOSED ⇒ 503, nothing written;
 *   - registration lock ON: no bearer / wrong bearer ⇒ 401 invalid_token
 *     (nothing written); the real initial access token ⇒ 201;
 *   - default posture: lock off + fresh buckets ⇒ the pre-G5 happy path is
 *     byte-for-byte unchanged (201, client row created).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { setRegisterLock } from '@/lib/oauth/register-lock';
import {
  __resetRegisterRateLimiterForTests,
  __setRegisterRateLimiterForTests,
  REGISTER_GLOBAL_LIMIT_ENV_VAR,
  REGISTER_IP_LIMIT_ENV_VAR,
} from '@/lib/oauth/register-rate-limit';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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

function clearKnobs(): void {
  delete process.env[REGISTER_IP_LIMIT_ENV_VAR];
  delete process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR];
  delete process.env.TRUST_PROXY;
}

beforeEach(async () => {
  await sql`TRUNCATE system_meta, oauth_clients, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  clearKnobs();
  __resetRegisterRateLimiterForTests();
});

afterEach(() => {
  clearKnobs();
  __resetRegisterRateLimiterForTests();
});

async function register(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const { POST } = await import('@/app/api/oauth/register/route');
  return POST(
    new Request('http://localhost/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function validBody(name: string): Record<string, unknown> {
  return { client_name: name, redirect_uris: ['http://localhost:33418/callback'] };
}

async function clientCount(): Promise<number> {
  const rows = await db.select({ id: schema.oauthClients.id }).from(schema.oauthClients);
  return rows.length;
}

describe('G5 — rate limit before any work', () => {
  it('429 after N requests, with a parseable Retry-After; the throttled request writes NOTHING', async () => {
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = '3';
    process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR] = '100';

    for (let i = 0; i < 3; i++) {
      const res = await register(validBody(`burst-${i}`));
      expect(res.status, await res.clone().text()).toBe(201);
    }
    const limited = await register(validBody('burst-overflow'));
    expect(limited.status).toBe(429);
    const retryAfter = limited.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    expect(Number.parseInt(retryAfter as string, 10)).toBeGreaterThan(0);
    const body = (await limited.json()) as { error: string; error_description: string };
    expect(body.error).toBe('too_many_requests');
    expect(body.error_description).toContain('address'); // per-IP bucket named

    expect(await clientCount()).toBe(3);
  });

  it('global bucket trips (named in error_description) even when each IP is under its own limit', async () => {
    // Distinct x-forwarded-for values only key separate buckets behind a
    // trusted proxy — mirror the route's TRUST_PROXY flag.
    process.env.TRUST_PROXY = 'true';
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = '100';
    process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR] = '2';

    const r1 = await register(validBody('g-1'), { 'x-forwarded-for': '10.0.0.1' });
    const r2 = await register(validBody('g-2'), { 'x-forwarded-for': '10.0.0.2' });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const limited = await register(validBody('g-3'), { 'x-forwarded-for': '10.0.0.3' });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error_description: string };
    expect(body.error_description).toContain('instance-wide');
    expect(await clientCount()).toBe(2);
  });

  it('FAILS CLOSED: a throwing limiter answers 503 and writes NOTHING', async () => {
    __setRegisterRateLimiterForTests({
      check: () => {
        throw new Error('boom');
      },
    });
    const res = await register(validBody('limiter-down'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('temporarily_unavailable');
    expect(await clientCount()).toBe(0);
  });
});

describe('G5 — registration lock (RFC 7591 §3.1.1)', () => {
  async function lockInstance(): Promise<string> {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const { initialAccessToken } = await setRegisterLock(db, {
      locked: true,
      actorUserId: u.userId,
      workspaceId: u.workspaceId,
    });
    return initialAccessToken as string;
  }

  it('locked + no bearer ⇒ 401 invalid_token, nothing written', async () => {
    await lockInstance();
    const res = await register(validBody('no-bearer'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_token');
    expect(res.headers.get('WWW-Authenticate')).toContain('invalid_token');
    expect(await clientCount()).toBe(0);
  });

  it('locked + WRONG bearer ⇒ 401 invalid_token, nothing written', async () => {
    await lockInstance();
    const res = await register(validBody('wrong-bearer'), {
      authorization: `Bearer cairn_oiat_${'x'.repeat(43)}`,
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_token');
    expect(await clientCount()).toBe(0);
  });

  it('locked + the real initial access token ⇒ 201 and the client row exists', async () => {
    const token = await lockInstance();
    const res = await register(validBody('with-iat'), { authorization: `Bearer ${token}` });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { client_id: string };
    expect(typeof body.client_id).toBe('string');
    expect(await clientCount()).toBe(1);
  });

  it('DEFAULT OPEN: with the lock off the pre-G5 happy path is unchanged', async () => {
    const res = await register(validBody('open-default'));
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.client_id).toBe('string');
    expect(body.client_secret).toBeUndefined(); // public PKCE client
    expect(await clientCount()).toBe(1);
  });
});
