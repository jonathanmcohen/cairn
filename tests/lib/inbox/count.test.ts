import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { captureInbox } from '@/lib/inbox/capture';
import { countInboxItems } from '@/lib/inbox/count';
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

describe('countInboxItems', () => {
  it('returns 0 for a workspace that has never captured (no inbox page)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    expect(await countInboxItems(db, { workspaceId: u.workspaceId })).toBe(0);
  });

  it('counts untriaged captures and matches the /inbox list semantics', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    for (const title of ['a', 'b', 'c']) {
      await captureInbox(db, {
        workspaceId: u.workspaceId,
        userId: u.userId,
        payload: { title, body: '', url: null },
      });
    }
    expect(await countInboxItems(db, { workspaceId: u.workspaceId })).toBe(3);
  });

  it('excludes triaged (mark-done) captures', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const kept = await captureInbox(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      payload: { title: 'keep', body: '', url: null },
    });
    const done = await captureInbox(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      payload: { title: 'done', body: '', url: null },
    });
    await markInboxDone(db, {
      pageId: done.capturedPageId,
      workspaceId: u.workspaceId,
      userId: u.userId,
    });
    expect(kept.capturedPageId).not.toBe(done.capturedPageId);
    expect(await countInboxItems(db, { workspaceId: u.workspaceId })).toBe(1);
  });

  it('does not count another workspace’s captures (tenant isolation)', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const b = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await captureInbox(db, {
      workspaceId: a.workspaceId,
      userId: a.userId,
      payload: { title: 'mine', body: '', url: null },
    });
    await captureInbox(db, {
      workspaceId: b.workspaceId,
      userId: b.userId,
      payload: { title: 'theirs-1', body: '', url: null },
    });
    await captureInbox(db, {
      workspaceId: b.workspaceId,
      userId: b.userId,
      payload: { title: 'theirs-2', body: '', url: null },
    });
    expect(await countInboxItems(db, { workspaceId: a.workspaceId })).toBe(1);
    expect(await countInboxItems(db, { workspaceId: b.workspaceId })).toBe(2);
  });

  it('ignores ordinary child pages of the inbox page without the inbox marker', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const captured = await captureInbox(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      payload: { title: 'real capture', body: '', url: null },
    });
    // A page manually nested under the inbox page (e.g. dragged there) has no
    // metadata.inbox marker and must not inflate the badge.
    await db.insert(schema.pages).values({
      workspaceId: u.workspaceId,
      parentId: captured.inboxPageId,
      title: 'manually nested',
      content: { type: 'doc', content: [] },
      createdBy: u.userId,
    });
    expect(await countInboxItems(db, { workspaceId: u.workspaceId })).toBe(1);
  });
});
