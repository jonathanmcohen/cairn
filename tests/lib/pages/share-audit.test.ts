import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { setShareSettings } from '@/lib/pages/share';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, audit_log RESTART IDENTITY CASCADE`;
});

async function seedPage() {
  const u = await createTestWorkspaceWithUser(db);
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'S', createdBy: u.userId })
    .returning();
  if (!p) throw new Error('seed failed');
  return { workspaceId: u.workspaceId, userId: u.userId, pageId: p.id };
}

describe('share-password audit actions (v0.9.0 G6 P33)', () => {
  it('emits share.password_set when password is set', async () => {
    const { workspaceId, userId, pageId } = await seedPage();
    await setShareSettings(db, { workspaceId, pageId, actorUserId: userId, password: 'pw' });
    const all = await db
      .select({ action: schema.auditLog.action, targetId: schema.auditLog.targetId })
      .from(schema.auditLog)
      .orderBy(schema.auditLog.createdAt);
    const forPage = all.filter((r) => r.targetId === pageId).map((r) => r.action);
    expect(forPage).toContain('share.password_set');
    // legacy page.share_changed still fires so SIEM consumers keep working
    expect(forPage).toContain('page.share_changed');
  });

  it('emits share.password_cleared when password is set to null', async () => {
    const { workspaceId, userId, pageId } = await seedPage();
    await setShareSettings(db, { workspaceId, pageId, actorUserId: userId, password: 'pw' });
    await setShareSettings(db, { workspaceId, pageId, actorUserId: userId, password: null });
    const all = await db
      .select({ action: schema.auditLog.action, targetId: schema.auditLog.targetId })
      .from(schema.auditLog)
      .orderBy(schema.auditLog.createdAt);
    const forPage = all.filter((r) => r.targetId === pageId).map((r) => r.action);
    expect(forPage).toContain('share.password_set');
    expect(forPage).toContain('share.password_cleared');
  });

  it('does NOT emit password audit actions when only allowDuplication changes', async () => {
    const { workspaceId, userId, pageId } = await seedPage();
    await setShareSettings(db, {
      workspaceId,
      pageId,
      actorUserId: userId,
      allowDuplication: true,
    });
    const all = await db
      .select({ action: schema.auditLog.action, targetId: schema.auditLog.targetId })
      .from(schema.auditLog);
    const forPage = all.filter((r) => r.targetId === pageId).map((r) => r.action);
    expect(forPage).not.toContain('share.password_set');
    expect(forPage).not.toContain('share.password_cleared');
    expect(forPage).toContain('page.share_changed');
  });
});
