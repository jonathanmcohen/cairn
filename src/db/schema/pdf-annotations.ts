import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { files } from './files';
import { pages } from './pages';
import { users } from './users';

/**
 * Per-user PDF annotations for the `pdf` block (v0.9.0 G3 P17).
 *
 * `rect` stores normalized page-relative coordinates (each in [0,1]) so the
 * overlay scales with any zoom factor. `kind` is constrained to one of
 * `highlight | comment | shape` via both Drizzle's text-enum typing and a
 * Postgres CHECK constraint emitted in the migration SQL.
 *
 * Cascade semantics:
 *  - delete the file → all annotations vanish.
 *  - delete the page → same (file would normally cascade too via files.pageId,
 *    but the page_id link gives us an index-friendly path to "all annotations
 *    on this page" without joining files).
 *  - delete the user → that user's annotations vanish; their PDFs remain
 *    (`files.uploadedBy` is `restrict`).
 *
 * Multi-user collaborative annotation (shared overlay, Yjs-driven) is deferred
 * to v1.0; per the plan, list/update/delete always filter by `created_by =
 * userId` at the helper layer.
 */
export const pdfAnnotations = pgTable('pdf_annotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  pageNumber: integer('page_number').notNull(),
  rect: jsonb('rect').$type<{ x: number; y: number; w: number; h: number }>().notNull(),
  kind: text('kind', { enum: ['highlight', 'comment', 'shape'] }).notNull(),
  content: text('content'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PdfAnnotationRow = typeof pdfAnnotations.$inferSelect;
export type NewPdfAnnotation = typeof pdfAnnotations.$inferInsert;
