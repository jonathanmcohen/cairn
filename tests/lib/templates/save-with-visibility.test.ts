import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { instantiateTemplate } from '@/lib/templates/instantiate';
import { savePageAsTemplate } from '@/lib/templates/save';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  process.env.DATABASE_URL = uri;
});
afterAll(async () => stopPostgres());
beforeEach(async () => {
  await getDb().execute(
    sql`TRUNCATE templates, pages, workspace_members, workspaces, users, audit_log RESTART IDENTITY CASCADE`,
  );
});

async function seed() {
  const u = await createTestWorkspaceWithUser(getDb());
  const [p] = await getDb()
    .insert(schema.pages)
    .values({
      workspaceId: u.workspaceId,
      title: 'Source page',
      icon: '📒',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
      } as never,
      createdBy: u.userId,
    } as never)
    .returning({ id: schema.pages.id });
  if (!p) throw new Error('seed page insert failed');
  return { userId: u.userId, workspaceId: u.workspaceId, pageId: p.id };
}

describe('savePageAsTemplate — v0.9 visibility', () => {
  it('persists visibility=private', async () => {
    const { userId, workspaceId, pageId } = await seed();
    const tpl = await savePageAsTemplate(getDb(), {
      workspaceId,
      actorUserId: userId,
      rootPageId: pageId,
      name: 'My private template',
      visibility: 'private',
    });
    expect(tpl.visibility).toBe('private');
    expect(tpl.workspaceId).toBe(workspaceId);
    expect(tpl.kind).toBe('page');
  });

  it('accepts visibility=workspace + visibility=public', async () => {
    const { userId, workspaceId, pageId } = await seed();
    const a = await savePageAsTemplate(getDb(), {
      workspaceId,
      actorUserId: userId,
      rootPageId: pageId,
      name: 'ws',
      visibility: 'workspace',
    });
    const b = await savePageAsTemplate(getDb(), {
      workspaceId,
      actorUserId: userId,
      rootPageId: pageId,
      name: 'pub',
      visibility: 'public',
    });
    expect(a.visibility).toBe('workspace');
    expect(b.visibility).toBe('public');
  });

  it('snapshot roundtrip: template → instantiate → content matches source', async () => {
    const { userId, workspaceId, pageId } = await seed();
    const tpl = await savePageAsTemplate(getDb(), {
      workspaceId,
      actorUserId: userId,
      rootPageId: pageId,
      name: 'rt',
      visibility: 'workspace',
    });
    const result = await instantiateTemplate(getDb(), {
      templateId: tpl.id,
      targetWorkspaceId: workspaceId,
      createdBy: userId,
      parentId: null,
    });
    expect(result.rootPageId).toBeTruthy();
    const [newPage] = await getDb()
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, result.rootPageId as string));
    expect((newPage?.content as { content: unknown[] }).content[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('rejects unknown visibility string', async () => {
    const { userId, workspaceId, pageId } = await seed();
    await expect(
      savePageAsTemplate(getDb(), {
        workspaceId,
        actorUserId: userId,
        rootPageId: pageId,
        name: 'bad',
        // @ts-expect-error — intentional invalid value
        visibility: 'galactic',
      }),
    ).rejects.toThrow();
  });

  it('records visibility in the template.created audit row', async () => {
    const { userId, workspaceId, pageId } = await seed();
    const tpl = await savePageAsTemplate(getDb(), {
      workspaceId,
      actorUserId: userId,
      rootPageId: pageId,
      name: 'audited',
      visibility: 'public',
    });
    const [audit] = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, tpl.id));
    expect(audit?.action).toBe('template.created');
    expect(audit?.metadata).toMatchObject({ visibility: 'public', name: 'audited' });
  });
});
