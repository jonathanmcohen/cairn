import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { captureInbox } from '@/lib/inbox/capture';
import { markInboxDone } from '@/lib/inbox/triage';
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
  await sql`TRUNCATE pages, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

describe('markInboxDone', () => {
  it('flips metadata.inbox to false on the captured page', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const c = await captureInbox(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      payload: { title: 'X', body: '', url: null },
    });
    await markInboxDone(db, {
      pageId: c.capturedPageId,
      workspaceId: u.workspaceId,
      userId: u.userId,
    });
    const [after] = await db
      .select({ metadata: schema.pages.metadata })
      .from(schema.pages)
      .where(eq(schema.pages.id, c.capturedPageId));
    expect((after?.metadata as { inbox?: boolean }).inbox).toBe(false);
  });

  it('writes an inbox.triaged audit log row', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const c = await captureInbox(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      payload: { title: 'X', body: '', url: null },
    });
    await markInboxDone(db, {
      pageId: c.capturedPageId,
      workspaceId: u.workspaceId,
      userId: u.userId,
    });
    const rows = (await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId))) as Array<{ action: string }>;
    expect(rows.some((r) => r.action === 'inbox.triaged')).toBe(true);
  });

  it('refuses cross-workspace pages (page-not-found error)', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const b = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const c = await captureInbox(db, {
      workspaceId: a.workspaceId,
      userId: a.userId,
      payload: { title: 'X', body: '', url: null },
    });
    await expect(
      markInboxDone(db, {
        pageId: c.capturedPageId,
        workspaceId: b.workspaceId,
        userId: b.userId,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
