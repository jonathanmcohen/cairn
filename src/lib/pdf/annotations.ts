import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { AnnotationKind, Rect } from './schema';

type Db = PostgresJsDatabase<typeof schema>;

export type AnnotationRow = {
  id: string;
  pageId: string;
  fileId: string;
  pageNumber: number;
  rect: Rect;
  kind: AnnotationKind;
  content: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Per-user list: every list/update/delete predicate filters by
 * `created_by = userId` so a user can never see another user's annotations
 * via this layer (multi-user co-annotation is deferred to v1.0).
 */
export async function listAnnotations(
  db: Db,
  input: { fileId: string; userId: string },
): Promise<AnnotationRow[]> {
  const rows = await db
    .select()
    .from(schema.pdfAnnotations)
    .where(
      and(
        eq(schema.pdfAnnotations.fileId, input.fileId),
        eq(schema.pdfAnnotations.createdBy, input.userId),
      ),
    );
  return rows as AnnotationRow[];
}

export async function createAnnotation(
  db: Db,
  input: {
    pageId: string;
    fileId: string;
    pageNumber: number;
    rect: Rect;
    kind: AnnotationKind;
    content: string | null;
    createdBy: string;
  },
): Promise<AnnotationRow> {
  const [row] = await db.insert(schema.pdfAnnotations).values(input).returning();
  if (!row) throw new Error('annotation insert returned no row');
  return row as AnnotationRow;
}

export async function updateAnnotation(
  db: Db,
  input: { id: string; userId: string; rect?: Rect; content?: string | null },
): Promise<AnnotationRow> {
  const [row] = await db
    .update(schema.pdfAnnotations)
    .set({
      ...(input.rect !== undefined ? { rect: input.rect } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.pdfAnnotations.id, input.id),
        eq(schema.pdfAnnotations.createdBy, input.userId),
      ),
    )
    .returning();
  if (!row) throw new Error('annotation not found');
  return row as AnnotationRow;
}

export async function deleteAnnotation(
  db: Db,
  input: { id: string; userId: string },
): Promise<void> {
  const result = await db
    .delete(schema.pdfAnnotations)
    .where(
      and(
        eq(schema.pdfAnnotations.id, input.id),
        eq(schema.pdfAnnotations.createdBy, input.userId),
      ),
    )
    .returning({ id: schema.pdfAnnotations.id });
  if (result.length === 0) throw new Error('annotation not found');
}
