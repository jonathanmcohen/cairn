import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintKey } from '@/lib/api/keys';
import { __resetBuckets, takeToken, withApiKey } from '@/lib/api/rate-limit';
import type { AuthContext } from '@/lib/auth/require-role';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let _db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  _db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys RESTART IDENTITY CASCADE`;
  __resetBuckets();
});

describe('takeToken (token bucket)', () => {
  it('allows up to capacity then refuses', () => {
    const cap = 5;
    let allowed = 0;
    for (let i = 0; i < cap + 3; i++) {
      if (takeToken('key-1', { capacity: cap, refillPerSec: 0 })) allowed++;
    }
    expect(allowed).toBe(cap);
    // a different key has its own bucket
    expect(takeToken('key-2', { capacity: cap, refillPerSec: 0 })).toBe(true);
  });
});

describe('withApiKey', () => {
  async function bearer(role: schema.MemberRole = 'editor') {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const { token } = await mintKey(getDb(), {
      workspaceId: u.workspaceId,
      name: 'k',
      role,
      createdBy: u.userId,
    });
    return { token, u };
  }

  it('calls the handler with the AuthContext on success', async () => {
    const { token } = await bearer();
    const handler = withApiKey(async (_req, ctx: AuthContext) =>
      Response.json({ workspaceId: ctx.workspaceId }, { status: 200 }),
    );
    const res = await handler(
      new Request('http://localhost/api/v1/pages', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('returns a uniform 401 error body for a missing key', async () => {
    const handler = withApiKey(async () => Response.json({}, { status: 200 }));
    const res = await handler(new Request('http://localhost/api/v1/pages'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('unauthorized');
    expect(typeof body.error.message).toBe('string');
  });

  it('returns 429 with error.code rate_limited when the bucket is empty', async () => {
    const { token } = await bearer();
    const handler = withApiKey(async () => Response.json({ ok: true }, { status: 200 }), {
      capacity: 1,
      refillPerSec: 0,
    });
    const r1 = await handler(
      new Request('http://localhost/api/v1/pages', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const r2 = await handler(
      new Request('http://localhost/api/v1/pages', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(429);
    expect(((await r2.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });
});
