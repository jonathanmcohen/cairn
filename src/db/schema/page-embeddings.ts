import { customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { workspaces } from './workspaces';

/**
 * pgvector `vector(N)` column type. drizzle-orm/pg-core has no built-in
 * `vector` builder; `customType` lets us name the SQL data type explicitly
 * and keep type inference on the TS side. The driver value is a
 * `number[]` (length N); pgvector accepts the canonical `[a,b,...]` string
 * form which postgres-js serializes from a JS array automatically.
 */
const vector = (name: string, dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
    // Serialize JS number[] → '[a,b,c]' string that pgvector parses.
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    // Parse the '[a,b,c]' string pgvector returns into number[].
    fromDriver(value: string): number[] {
      // Strip leading '[' and trailing ']' then split on commas.
      const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
      if (inner.length === 0) return [];
      return inner.split(',').map((s) => Number(s));
    },
  })(name);

export const pageEmbeddings = pgTable(
  'page_embeddings',
  {
    pageId: uuid('page_id')
      .primaryKey()
      .references(() => pages.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    embedding: vector('embedding', 384).notNull(),
    contentHash: text('content_hash').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // NB: the HNSW index on `embedding` is appended by hand to the generated SQL
    // (Drizzle has no `USING hnsw (... vector_cosine_ops)` builder). Only the
    // plain b-tree workspace_idx is declared here.
    byWorkspace: index('page_embeddings_workspace_idx').on(t.workspaceId),
  }),
);

export type PageEmbedding = typeof pageEmbeddings.$inferSelect;
export type NewPageEmbedding = typeof pageEmbeddings.$inferInsert;
export const PAGE_EMBEDDING_DIM = 384 as const;
