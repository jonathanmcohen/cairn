import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  updateAnnotation,
} from '@/lib/pdf/annotations';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser, type TestUser } from '../../helpers/fixtures';

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
  await sql`TRUNCATE pdf_annotations, files, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function seedExtraUser(workspaceId: string, email: string): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: 'other' })
    .returning();
  if (!u) throw new Error('user insert failed');
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId, userId: u.id, role: 'editor' });
  return u.id;
}

async function seedPdfFile(user: TestUser, pageId: string): Promise<string> {
  const [file] = await db
    .insert(schema.files)
    .values({
      workspaceId: user.workspaceId,
      pageId,
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      path: `${user.workspaceId}/doc.pdf`,
      uploadedBy: user.userId,
    })
    .returning();
  if (!file) throw new Error('file insert failed');
  return file.id;
}

describe('per-user annotation isolation', () => {
  it('list returns only annotations created by the caller', async () => {
    const userA = await createTestWorkspaceWithUser(db);
    const userBId = await seedExtraUser(userA.workspaceId, `b-${userA.userId}@example.com`);
    const page = await createPage(db, {
      workspaceId: userA.workspaceId,
      createdBy: userA.userId,
      title: 'p',
    });
    const fileId = await seedPdfFile(userA, page.id);

    await createAnnotation(db, {
      pageId: page.id,
      fileId,
      pageNumber: 1,
      rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
      kind: 'highlight',
      content: null,
      createdBy: userA.userId,
    });
    await createAnnotation(db, {
      pageId: page.id,
      fileId,
      pageNumber: 1,
      rect: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
      kind: 'highlight',
      content: null,
      createdBy: userBId,
    });

    const listA = await listAnnotations(db, { fileId, userId: userA.userId });
    const listB = await listAnnotations(db, { fileId, userId: userBId });
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
    expect(listA[0]!.createdBy).toBe(userA.userId);
    expect(listB[0]!.createdBy).toBe(userBId);
  });

  it('update + delete refuse other-user annotations', async () => {
    const userA = await createTestWorkspaceWithUser(db);
    const userBId = await seedExtraUser(userA.workspaceId, `b-${userA.userId}@example.com`);
    const page = await createPage(db, {
      workspaceId: userA.workspaceId,
      createdBy: userA.userId,
      title: 'p',
    });
    const fileId = await seedPdfFile(userA, page.id);

    const a = await createAnnotation(db, {
      pageId: page.id,
      fileId,
      pageNumber: 1,
      rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
      kind: 'comment',
      content: 'a',
      createdBy: userA.userId,
    });

    await expect(
      updateAnnotation(db, { id: a.id, userId: userBId, content: 'tamper' }),
    ).rejects.toThrow(/not found/i);
    await expect(deleteAnnotation(db, { id: a.id, userId: userBId })).rejects.toThrow(
      /not found/i,
    );

    // confirm row still intact under userA
    const listA = await listAnnotations(db, { fileId, userId: userA.userId });
    expect(listA).toHaveLength(1);
    expect(listA[0]!.content).toBe('a');
  });
});
