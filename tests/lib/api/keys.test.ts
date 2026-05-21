import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintKey, verifyKey } from '@/lib/api/keys';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys RESTART IDENTITY CASCADE`;
});

describe('mintKey', () => {
  it('returns a cairn_sk_ token once and stores only the hash + prefix', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const { token, key } = await mintKey(db, {
      workspaceId: u.workspaceId,
      name: 'CI',
      role: 'editor',
      createdBy: u.userId,
    });
    expect(token).toMatch(/^cairn_sk_[0-9a-f]{64}$/);
    expect(key.tokenPrefix).toBe(token.slice(0, 13)); // 'cairn_sk_' + 4 hex
    // plaintext is NOT persisted anywhere
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id));
    expect(row?.tokenHash).not.toContain(token);
    expect(row?.tokenHash).toHaveLength(64); // sha256 hex
  });
});

describe('verifyKey', () => {
  it('resolves a valid token to an AuthContext and stamps last_used_at', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const { token } = await mintKey(db, {
      workspaceId: u.workspaceId,
      name: 'k',
      role: 'editor',
      createdBy: u.userId,
    });
    const ctx = await verifyKey(db, token);
    expect(ctx).toEqual({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.workspaceId, u.workspaceId));
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it('returns null for an unknown / malformed token', async () => {
    expect(await verifyKey(db, 'cairn_sk_deadbeef')).toBeNull();
    expect(await verifyKey(db, 'not-a-token')).toBeNull();
  });

  it('returns null for an expired key', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const { token } = await mintKey(db, {
      workspaceId: u.workspaceId,
      name: 'old',
      role: 'viewer',
      createdBy: u.userId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await verifyKey(db, token)).toBeNull();
  });
});
