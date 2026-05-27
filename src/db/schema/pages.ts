import {
  boolean,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

const bytea = customType<{ data: Buffer | null; default: false; notNull: false }>({
  dataType() {
    return 'bytea';
  },
});

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    title: text('title').notNull().default('Untitled'),
    icon: text('icon'),
    coverUrl: text('cover_url'),
    // v0.8.0 G7 P20 — richer cover descriptor (color | unsplash | upload).
    // `{}` means "no banner"; renderer prefers this over legacy `coverUrl`.
    cover: jsonb('cover').$type<unknown>().notNull().default({}),
    published: boolean('published').notNull().default(false),
    // v0.9.0 G1 P5 — load-bearing flag every page-content consumer (FTS,
    // embeddings, public share, webhooks, federated search) checks before
    // exposing `content_text` / `content`. Stays false for unencrypted pages.
    encrypted: boolean('encrypted').notNull().default(false),
    // v0.9.0 G1 P6 — ciphertext of TipTap doc JSON when encrypted=true.
    // Envelope: iv(12) || ct || tag(16). Null when encrypted=false.
    contentEncrypted: bytea('content_encrypted'),
    // v0.9.0 G1 P7 — workspace-wide mode discriminator. When true, the page's
    // DEK is the workspace WSK (see workspace_encryption_keys.wrapped_wsk);
    // when false but encrypted=true, the page uses per-page DEKs from
    // page_encryption_keys (P6 selective mode). Always false when encrypted=false.
    encryptedUnderWsk: boolean('encrypted_under_wsk').notNull().default(false),
    publicSlug: text('public_slug').unique(),
    linkPasswordHash: text('link_password_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    allowDuplication: boolean('allow_duplication').notNull().default(false),
    content: jsonb('content')
      .$type<unknown>()
      .notNull()
      .default({
        type: 'doc',
        content: [{ type: 'paragraph' }],
      }),
    // v0.8.0 G3 P8 — free-form per-page metadata (inbox flags, capturedAt,
    // sourceUrl, systemPage marker, etc). Defaults to {} so existing rows
    // and inserts that don't set it remain valid.
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    contentText: text('content_text').notNull().default(''),
    contentTsv: tsvector('content_tsv'),
    // v0.9.0 G2 P11 — optional grouping under a workspace-scoped space.
    // The FK is declared in 0040_spaces.sql (avoids a Drizzle circular import
    // between pages.ts and spaces.ts). Null = "Unfiled" in the sidebar.
    spaceId: uuid('space_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedRoot: boolean('deleted_root').notNull().default(false),
  },
  (t) => ({
    workspaceIdx: index('pages_workspace_idx').on(t.workspaceId),
    parentIdx: index('pages_parent_idx').on(t.parentId),
    tsvIdx: index('pages_content_tsv_idx').using('gin', t.contentTsv),
    // v0.9.0 G2 P11 — sidebar groups pages by space, so the lister filters by it.
    spaceIdx: index('pages_space_id_idx').on(t.spaceId),
  }),
);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
