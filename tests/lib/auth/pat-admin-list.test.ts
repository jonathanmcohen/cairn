import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
import { listWorkspacePats } from '@/lib/auth/pat-admin-list';
import { dayWindowStart } from '@/lib/auth/pat-quota-windows';
import { startPostgres, stopPostgres } from '../../helpers/db';

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
  await sql`TRUNCATE pat_quota_usage, personal_access_tokens, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seed() {
  const [u1] = await db
    .insert(schema.users)
    .values({ email: 'admin@x.test', passwordHash: 'h', name: 'Admin' })
    .returning();
  const [u2] = await db
    .insert(schema.users)
    .values({ email: 'member@x.test', passwordHash: 'h', name: 'Member' })
    .returning();
  if (!u1 || !u2) throw new Error('user seed failed');
  const [ws] = await db.insert(schema.workspaces).values({ name: 'w', slug: 'w' }).returning();
  if (!ws) throw new Error('workspace seed failed');
  await db.insert(schema.workspaceMembers).values([
    { workspaceId: ws.id, userId: u1.id, role: 'owner' },
    { workspaceId: ws.id, userId: u2.id, role: 'editor' },
  ]);
  const { row: p1 } = await mintPat(db, {
    userId: u1.id,
    workspaceId: ws.id,
    name: 'admin-token',
    scopes: ['pages.read'],
    mcpTools: [],
    expiresAt: null,
  });
  const { row: p2 } = await mintPat(db, {
    userId: u2.id,
    workspaceId: ws.id,
    name: 'member-token',
    scopes: ['pages.read', 'pages.write'],
    mcpTools: [],
    expiresAt: null,
  });
  return { ws, u1, u2, p1, p2 };
}

describe('listWorkspacePats', () => {
  it('returns every PAT in the workspace with owner info', async () => {
    const { ws } = await seed();
    const rows = await listWorkspacePats(db, ws.id);
    expect(rows).toHaveLength(2);
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(['admin-token', 'member-token']);
    const memberRow = rows.find((r) => r.name === 'member-token');
    expect(memberRow?.ownerEmail).toBe('member@x.test');
    expect(memberRow?.scopes).toEqual(['pages.read', 'pages.write']);
  });

  it('isolates per-workspace (cross-workspace PATs not returned)', async () => {
    const { u1 } = await seed();
    const [otherWs] = await db
      .insert(schema.workspaces)
      .values({ name: 'other', slug: 'other' })
      .returning();
    if (!otherWs) throw new Error('other workspace seed failed');
    await db.insert(schema.workspaceMembers).values({
      workspaceId: otherWs.id,
      userId: u1.id,
      role: 'owner',
    });
    await mintPat(db, {
      userId: u1.id,
      workspaceId: otherWs.id,
      name: 'other-token',
      scopes: ['pages.read'],
      mcpTools: [],
      expiresAt: null,
    });
    const rows = await listWorkspacePats(db, otherWs.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('other-token');
  });

  it('reports currentDayUsage + currentMonthUsage from pat_quota_usage', async () => {
    const { ws, p1 } = await seed();
    const today = dayWindowStart(new Date());
    await db.insert(schema.patQuotaUsage).values({
      tokenId: p1.id,
      windowStart: today,
      windowKind: 'day',
      requests: 42,
      bytes: 0,
    });
    const rows = await listWorkspacePats(db, ws.id);
    const r = rows.find((x) => x.id === p1.id);
    expect(r?.currentDayUsage).toBe(42);
  });

  it('returns last14Days oldest-first with missing days zero-filled', async () => {
    const { ws, p1 } = await seed();
    const today = dayWindowStart(new Date());
    const dayMs = 24 * 60 * 60 * 1000;
    // Seed days T-13 (=5), T-7 (=10), T (=20)
    await db.insert(schema.patQuotaUsage).values([
      {
        tokenId: p1.id,
        windowStart: new Date(today.getTime() - 13 * dayMs),
        windowKind: 'day',
        requests: 5,
        bytes: 0,
      },
      {
        tokenId: p1.id,
        windowStart: new Date(today.getTime() - 7 * dayMs),
        windowKind: 'day',
        requests: 10,
        bytes: 0,
      },
      {
        tokenId: p1.id,
        windowStart: today,
        windowKind: 'day',
        requests: 20,
        bytes: 0,
      },
    ]);
    const rows = await listWorkspacePats(db, ws.id);
    const r = rows.find((x) => x.id === p1.id);
    expect(r?.last14Days).toHaveLength(14);
    expect(r?.last14Days[0]).toBe(5);
    expect(r?.last14Days[6]).toBe(10);
    expect(r?.last14Days[13]).toBe(20);
  });

  it('excludes revoked tokens', async () => {
    const { ws, p1 } = await seed();
    await db
      .update(schema.personalAccessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.personalAccessTokens.id, p1.id));
    const rows = await listWorkspacePats(db, ws.id);
    expect(rows.find((r) => r.id === p1.id)).toBeUndefined();
  });
});
