import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { __resetBuckets, takeToken, withApiKey } from '@/lib/api/rate-limit';
import { createDatabase } from '@/lib/databases/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

// The v0.5.0 API-key surface (api_keys table + mint/verify + withApiKey) is
// present, so this suite runs. The gate resolves at collection time off the
// static schema export, so it self-disables if the table is ever removed
// (describe.skipIf is evaluated before beforeAll, so an async DB probe can't gate
// it). The api_keys migration is committed alongside this schema.
const hasApiKeys = schema.apiKeys != null;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  if (hasApiKeys)
    await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys, databases, db_properties, db_views, db_rows, db_cells RESTART IDENTITY CASCADE`;
  __resetBuckets();
});

function bearer(url: string, token: string, method = 'GET', body?: unknown): Request {
  return new Request(`http://t${url}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe.skipIf(!hasApiKeys)('API key auth (v0.5.0)', () => {
  it('revoked (deleted) key is rejected (401)', async () => {
    const { mintKey } = await import('@/lib/api/keys');
    const ws = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token, key } = await mintKey(db, {
      workspaceId: ws.workspaceId,
      name: 'k',
      role: 'editor',
      createdBy: ws.userId,
    });
    // "Revoke" = delete the row (there is no revoked column).
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, key.id));

    const route = await import('@/app/api/v1/databases/route');
    const res = await route.GET(bearer('/api/v1/databases', token));
    expect(res.status).toBe(401);
  });

  it('expired key is rejected (401)', async () => {
    const { mintKey } = await import('@/lib/api/keys');
    const ws = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token } = await mintKey(db, {
      workspaceId: ws.workspaceId,
      name: 'k',
      role: 'editor',
      createdBy: ws.userId,
      expiresAt: new Date(Date.now() - 60_000), // already expired
    });

    const route = await import('@/app/api/v1/databases/route');
    const res = await route.GET(bearer('/api/v1/databases', token));
    expect(res.status).toBe(401);
  });

  it('valid key authenticates (200) — control', async () => {
    const { mintKey } = await import('@/lib/api/keys');
    const ws = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token } = await mintKey(db, {
      workspaceId: ws.workspaceId,
      name: 'k',
      role: 'editor',
      createdBy: ws.userId,
    });

    const route = await import('@/app/api/v1/databases/route');
    const res = await route.GET(bearer('/api/v1/databases', token));
    expect(res.status).toBe(200);
  });

  it('key cannot exceed its role (403 on over-role mutation)', async () => {
    const { mintKey } = await import('@/lib/api/keys');
    const ws = await createTestWorkspaceWithUser(db, { role: 'viewer' });
    // Seed a page + database the viewer key can see but must not mutate.
    const [page] = await db
      .insert(schema.pages)
      .values({ workspaceId: ws.workspaceId, title: 'p', createdBy: ws.userId })
      .returning();
    if (!page) throw new Error('seed failed');
    const dbase = await createDatabase(db, {
      workspaceId: ws.workspaceId,
      pageId: page.id,
      createdBy: ws.userId,
    });
    const { token } = await mintKey(db, {
      workspaceId: ws.workspaceId,
      name: 'k',
      role: 'viewer',
      createdBy: ws.userId,
    });

    const route = await import('@/app/api/v1/databases/[databaseId]/route');
    const res = await route.PATCH(
      bearer(`/api/v1/databases/${dbase.id}`, token, 'PATCH', { name: 'pwned' }),
      { params: Promise.resolve({ databaseId: dbase.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('rate limit trips after the configured burst (429)', async () => {
    const ws = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { mintKey } = await import('@/lib/api/keys');
    const { token } = await mintKey(db, {
      workspaceId: ws.workspaceId,
      name: 'k',
      role: 'editor',
      createdBy: ws.userId,
    });

    // Tiny bucket so the burst is cheap to exhaust.
    const handler = withApiKey(async () => Response.json({ ok: true }), {
      capacity: 2,
      refillPerSec: 0,
    });
    const r1 = await handler(bearer('/api/v1/x', token));
    const r2 = await handler(bearer('/api/v1/x', token));
    const r3 = await handler(bearer('/api/v1/x', token));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
  });

  it('takeToken empties then refuses (unit)', () => {
    const opts = { capacity: 1, refillPerSec: 0 };
    expect(takeToken('isolated-key', opts)).toBe(true);
    expect(takeToken('isolated-key', opts)).toBe(false);
  });
});
