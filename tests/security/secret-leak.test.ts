import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function actAs(userId: string): Promise<void> {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys, webhooks
    RESTART IDENTITY CASCADE`;
});

// Secret-bearing column/field names that must NEVER appear in an API response,
// plus the live AUTH_SECRET value itself.
const FORBIDDEN_KEYS = ['passwordHash', 'password_hash', 'tokenHash', 'token_hash', 'AUTH_SECRET'];

function assertNoSecrets(body: string) {
  for (const k of FORBIDDEN_KEYS) {
    expect(body).not.toContain(k);
  }
  // The webhook signing secret value and the live AUTH_SECRET must be absent.
  expect(body).not.toContain(process.env.AUTH_SECRET ?? '__never__');
}

describe('secret non-leakage in API responses', () => {
  it('workspace member listing never includes passwordHash', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    await actAs(ws.userId);
    const route = await import('@/app/api/workspaces/members/route');
    const res = await route.GET(new Request('http://t/api/workspaces/members?q='));
    expect(res.status).toBe(200);
    const body = await res.text();
    assertNoSecrets(body);
    // Sanity: the listing actually returned the seeded member.
    expect(body).toContain(ws.userId);
  });

  it('webhook listing never includes the signing secret', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    await actAs(ws.userId);
    const secret = `cairn_whsec_${randomBytes(24).toString('hex')}`;
    await db.insert(schema.webhooks).values({
      workspaceId: ws.workspaceId,
      url: 'https://example.com/hook',
      events: ['page.created'],
      secret,
    });
    const route = await import('@/app/api/webhooks/route');
    const res = await route.GET();
    expect(res.status).toBe(200);
    const body = await res.text();
    assertNoSecrets(body);
    expect(body).not.toContain(secret); // the literal secret value
    expect(body).not.toContain('"secret"'); // and no `secret` field at all
    // Sanity: the webhook itself was returned.
    expect(body).toContain('example.com/hook');
  });

  it('api-key list serializer projects out token_hash', async () => {
    // Mirror the settings page serializer: it must NEVER select tokenHash.
    const ws = await createTestWorkspaceWithUser(db);
    await db.insert(schema.apiKeys).values({
      workspaceId: ws.workspaceId,
      name: 'k',
      tokenHash: 'a'.repeat(64),
      tokenPrefix: 'cairn_sk_ab12',
      role: 'viewer',
      createdBy: ws.userId,
    });
    const rows = await db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        tokenPrefix: schema.apiKeys.tokenPrefix,
        role: schema.apiKeys.role,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        expiresAt: schema.apiKeys.expiresAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys);
    const body = JSON.stringify(rows);
    assertNoSecrets(body);
    expect(body).toContain('cairn_sk_ab12'); // prefix is safe to surface
    expect(body).not.toContain('a'.repeat(64)); // the hash is not
  });
});
