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
  if (!file) throw new Error('seedPdfFile: insert failed');
  return file.id;
}

describe('pdf annotations CRUD', () => {
  it('roundtrips create + list', async () => {
    const user = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: user.workspaceId,
      createdBy: user.userId,
      title: 'p',
    });
    const fileId = await seedPdfFile(user, page.id);

    const created = await createAnnotation(db, {
      pageId: page.id,
      fileId,
      pageNumber: 1,
      rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
      kind: 'highlight',
      content: null,
      createdBy: user.userId,
    });
    const list = await listAnnotations(db, { fileId, userId: user.userId });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);
    expect(list[0]!.rect.w).toBeCloseTo(0.2);
    expect(list[0]!.kind).toBe('highlight');
  });

  it('updates and deletes only the caller-owned annotation', async () => {
    const user = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: user.workspaceId,
      createdBy: user.userId,
      title: 'p',
    });
    const fileId = await seedPdfFile(user, page.id);

    const a = await createAnnotation(db, {
      pageId: page.id,
      fileId,
      pageNumber: 1,
      rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
      kind: 'comment',
      content: 'hi',
      createdBy: user.userId,
    });
    const updated = await updateAnnotation(db, {
      id: a.id,
      userId: user.userId,
      content: 'edited',
    });
    expect(updated.content).toBe('edited');

    await deleteAnnotation(db, { id: a.id, userId: user.userId });
    expect(await listAnnotations(db, { fileId, userId: user.userId })).toHaveLength(0);
  });

  it('update of an unknown id throws "not found"', async () => {
    const user = await createTestWorkspaceWithUser(db);
    await expect(
      updateAnnotation(db, {
        id: '00000000-0000-0000-0000-000000000000',
        userId: user.userId,
        content: 'x',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('delete of an unknown id throws "not found"', async () => {
    const user = await createTestWorkspaceWithUser(db);
    await expect(
      deleteAnnotation(db, { id: '00000000-0000-0000-0000-000000000000', userId: user.userId }),
    ).rejects.toThrow(/not found/i);
  });
});
