import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import type { AuditAction } from '@/lib/audit/actions';
import { listAuditLog, listPageActivity } from '@/lib/audit/query';
import { recordAudit } from '@/lib/audit/record';
import { startPostgres, stopPostgres } from '../../helpers/db';

let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  pg = postgres(uri);
  db = drizzle(pg, { schema });
});
afterAll(async () => {
  await pg.end();
  await stopPostgres();
});
beforeEach(async () => {
  await pg`TRUNCATE audit_log, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeUser(name: string) {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: `${name}-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name,
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}
async function makeWs() {
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!w) throw new Error('workspace insert failed');
  return w.id;
}

describe('listAuditLog', () => {
  it('returns only the requested workspace, newest-first, and supports core filters', async () => {
    const wsA = await makeWs();
    const wsB = await makeWs();
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const pageId = '11111111-1111-1111-1111-111111111111';
    const otherPageId = '22222222-2222-2222-2222-222222222222';

    // Seed ~20 rows across two workspaces / multiple actions / actors / targets / dates.
    // Use db.transaction since recordAudit accepts the tx; createdAt defaults to now() but
    // we'll insert sequentially so ordering is deterministic.
    const now = Date.now();
    const seed: Array<{
      workspaceId: string;
      actorUserId: string;
      action: AuditAction;
      targetType: string;
      targetId: string;
      createdAt: Date;
    }> = [
      // wsA — 12 rows
      {
        workspaceId: wsA,
        actorUserId: alice,
        action: 'page.published',
        targetType: 'page',
        targetId: pageId,
        createdAt: new Date(now - 12_000),
      },
      {
        workspaceId: wsA,
        actorUserId: bob,
        action: 'page.unpublished',
        targetType: 'page',
        targetId: pageId,
        createdAt: new Date(now - 11_000),
      },
      {
        workspaceId: wsA,
        actorUserId: alice,
        action: 'page.published',
        targetType: 'page',
        targetId: otherPageId,
        createdAt: new Date(now - 10_000),
      },
      {
        workspaceId: wsA,
        actorUserId: alice,
        action: 'member.role_changed',
        targetType: 'member',
        targetId: bob,
        createdAt: new Date(now - 9_000),
      },
      {
        workspaceId: wsA,
        actorUserId: bob,
        action: 'api_key.created',
        targetType: 'api_key',
        targetId: '33333333-3333-3333-3333-333333333333',
        createdAt: new Date(now - 8_000),
      },
      {
        workspaceId: wsA,
        actorUserId: alice,
        action: 'page.share_changed',
        targetType: 'page',
        targetId: pageId,
        createdAt: new Date(now - 7_000),
      },
      {
        workspaceId: wsA,
        actorUserId: bob,
        action: 'invite.created',
        targetType: 'invite',
        targetId: '44444444-4444-4444-4444-444444444444',
        createdAt: new Date(now - 6_000),
      },
      {
        workspaceId: wsA,
        actorUserId: alice,
        action: 'page.published',
        targetType: 'page',
        targetId: pageId,
        createdAt: new Date(now - 5_000),
      },
      {
        workspaceId: wsA,
        actorUserId: alice,
        action: 'workspace.settings_changed',
        targetType: 'workspace',
        targetId: wsA,
        createdAt: new Date(now - 4_000),
      },
      {
        workspaceId: wsA,
        actorUserId: bob,
        action: 'page.deleted',
        targetType: 'page',
        targetId: otherPageId,
        createdAt: new Date(now - 3_000),
      },
      {
        workspaceId: wsA,
        actorUserId: alice,
        action: 'template.created',
        targetType: 'template',
        targetId: '55555555-5555-5555-5555-555555555555',
        createdAt: new Date(now - 2_000),
      },
      {
        workspaceId: wsA,
        actorUserId: bob,
        action: 'page.share_changed',
        targetType: 'page',
        targetId: pageId,
        createdAt: new Date(now - 1_000),
      },
      // wsB — 8 rows (must never leak into wsA result)
      ...Array.from({ length: 8 }, (_, i) => ({
        workspaceId: wsB,
        actorUserId: i % 2 ? alice : bob,
        action: 'page.published' as const,
        targetType: 'page',
        targetId: '66666666-6666-6666-6666-666666666666',
        createdAt: new Date(now - (20_000 + i * 100)),
      })),
    ];
    // Insert directly so we control createdAt precisely.
    for (const r of seed) {
      await db.insert(schema.auditLog).values({
        workspaceId: r.workspaceId,
        actorUserId: r.actorUserId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        createdAt: r.createdAt,
      });
    }

    // 1) Workspace isolation + newest-first ordering.
    const all = await listAuditLog(db, { workspaceId: wsA });
    expect(all.entries).toHaveLength(12);
    for (const e of all.entries) expect(e.workspaceId).toBe(wsA);
    for (let i = 0; i < all.entries.length - 1; i++) {
      const a = all.entries[i];
      const b = all.entries[i + 1];
      if (!a || !b) throw new Error('missing entry');
      expect(a.createdAt.getTime()).toBeGreaterThanOrEqual(b.createdAt.getTime());
    }

    // 2) filters.action
    const published = await listAuditLog(db, {
      workspaceId: wsA,
      filters: { action: 'page.published' },
    });
    expect(published.entries.map((e) => e.action)).toEqual([
      'page.published',
      'page.published',
      'page.published',
    ]);

    // 3) filters.actorId
    const byBob = await listAuditLog(db, { workspaceId: wsA, filters: { actorId: bob } });
    expect(byBob.entries.every((e) => e.actorUserId === bob)).toBe(true);
    expect(byBob.entries.length).toBe(5);

    // 4) filters.targetType + filters.targetId
    const onPage = await listAuditLog(db, {
      workspaceId: wsA,
      filters: { targetType: 'page', targetId: pageId },
    });
    expect(onPage.entries.length).toBe(5);
    for (const e of onPage.entries) {
      expect(e.targetType).toBe('page');
      expect(e.targetId).toBe(pageId);
    }
  });

  it('filters.from/to is inclusive-from / exclusive-to', async () => {
    const wsA = await makeWs();
    const alice = await makeUser('alice');
    const base = new Date('2026-01-15T12:00:00.000Z');
    for (let i = 0; i < 6; i++) {
      await db.insert(schema.auditLog).values({
        workspaceId: wsA,
        actorUserId: alice,
        action: 'page.published',
        targetType: 'page',
        targetId: '11111111-1111-1111-1111-111111111111',
        createdAt: new Date(base.getTime() + i * 60_000), // 0,1,2,3,4,5 minutes
      });
    }
    // Window: from = base+1min (inclusive), to = base+4min (exclusive).
    // Expect rows at +1, +2, +3 minutes (3 rows).
    const res = await listAuditLog(db, {
      workspaceId: wsA,
      filters: {
        from: new Date(base.getTime() + 1 * 60_000),
        to: new Date(base.getTime() + 4 * 60_000),
      },
    });
    expect(res.entries).toHaveLength(3);
    for (const e of res.entries) {
      expect(e.createdAt.getTime()).toBeGreaterThanOrEqual(base.getTime() + 1 * 60_000);
      expect(e.createdAt.getTime()).toBeLessThan(base.getTime() + 4 * 60_000);
    }
  });

  it('limit defaults to 50 and is clamped to <= 100', async () => {
    const wsA = await makeWs();
    const alice = await makeUser('alice');
    const now = Date.now();
    for (let i = 0; i < 60; i++) {
      await db.insert(schema.auditLog).values({
        workspaceId: wsA,
        actorUserId: alice,
        action: 'page.published',
        targetType: 'page',
        targetId: '11111111-1111-1111-1111-111111111111',
        createdAt: new Date(now - i * 1000),
      });
    }
    const defaulted = await listAuditLog(db, { workspaceId: wsA });
    expect(defaulted.entries).toHaveLength(50);
    expect(defaulted.nextCursor).not.toBeNull();

    const clamped = await listAuditLog(db, { workspaceId: wsA, limit: 1000 });
    // 60 rows total, clamp to 100 ceiling but only 60 exist → 60 returned, no next cursor.
    expect(clamped.entries.length).toBe(60);
    expect(clamped.nextCursor).toBeNull();
  });

  it('pagination via cursor: 5 rows / limit=2 walks 2+2+1 with no overlap and no gap', async () => {
    const wsA = await makeWs();
    const alice = await makeUser('alice');
    const now = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [row] = await db
        .insert(schema.auditLog)
        .values({
          workspaceId: wsA,
          actorUserId: alice,
          action: 'page.published',
          targetType: 'page',
          targetId: '11111111-1111-1111-1111-111111111111',
          createdAt: new Date(now - i * 1000), // newest first when sorted desc
        })
        .returning();
      if (!row) throw new Error('insert failed');
      ids.push(row.id);
    }

    const page1 = await listAuditLog(db, { workspaceId: wsA, limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listAuditLog(db, {
      workspaceId: wsA,
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.entries).toHaveLength(2);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await listAuditLog(db, {
      workspaceId: wsA,
      limit: 2,
      cursor: page2.nextCursor!,
    });
    expect(page3.entries).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    const collected = [...page1.entries, ...page2.entries, ...page3.entries].map((e) => e.id);
    // No overlap.
    expect(new Set(collected).size).toBe(5);
    // No gap — covers all seeded rows.
    expect(new Set(collected)).toEqual(new Set(ids));
  });
});

describe('listPageActivity', () => {
  it('returns only target_type=page + target_id=pageId for that workspace, newest-first', async () => {
    const wsA = await makeWs();
    const wsB = await makeWs();
    const alice = await makeUser('alice');
    const pageId = '11111111-1111-1111-1111-111111111111';
    const otherPageId = '22222222-2222-2222-2222-222222222222';
    const now = Date.now();
    // wsA / pageId — 3 rows
    for (let i = 0; i < 3; i++) {
      await db.insert(schema.auditLog).values({
        workspaceId: wsA,
        actorUserId: alice,
        action: 'page.published',
        targetType: 'page',
        targetId: pageId,
        createdAt: new Date(now - i * 1000),
      });
    }
    // wsA / different page — must NOT appear
    await db.insert(schema.auditLog).values({
      workspaceId: wsA,
      actorUserId: alice,
      action: 'page.published',
      targetType: 'page',
      targetId: otherPageId,
      createdAt: new Date(now - 500),
    });
    // wsA / non-page target with same id — must NOT appear
    await db.insert(schema.auditLog).values({
      workspaceId: wsA,
      actorUserId: alice,
      action: 'member.role_changed',
      targetType: 'member',
      targetId: pageId,
      createdAt: new Date(now - 200),
    });
    // wsB / same pageId — must NOT appear (workspace scoping)
    await db.insert(schema.auditLog).values({
      workspaceId: wsB,
      actorUserId: alice,
      action: 'page.published',
      targetType: 'page',
      targetId: pageId,
      createdAt: new Date(now - 100),
    });

    const res = await listPageActivity(db, { workspaceId: wsA, pageId });
    expect(res.entries).toHaveLength(3);
    for (const e of res.entries) {
      expect(e.workspaceId).toBe(wsA);
      expect(e.targetType).toBe('page');
      expect(e.targetId).toBe(pageId);
    }
    for (let i = 0; i < res.entries.length - 1; i++) {
      const a = res.entries[i];
      const b = res.entries[i + 1];
      if (!a || !b) throw new Error('missing entry');
      expect(a.createdAt.getTime()).toBeGreaterThanOrEqual(b.createdAt.getTime());
    }
  });

  it('uses recordAudit-written rows (smoke)', async () => {
    const wsA = await makeWs();
    const alice = await makeUser('alice');
    const pageId = '11111111-1111-1111-1111-111111111111';
    await db.transaction((tx) =>
      recordAudit(tx, {
        workspaceId: wsA,
        actorUserId: alice,
        action: 'page.published',
        targetType: 'page',
        targetId: pageId,
      }),
    );
    const res = await listPageActivity(db, { workspaceId: wsA, pageId });
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]?.action).toBe('page.published');
  });
});
