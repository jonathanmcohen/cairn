import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { captureInbox } from '@/lib/inbox/capture';
import { ensureInboxPage } from '@/lib/inbox/lazy-page';
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

describe('ensureInboxPage', () => {
  it('lazily creates the inbox page on first call and records the pointer', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const beforeRow = await db
      .select({ inboxPageId: schema.workspaces.inboxPageId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, u.workspaceId));
    expect(beforeRow[0]?.inboxPageId).toBeNull();

    const pageId = await ensureInboxPage(db, { workspaceId: u.workspaceId, userId: u.userId });
    expect(pageId).toMatch(/^[0-9a-f-]{36}$/);

    const afterRow = await db
      .select({ inboxPageId: schema.workspaces.inboxPageId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, u.workspaceId));
    expect(afterRow[0]?.inboxPageId).toBe(pageId);

    const inboxPage = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
    expect(inboxPage[0]?.title).toBe('Inbox');
    expect(inboxPage[0]?.parentId).toBeNull();
  });

  it('returns the existing inbox page on subsequent calls (idempotent)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const first = await ensureInboxPage(db, { workspaceId: u.workspaceId, userId: u.userId });
    const second = await ensureInboxPage(db, { workspaceId: u.workspaceId, userId: u.userId });
    expect(second).toBe(first);
  });
});

describe('captureInbox', () => {
  it('inserts a child page tagged {inbox: true, capturedAt}', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const result = await captureInbox(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      payload: { title: 'Quick thought', body: 'Body text', url: 'https://example.com/x' },
    });
    expect(result.capturedPageId).toMatch(/^[0-9a-f-]{36}$/);

    const inboxPageId = await ensureInboxPage(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
    });
    expect(result.inboxPageId).toBe(inboxPageId);

    const child = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, result.capturedPageId));
    expect(child[0]?.parentId).toBe(inboxPageId);
    expect(child[0]?.title).toBe('Quick thought');
    const meta = child[0]?.metadata as { inbox?: boolean; capturedAt?: string; sourceUrl?: string };
    expect(meta.inbox).toBe(true);
    expect(typeof meta.capturedAt).toBe('string');
    expect(meta.sourceUrl).toBe('https://example.com/x');
  });

  it('writes an inbox.captured audit log row', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await captureInbox(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      payload: { title: 'Note', body: '', url: null },
    });
    const rows = (await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId))) as Array<{ action: string }>;
    expect(rows.some((r) => r.action === 'inbox.captured')).toBe(true);
  });

  it('defaults a missing title to "Untitled capture"', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const result = await captureInbox(db, {
      workspaceId: u.workspaceId,
      userId: u.userId,
      payload: { title: '', body: 'only body', url: null },
    });
    const child = await db
      .select({ title: schema.pages.title })
      .from(schema.pages)
      .where(eq(schema.pages.id, result.capturedPageId));
    expect(child[0]?.title).toBe('Untitled capture');
  });
});
