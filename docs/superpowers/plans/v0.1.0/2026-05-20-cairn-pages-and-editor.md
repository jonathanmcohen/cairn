# Cairn Pages & Block Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the core "Cairn feels like Cairn" experience: create, nest, rename, navigate, edit, and (soft) delete pages with a TipTap block editor. After this plan, an authed user can write actual notes in nested pages, with autosave persisting their work.

**Architecture:** The `pages` table is the heart of this plan. Pages form a tree via `parent_id` self-reference; content lives as ProseMirror/TipTap JSON in `pages.content` (jsonb). The sidebar renders the tree server-side; the page route renders a client editor that PATCHes the document on debounced save. Search-related columns (`content_text`, `content_tsv`) and a trigger are added now for forward-compat with Plan 3, but Plan 2 builds no search UI. Soft delete (`deleted_at`) is implemented end-to-end so Plan 3's trash bin layers on without rework.

**Tech Stack additions:** `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-placeholder`, `@tiptap/extension-character-count`, `@tiptap/extension-code-block-lowlight`, `lowlight`, `tippy.js` (TipTap suggestion plugin dep), `emoji-picker-element` (or equivalent).

---

## What's in scope for Plan 2

- `pages` table (with FTS columns + trigger for Plan 3 forward-compat) and migration
- Page CRUD: create, read, update (autosave), soft-delete, move (reparent/reorder)
- Sidebar page tree (nested, expandable)
- New-page button + dashboard "create your first page" CTA
- Page route `/pages/[pageId]` with inline title rename and emoji icon picker
- TipTap editor with these block types ONLY:
  - paragraph, H1, H2, H3
  - bullet list, numbered list, task list
  - blockquote
  - callout (custom, 4 colors)
  - code block (lowlight syntax highlighting)
  - horizontal divider
- Slash menu (`/`) to insert any of the above
- Drag handle on the left of each block (move, duplicate, delete)
- Autosave (debounced 800 ms, optimistic UI, conflict warning on stale write)
- Keyboard shortcuts: ⌘N (new page), ⌘/ (slash menu in editor), ⌘B/I/U (inline format)

## What's explicitly NOT in this plan

- **Search** — Plan 3 (FTS columns/trigger are added now, but no search UI)
- **Trash bin view + 30-day auto-purge** — Plan 3 (soft-delete data shape lands now)
- **Image/file blocks, cover images, file uploads** — Plan 4
- **Markdown import/export** — Plan 4
- **Database blocks (inline databases)** — Plan 5
- **Release workflow (tag → ghcr.io publish)** — Plan 6
- **Page version history, real-time collab** — explicitly deferred per spec

---

## File structure produced by this plan

```
cairn/
├── drizzle/
│   └── migrations/
│       ├── 0003_pages.sql                  # NEW
│       └── meta/...                        # journal + snapshot updates
├── src/
│   ├── app/
│   │   ├── (app)/
│   │   │   ├── layout.tsx                  # MODIFIED — wire page tree into sidebar
│   │   │   ├── page.tsx                    # MODIFIED — "create your first page" CTA
│   │   │   └── pages/
│   │   │       └── [pageId]/
│   │   │           ├── page.tsx            # NEW — server component; loads page; mounts editor
│   │   │           └── not-found.tsx       # NEW
│   │   └── api/
│   │       └── pages/
│   │           ├── route.ts                # NEW — POST create
│   │           └── [pageId]/
│   │               ├── route.ts            # NEW — GET, PATCH, DELETE
│   │               └── move/route.ts       # NEW — POST move (reparent/reorder)
│   ├── components/
│   │   ├── editor/
│   │   │   ├── editor.tsx                  # NEW — client component, TipTap mount, autosave
│   │   │   ├── extensions.ts               # NEW — TipTap extensions wiring
│   │   │   ├── callout-extension.ts        # NEW — custom block node
│   │   │   ├── slash-menu.tsx              # NEW — slash command popover
│   │   │   └── drag-handle.tsx             # NEW — drag handle plugin
│   │   ├── sidebar.tsx                     # MODIFIED — render PageTree
│   │   ├── sidebar-tree.tsx                # NEW — recursive page tree (server component)
│   │   ├── new-page-button.tsx             # NEW — client component, POST then router.push
│   │   ├── page-title-input.tsx            # NEW — client inline-rename input
│   │   └── icon-picker.tsx                 # NEW — emoji picker popover
│   ├── db/
│   │   └── schema/
│   │       ├── pages.ts                    # NEW
│   │       └── index.ts                    # MODIFIED — re-export pages
│   └── lib/
│       ├── auth/
│       │   └── require-role.ts             # MODIFIED — wrap getAuthContext in react cache()
│       ├── pages/
│       │   ├── access.ts                   # NEW — requirePageAccess(pageId, role)
│       │   ├── create.ts                   # NEW — createPage()
│       │   ├── update.ts                   # NEW — updatePage()
│       │   ├── delete.ts                   # NEW — softDeletePage()
│       │   ├── move.ts                     # NEW — movePage()
│       │   ├── tree.ts                     # NEW — getPageTree()
│       │   ├── get.ts                      # NEW — getPage()
│       │   └── empty-document.ts           # NEW — empty ProseMirror JSON helper
│       └── editor/
│           └── plain-text.ts               # NEW — extract flat text from ProseMirror JSON
├── tests/
│   ├── helpers/
│   │   └── fixtures.ts                     # NEW — createTestWorkspace, etc.
│   ├── db/
│   │   └── pages-schema.test.ts            # NEW
│   ├── lib/
│   │   ├── pages/
│   │   │   ├── create.test.ts              # NEW
│   │   │   ├── update.test.ts              # NEW
│   │   │   ├── delete.test.ts              # NEW
│   │   │   ├── move.test.ts                # NEW
│   │   │   ├── tree.test.ts                # NEW
│   │   │   ├── access.test.ts              # NEW
│   │   │   └── get.test.ts                 # NEW
│   │   └── editor/
│   │       └── plain-text.test.ts          # NEW
│   └── api/
│       ├── pages-create.test.ts            # NEW
│       ├── pages-rud.test.ts               # NEW   (read / update / delete)
│       └── pages-move.test.ts              # NEW
└── next.config.mjs                         # MODIFIED — fix typedRoutes deprecation
```

---

## Conventions

- Same as Plan 1: `pnpm` only, TDD where there's logic, frequent commits, Conventional Commits.
- Subagents: prefix shell with `source ~/.zshenv && ` (PATH for pnpm/node, DOCKER_HOST for testcontainers).
- Do NOT push commits; the controller pushes when the user asks.
- Every API route uses `requireRole` and `requirePageAccess` (defense in depth: workspace scope + role).

---

## Task 1: Plan-1 follow-ups (cache() wrap + typedRoutes fix)

**Goal:** Two small forward-fit fixes flagged during Plan 1 reviews, so Plan 2's many `(app)/...` routes don't pay double DB cost and the dev server stops warning about typedRoutes.

**Files:**
- Modify: `src/lib/auth/require-role.ts`
- Modify: `next.config.mjs`

- [x] **Step 1: Wrap `getAuthContext` in React `cache()`**

Read the current file. Add `import { cache } from 'react';` and wrap the body:

```ts
import { cache } from 'react';
// ... existing imports ...

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const { auth } = await import('./config');
  const session = await auth();
  if (!session?.user?.id) return null;
  const db = getDb();
  const [m] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, session.user.id))
    .limit(1);
  if (!m) return null;
  return { userId: session.user.id, workspaceId: m.workspaceId, role: m.role };
});
```

Note: `cache()` is a Next.js / React Server Components helper. It dedupes calls within the same request. Multiple server components calling `getAuthContext()` in one render now share a single DB hit.

- [x] **Step 2: Verify tests still pass**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test
```

Expected: 32/32 still passing. `getAuthContext` is exercised indirectly by `require-role` unit tests and integration tests; the cache wrapper is transparent.

- [x] **Step 3: Fix `next.config.mjs` typedRoutes deprecation**

Replace:
```js
experimental: {
  typedRoutes: true,
},
```
with:
```js
typedRoutes: true,
```

(Remove the `experimental` block entirely if it has no other keys.)

- [x] **Step 4: Verify build is warning-free**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm build 2>&1 | grep -i typedRoutes
```

Expected: no output. (Previously it warned `experimental.typedRoutes has been moved to typedRoutes`.)

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/auth/require-role.ts next.config.mjs && \
  git commit -m "chore: wrap getAuthContext in cache(); hoist typedRoutes out of experimental"
```

---

## Task 2: Test fixtures helper

**Goal:** Extract the test-setup boilerplate (create workspace + user + member) into a reusable helper so Plan 2's many tests don't repeat the same 15 lines.

**Files:**
- Create: `tests/helpers/fixtures.ts`

- [x] **Step 1: Write `tests/helpers/fixtures.ts`**

```ts
import { randomBytes } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

let counter = 0;

function uniqueSlug(prefix = 'ws'): string {
  counter += 1;
  return `${prefix}-${counter}-${randomBytes(3).toString('hex')}`;
}

export type TestUser = {
  workspaceId: string;
  userId: string;
  role: schema.MemberRole;
};

/**
 * Create a workspace + user + membership in one go, for tests.
 * Returns ids ready to plug into requireRole-mocked sessions.
 */
export async function createTestWorkspaceWithUser(
  db: PostgresJsDatabase<typeof schema>,
  opts: { role?: schema.MemberRole; email?: string; workspaceName?: string } = {},
): Promise<TestUser> {
  const role = opts.role ?? 'owner';
  const slug = uniqueSlug();
  const name = opts.workspaceName ?? `Workspace ${slug}`;
  const email = opts.email ?? `${role}-${slug}@example.com`;

  const [ws] = await db.insert(schema.workspaces).values({ name, slug }).returning();
  if (!ws) throw new Error('failed to create workspace');
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: role })
    .returning();
  if (!u) throw new Error('failed to create user');
  await db.insert(schema.workspaceMembers).values({ workspaceId: ws.id, userId: u.id, role });

  return { workspaceId: ws.id, userId: u.id, role };
}
```

- [x] **Step 2: Verify the helper compiles and lints**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck
```

Both clean.

- [x] **Step 3: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add tests/helpers/fixtures.ts && \
  git commit -m "test: createTestWorkspaceWithUser fixture helper"
```

---

## Task 3: Pages schema + FTS columns + migration

**Goal:** Define `pages` table with all columns the spec calls for, including the FTS columns (`content_text`, `content_tsv`) and `deleted_root` for cascade-aware restore. Trigger keeps `content_text`/`content_tsv` in sync on every write.

**Files:**
- Create: `src/db/schema/pages.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/db/pages-schema.test.ts`
- Generate: `drizzle/migrations/0003_*.sql` (filename varies by drizzle-kit)

- [x] **Step 1: Write failing test `tests/db/pages-schema.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';
import * as schema from '@/db/schema';

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, invite_tokens, sessions, accounts RESTART IDENTITY CASCADE`;
});

describe('pages schema', () => {
  it('inserts a page with content jsonb and defaults', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({
        workspaceId: u.workspaceId,
        title: 'Hello',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        createdBy: u.userId,
      })
      .returning();
    if (!p) throw new Error('insert failed');
    expect(p.parentId).toBeNull();
    expect(p.deletedAt).toBeNull();
    expect(p.deletedRoot).toBe(false);
    expect(p.icon).toBeNull();
  });

  it('updates content_text and content_tsv via trigger on insert', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db.insert(schema.pages).values({
      workspaceId: u.workspaceId,
      title: 'Meeting Notes',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Discuss roadmap' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Action items' }] },
        ],
      },
      createdBy: u.userId,
    });
    const [row] = await sql<{ content_text: string; tsv_count: number }[]>`
      SELECT content_text, length(content_tsv::text) AS tsv_count FROM pages LIMIT 1
    `;
    expect(row?.content_text).toContain('Discuss roadmap');
    expect(row?.content_text).toContain('Action items');
    expect(Number(row?.tsv_count)).toBeGreaterThan(0);
  });

  it('cascades parent → child on parent delete', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [parent] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'Parent', createdBy: u.userId })
      .returning();
    if (!parent) throw new Error('insert failed');
    await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'Child', parentId: parent.id, createdBy: u.userId });
    await db.delete(schema.pages).where(eq(schema.pages.id, parent.id));
    const rows = await db.select().from(schema.pages);
    expect(rows).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run, verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/db/pages-schema.test.ts
```

Expected: FAIL — `schema.pages` undefined.

- [x] **Step 3: Write `src/db/schema/pages.ts`**

```ts
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
    content: jsonb('content').$type<unknown>().notNull().default({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }),
    contentText: text('content_text').notNull().default(''),
    contentTsv: tsvector('content_tsv'),
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
  }),
);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
```

Note: `parentId` references `pages.id` recursively — Drizzle doesn't currently model self-FKs cleanly in the table-config callback, so we add the FK constraint manually in the migration step below.

- [x] **Step 4: Update `src/db/schema/index.ts`**

```ts
export * from './workspaces';
export * from './users';
export * from './workspace-members';
export * from './invite-tokens';
export * from './auth';
export * from './pages';
```

- [x] **Step 5: Generate migration**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  DATABASE_URL=postgres://cairn:cairn@localhost:5432/cairn pnpm db:generate
```

A new `0003_*.sql` file is created. Open it.

- [x] **Step 6: Append the self-FK + trigger + plain-text extraction function to the migration**

Edit the new `drizzle/migrations/0003_*.sql` file. AFTER all the `CREATE TABLE` / `CREATE INDEX` statements that drizzle-kit produced, append:

```sql
--> statement-breakpoint
-- Self-referential FK on parent_id (drizzle-kit can't model self-FKs in callback form).
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_id_pages_id_fk"
   FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
-- Extract plain text from a ProseMirror JSON document, concatenating all `text` nodes.
CREATE OR REPLACE FUNCTION pages_extract_text(doc jsonb) RETURNS text AS $$
DECLARE
  out_text text := '';
  txt text;
BEGIN
  -- Walk the json tree: any node with type='text' contributes its `text` value.
  FOR txt IN
    SELECT (node->>'text')::text
    FROM jsonb_path_query(doc, '$.**.text ? (@ != null)') AS node
  LOOP
    IF txt IS NOT NULL AND txt <> '' THEN
      out_text := out_text || ' ' || txt;
    END IF;
  END LOOP;
  RETURN trim(out_text);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

--> statement-breakpoint
-- Trigger that derives content_text + content_tsv from content + title on every write.
CREATE OR REPLACE FUNCTION pages_sync_search_columns() RETURNS trigger AS $$
BEGIN
  NEW.content_text := pages_extract_text(NEW.content);
  NEW.content_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.content_text, '')), 'B');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
DROP TRIGGER IF EXISTS pages_search_sync_trigger ON pages;
CREATE TRIGGER pages_search_sync_trigger
  BEFORE INSERT OR UPDATE OF title, content ON pages
  FOR EACH ROW EXECUTE FUNCTION pages_sync_search_columns();
```

Note: `pages_extract_text` uses a recursive `jsonb_path_query` to find every `text` field at any depth. This is the canonical Postgres pattern for walking ProseMirror JSON.

- [x] **Step 7: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/db/pages-schema.test.ts
```

Expected: 3 passed.

If the trigger SQL has a syntax error, the migration will fail at apply time. Read the error and fix. Common issues:
- `jsonb_path_query` requires Postgres 12+ (we use 16, so fine).
- `setweight(to_tsvector('english', ...), 'A')` — `to_tsvector` requires the dictionary name as the first arg; ours is 'english' which is built-in.

- [x] **Step 8: Lint + typecheck + full test suite**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck && pnpm test
```

All exit 0. Existing 32 tests still pass; new 3 added → 35.

- [x] **Step 9: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/db/schema/ drizzle/ tests/db/pages-schema.test.ts && \
  git commit -m "feat: pages schema with FTS trigger and self-referential parent"
```

---

## Task 4: requirePageAccess helper

**Goal:** A helper that, given a `pageId` and minimum role, validates the caller has that role IN the page's workspace AND returns both the page and the auth context. Every page-API route uses it.

**Files:**
- Create: `src/lib/pages/access.ts`
- Create: `tests/lib/pages/access.test.ts`

- [x] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let uri = '';

beforeAll(async () => {
  uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function asUser(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: { userId: string } | null) => void };
  mod.__set({ userId });
}

describe('requirePageAccess', () => {
  it('returns page + ctx when user is in the workspace with sufficient role', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('insert failed');
    await asUser(u.userId);
    const { requirePageAccess } = await import('@/lib/pages/access');
    const result = await requirePageAccess(p.id, 'editor');
    expect(result.page.id).toBe(p.id);
    expect(result.ctx.role).toBe('editor');
  });

  it('throws 404 when page does not exist', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await asUser(u.userId);
    const { requirePageAccess } = await import('@/lib/pages/access');
    await expect(
      requirePageAccess('00000000-0000-0000-0000-000000000000', 'viewer'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('throws 404 when page is in a different workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: b.workspaceId, title: 'P', createdBy: b.userId })
      .returning();
    if (!p) throw new Error('insert failed');
    await asUser(a.userId);
    const { requirePageAccess } = await import('@/lib/pages/access');
    await expect(requirePageAccess(p.id, 'viewer')).rejects.toMatchObject({ status: 404 });
  });

  it('throws 403 when role is insufficient', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'viewer' });
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('insert failed');
    await asUser(u.userId);
    const { requirePageAccess } = await import('@/lib/pages/access');
    await expect(requirePageAccess(p.id, 'editor')).rejects.toMatchObject({ status: 403 });
  });

  it('throws 401 when unauthenticated', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('insert failed');
    await asUser('');
    const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: null) => void };
    mod.__set(null);
    const { requirePageAccess } = await import('@/lib/pages/access');
    await expect(requirePageAccess(p.id, 'viewer')).rejects.toMatchObject({ status: 401 });
  });
});
```

- [x] **Step 2: Run, verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/access.test.ts
```

- [x] **Step 3: Write `src/lib/pages/access.ts`**

```ts
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, hasMinRole, type AuthContext, type MemberRole } from '@/lib/auth/require-role';
import { getAuthContext } from '@/lib/auth/require-role';

export type PageAccess = {
  page: schema.Page;
  ctx: AuthContext;
};

export async function requirePageAccess(pageId: string, required: MemberRole): Promise<PageAccess> {
  const ctx = await getAuthContext();
  if (!ctx) throw new HttpError(401, 'Not authenticated');

  const db = getDb();
  const [page] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId)).limit(1);
  if (!page) throw new HttpError(404, 'Page not found');
  if (page.workspaceId !== ctx.workspaceId) {
    // Same status as not-found to avoid leaking page existence across workspaces.
    throw new HttpError(404, 'Page not found');
  }
  if (!hasMinRole(ctx.role, required)) {
    throw new HttpError(403, `Requires role ${required}`);
  }
  return { page, ctx };
}
```

- [x] **Step 4: Run tests, verify pass**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/access.test.ts
```

Expected: 5 passed.

- [x] **Step 5: Lint + typecheck**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck
```

- [x] **Step 6: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/access.ts tests/lib/pages/access.test.ts && \
  git commit -m "feat: requirePageAccess (workspace-scoped + role gate)"
```

---

## Task 5: createPage helper

**Goal:** Pure function that creates a new page with default empty content and returns the row.

**Files:**
- Create: `src/lib/pages/empty-document.ts`
- Create: `src/lib/pages/create.ts`
- Create: `tests/lib/pages/create.test.ts`

- [x] **Step 1: Write `src/lib/pages/empty-document.ts`**

```ts
// Minimal valid ProseMirror document for a fresh page.
export type ProseMirrorDoc = {
  type: 'doc';
  content?: Array<Record<string, unknown>>;
};

export function emptyDocument(): ProseMirrorDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}
```

- [x] **Step 2: Write failing test `tests/lib/pages/create.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('createPage', () => {
  it('creates a top-level page with default title and empty content', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    expect(page.title).toBe('Untitled');
    expect(page.parentId).toBeNull();
    expect((page.content as { type: string }).type).toBe('doc');
    expect(page.contentText).toBe('');
  });

  it('creates a nested page under a parent', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const parent = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const child = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: parent.id,
      title: 'Child',
    });
    expect(child.parentId).toBe(parent.id);
    expect(child.title).toBe('Child');
  });

  it('rejects a parent in a different workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const foreign = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await expect(
      createPage(db, {
        workspaceId: a.workspaceId,
        createdBy: a.userId,
        parentId: foreign.id,
      }),
    ).rejects.toThrow(/parent.*workspace/i);
  });
});
```

- [x] **Step 3: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/create.test.ts
```

- [x] **Step 4: Write `src/lib/pages/create.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { emptyDocument } from './empty-document';

export type CreatePageInput = {
  workspaceId: string;
  createdBy: string;
  parentId?: string;
  title?: string;
  icon?: string | null;
};

export async function createPage(
  db: PostgresJsDatabase<typeof schema>,
  input: CreatePageInput,
): Promise<schema.Page> {
  return db.transaction(async (tx) => {
    if (input.parentId) {
      const [parent] = await tx
        .select({ workspaceId: schema.pages.workspaceId })
        .from(schema.pages)
        .where(and(eq(schema.pages.id, input.parentId), eq(schema.pages.workspaceId, input.workspaceId)))
        .limit(1);
      if (!parent) {
        throw new Error('parent page is missing or belongs to a different workspace');
      }
    }
    const [page] = await tx
      .insert(schema.pages)
      .values({
        workspaceId: input.workspaceId,
        parentId: input.parentId ?? null,
        title: input.title ?? 'Untitled',
        icon: input.icon ?? null,
        content: emptyDocument(),
        createdBy: input.createdBy,
      })
      .returning();
    if (!page) throw new Error('failed to insert page');
    return page;
  });
}
```

- [x] **Step 5: Run tests, verify pass**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/create.test.ts
```

Expected: 3 passed.

- [x] **Step 6: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/empty-document.ts src/lib/pages/create.ts tests/lib/pages/create.test.ts && \
  git commit -m "feat: createPage helper with workspace-scoped parent validation"
```

---

## Task 6: getPage + getPageTree helpers

**Goal:** Read paths that the sidebar and page route depend on. Both filter out soft-deleted pages by default.

**Files:**
- Create: `src/lib/pages/get.ts`
- Create: `src/lib/pages/tree.ts`
- Create: `tests/lib/pages/get.test.ts`
- Create: `tests/lib/pages/tree.test.ts`

- [x] **Step 1: Write failing test `tests/lib/pages/get.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { getPage } from '@/lib/pages/get';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('getPage', () => {
  it('returns the page when it belongs to the workspace and is not deleted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'X' });
    const found = await getPage(db, { pageId: p.id, workspaceId: u.workspaceId });
    expect(found?.id).toBe(p.id);
  });

  it('returns null when the page is in a different workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    const found = await getPage(db, { pageId: p.id, workspaceId: a.workspaceId });
    expect(found).toBeNull();
  });

  it('returns null for soft-deleted pages by default', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await sql`UPDATE pages SET deleted_at = now() WHERE id = ${p.id}`;
    const found = await getPage(db, { pageId: p.id, workspaceId: u.workspaceId });
    expect(found).toBeNull();
  });
});
```

- [x] **Step 2: Write failing test `tests/lib/pages/tree.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { getPageTree } from '@/lib/pages/tree';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('getPageTree', () => {
  it('returns an empty array when no pages exist', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const tree = await getPageTree(db, u.workspaceId);
    expect(tree).toEqual([]);
  });

  it('returns a flat list of top-level pages with empty children', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    const tree = await getPageTree(db, u.workspaceId);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it('nests children under parents', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Root' });
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, parentId: root.id, title: 'C1' });
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, parentId: root.id, title: 'C2' });
    const tree = await getPageTree(db, u.workspaceId);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toHaveLength(2);
    expect(tree[0]?.children.map((c) => c.title).sort()).toEqual(['C1', 'C2']);
  });

  it('excludes soft-deleted pages', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'V' });
    await sql`UPDATE pages SET deleted_at = now() WHERE id = ${p.id}`;
    const tree = await getPageTree(db, u.workspaceId);
    expect(tree).toEqual([]);
  });
});
```

- [x] **Step 3: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/get.test.ts tests/lib/pages/tree.test.ts
```

- [x] **Step 4: Write `src/lib/pages/get.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export async function getPage(
  db: PostgresJsDatabase<typeof schema>,
  args: { pageId: string; workspaceId: string },
): Promise<schema.Page | null> {
  const [row] = await db
    .select()
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.id, args.pageId),
        eq(schema.pages.workspaceId, args.workspaceId),
        isNull(schema.pages.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
```

- [x] **Step 5: Write `src/lib/pages/tree.ts`**

```ts
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type PageTreeNode = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  children: PageTreeNode[];
};

export async function getPageTree(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<PageTreeNode[]> {
  const rows = await db
    .select({
      id: schema.pages.id,
      parentId: schema.pages.parentId,
      title: schema.pages.title,
      icon: schema.pages.icon,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt)))
    .orderBy(asc(schema.pages.createdAt));

  const byId = new Map<string, PageTreeNode>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }
  const roots: PageTreeNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    if (row.parentId) {
      const parent = byId.get(row.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node); // orphan defensively becomes a root
    } else {
      roots.push(node);
    }
  }
  return roots;
}
```

- [x] **Step 6: Run tests, verify pass**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/
```

Expected: 3 + 4 = 7 passed in these files.

- [x] **Step 7: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/get.ts src/lib/pages/tree.ts tests/lib/pages/get.test.ts tests/lib/pages/tree.test.ts && \
  git commit -m "feat: getPage and getPageTree helpers (exclude soft-deleted)"
```

---

## Task 7: updatePage helper with conflict detection

**Goal:** Update title/icon/content of a page. Returns the updated row. Detects stale writes via `If-Match`-style `expectedUpdatedAt` parameter and rejects with a conflict error if the server is newer.

**Files:**
- Create: `src/lib/pages/update.ts`
- Create: `tests/lib/pages/update.test.ts`

- [x] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { updatePage, PageConflictError } from '@/lib/pages/update';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('updatePage', () => {
  it('updates title and returns updated row', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Old' });
    const updated = await updatePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: { title: 'New' },
    });
    expect(updated.title).toBe('New');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(p.updatedAt.getTime());
  });

  it('updates content and rebuilds content_text via trigger', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const updated = await updatePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: {
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
        },
      },
    });
    expect(updated.contentText).toContain('Hello world');
  });

  it('updates icon to a new emoji', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const updated = await updatePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: { icon: '🐉' },
    });
    expect(updated.icon).toBe('🐉');
  });

  it('rejects writes with stale expectedUpdatedAt', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await updatePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: { title: 'First' },
    });
    await expect(
      updatePage(db, {
        pageId: p.id,
        workspaceId: u.workspaceId,
        patch: { title: 'Second' },
        expectedUpdatedAt: p.updatedAt, // stale
      }),
    ).rejects.toBeInstanceOf(PageConflictError);
  });

  it('fails to update a page in another workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await expect(
      updatePage(db, {
        pageId: p.id,
        workspaceId: a.workspaceId,
        patch: { title: 'X' },
      }),
    ).rejects.toThrow(/not found/i);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/update.test.ts
```

- [x] **Step 3: Write `src/lib/pages/update.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export class PageConflictError extends Error {
  constructor(message = 'Page has been modified since you last read it') {
    super(message);
    this.name = 'PageConflictError';
  }
}

export type UpdatePageInput = {
  pageId: string;
  workspaceId: string;
  patch: Partial<{
    title: string;
    icon: string | null;
    content: unknown;
  }>;
  expectedUpdatedAt?: Date;
};

export async function updatePage(
  db: PostgresJsDatabase<typeof schema>,
  input: UpdatePageInput,
): Promise<schema.Page> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, input.pageId),
          eq(schema.pages.workspaceId, input.workspaceId),
          isNull(schema.pages.deletedAt),
        ),
      )
      .limit(1);
    if (!current) throw new Error('Page not found');
    if (input.expectedUpdatedAt && current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new PageConflictError();
    }

    const values: Partial<schema.NewPage> = {};
    if (input.patch.title !== undefined) values.title = input.patch.title;
    if (input.patch.icon !== undefined) values.icon = input.patch.icon;
    if (input.patch.content !== undefined) values.content = input.patch.content as never;

    const [updated] = await tx
      .update(schema.pages)
      .set(values)
      .where(eq(schema.pages.id, current.id))
      .returning();
    if (!updated) throw new Error('Update returned no row');
    return updated;
  });
}
```

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/update.test.ts
```

Expected: 5 passed.

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/update.ts tests/lib/pages/update.test.ts && \
  git commit -m "feat: updatePage with stale-write conflict detection"
```

---

## Task 8: softDeletePage with cascade

**Goal:** Marks a page and all descendants as deleted. Sets `deleted_root=true` on the explicitly-deleted page only (descendants get `deleted_root=false`) so a future restore in Plan 3 can scope correctly.

**Files:**
- Create: `src/lib/pages/delete.ts`
- Create: `tests/lib/pages/delete.test.ts`

- [x] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('softDeletePage', () => {
  it('marks the page and its descendants as deleted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'Root' });
    const child = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'Child',
    });
    const grand = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: child.id,
      title: 'Grand',
    });

    await softDeletePage(db, { pageId: root.id, workspaceId: u.workspaceId });

    const rows = await db.select().from(schema.pages);
    for (const r of rows) {
      expect(r.deletedAt).not.toBeNull();
    }
    const rootRow = rows.find((r) => r.id === root.id);
    const childRow = rows.find((r) => r.id === child.id);
    const grandRow = rows.find((r) => r.id === grand.id);
    expect(rootRow?.deletedRoot).toBe(true);
    expect(childRow?.deletedRoot).toBe(false);
    expect(grandRow?.deletedRoot).toBe(false);
  });

  it('does not touch sibling subtrees', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    await softDeletePage(db, { pageId: a.id, workspaceId: u.workspaceId });
    const [bRow] = await db.select().from(schema.pages).where(eq(schema.pages.id, b.id));
    expect(bRow?.deletedAt).toBeNull();
  });

  it('throws if the page is in another workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await expect(
      softDeletePage(db, { pageId: p.id, workspaceId: a.workspaceId }),
    ).rejects.toThrow(/not found/i);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/delete.test.ts
```

- [x] **Step 3: Write `src/lib/pages/delete.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql as rawSql } from 'drizzle-orm';
import * as schema from '@/db/schema';

export type SoftDeleteInput = {
  pageId: string;
  workspaceId: string;
};

export async function softDeletePage(
  db: PostgresJsDatabase<typeof schema>,
  input: SoftDeleteInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Verify the page exists in this workspace.
    const [target] = await tx.execute<{ id: string }>(rawSql`
      SELECT id FROM pages
      WHERE id = ${input.pageId}
        AND workspace_id = ${input.workspaceId}
        AND deleted_at IS NULL
      LIMIT 1
    `);
    if (!target) throw new Error('Page not found');

    // Recursive CTE: collect target + all descendants.
    await tx.execute(rawSql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE id = ${input.pageId}
        UNION ALL
        SELECT p.id FROM pages p
        INNER JOIN descendants d ON p.parent_id = d.id
        WHERE p.deleted_at IS NULL
      )
      UPDATE pages
      SET deleted_at = now(),
          deleted_root = (id = ${input.pageId})
      WHERE id IN (SELECT id FROM descendants);
    `);
  });
}
```

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/delete.test.ts
```

Expected: 3 passed.

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/delete.ts tests/lib/pages/delete.test.ts && \
  git commit -m "feat: softDeletePage with recursive cascade and deleted_root flag"
```

---

## Task 9: movePage (reparent + ordering)

**Goal:** Re-attach a page under a new `parentId` (or null for top-level). Reject moves that would create a cycle (page becoming descendant of itself).

For v0.1.0 we use creation-order for sibling ordering — explicit reordering UI is deferred. `movePage` only handles reparenting.

**Files:**
- Create: `src/lib/pages/move.ts`
- Create: `tests/lib/pages/move.test.ts`

- [x] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { movePage } from '@/lib/pages/move';
import * as schema from '@/db/schema';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';
import { eq } from 'drizzle-orm';

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('movePage', () => {
  it('reparents a page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    await movePage(db, { pageId: b.id, workspaceId: u.workspaceId, newParentId: a.id });
    const [moved] = await db.select().from(schema.pages).where(eq(schema.pages.id, b.id));
    expect(moved?.parentId).toBe(a.id);
  });

  it('moves a page to top-level when newParentId is null', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: a.id,
      title: 'B',
    });
    await movePage(db, { pageId: b.id, workspaceId: u.workspaceId, newParentId: null });
    const [moved] = await db.select().from(schema.pages).where(eq(schema.pages.id, b.id));
    expect(moved?.parentId).toBeNull();
  });

  it('rejects a cyclic move (parent under its own descendant)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: a.id,
      title: 'B',
    });
    await expect(
      movePage(db, { pageId: a.id, workspaceId: u.workspaceId, newParentId: b.id }),
    ).rejects.toThrow(/cycle/i);
  });

  it('rejects moving to a parent in a different workspace', async () => {
    const x = await createTestWorkspaceWithUser(db);
    const y = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: x.workspaceId, createdBy: x.userId });
    const foreign = await createPage(db, { workspaceId: y.workspaceId, createdBy: y.userId });
    await expect(
      movePage(db, { pageId: p.id, workspaceId: x.workspaceId, newParentId: foreign.id }),
    ).rejects.toThrow(/workspace/i);
  });

  it('rejects moving a page under itself', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await expect(
      movePage(db, { pageId: p.id, workspaceId: u.workspaceId, newParentId: p.id }),
    ).rejects.toThrow(/cycle|self/i);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/move.test.ts
```

- [x] **Step 3: Write `src/lib/pages/move.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql as rawSql } from 'drizzle-orm';
import * as schema from '@/db/schema';

export type MovePageInput = {
  pageId: string;
  workspaceId: string;
  newParentId: string | null;
};

export async function movePage(
  db: PostgresJsDatabase<typeof schema>,
  input: MovePageInput,
): Promise<void> {
  if (input.newParentId === input.pageId) {
    throw new Error('Cannot move a page under itself (cycle)');
  }

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, input.pageId),
          eq(schema.pages.workspaceId, input.workspaceId),
          isNull(schema.pages.deletedAt),
        ),
      )
      .limit(1);
    if (!target) throw new Error('Page not found');

    if (input.newParentId) {
      const [parent] = await tx
        .select()
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, input.newParentId),
            eq(schema.pages.workspaceId, input.workspaceId),
            isNull(schema.pages.deletedAt),
          ),
        )
        .limit(1);
      if (!parent) throw new Error('Parent page is missing or in a different workspace');

      // Cycle check: is the new parent in the target's descendant subtree?
      const result = await tx.execute<{ count: number }>(rawSql`
        WITH RECURSIVE descendants AS (
          SELECT id FROM pages WHERE id = ${input.pageId}
          UNION ALL
          SELECT p.id FROM pages p
          INNER JOIN descendants d ON p.parent_id = d.id
        )
        SELECT count(*)::int AS count FROM descendants WHERE id = ${input.newParentId}
      `);
      const count = Number(result[0]?.count ?? 0);
      if (count > 0) throw new Error('Cycle detected: new parent is a descendant of the target');
    }

    await tx
      .update(schema.pages)
      .set({ parentId: input.newParentId })
      .where(eq(schema.pages.id, input.pageId));
  });
}
```

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/pages/move.test.ts
```

Expected: 5 passed.

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/lib/pages/move.ts tests/lib/pages/move.test.ts && \
  git commit -m "feat: movePage with workspace + cycle validation"
```

---

## Task 10: POST /api/pages

**Goal:** API route that creates a page. Editor+ role required. Returns 201 with the created row.

**Files:**
- Create: `src/app/api/pages/route.ts`
- Create: `tests/api/pages-create.test.ts`

- [x] **Step 1: Write failing test `tests/api/pages-create.test.ts`**

Use the `vi.mock('@/lib/auth/config', ...)` pattern from Plan 1's invites test. Two test cases: editor can create; viewer cannot.

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';
import { getDb } from '@/db/client';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: { userId: string } | null) => void };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(body: unknown): Promise<{ status: number; body: unknown }> {
  const { POST } = await import('@/app/api/pages/route');
  const res = await POST(
    new Request('http://localhost/api/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe('POST /api/pages', () => {
  it('editor can create a page', async () => {
    await asUser('editor');
    const r = await call({});
    expect(r.status).toBe(201);
    const body = r.body as { id: string; title: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.title).toBe('Untitled');
  });

  it('editor can create a nested page', async () => {
    const u = await asUser('editor');
    const parent = await call({});
    const parentBody = parent.body as { id: string };
    const r = await call({ parentId: parentBody.id, title: 'Child' });
    expect(r.status).toBe(201);
    expect((r.body as { title: string }).title).toBe('Child');
  });

  it('viewer is forbidden', async () => {
    await asUser('viewer');
    const r = await call({});
    expect(r.status).toBe(403);
  });

  it('unauthenticated is 401', async () => {
    const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: null) => void };
    mod.__set(null);
    const r = await call({});
    expect(r.status).toBe(401);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/pages-create.test.ts
```

- [x] **Step 3: Write `src/app/api/pages/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { createPage } from '@/lib/pages/create';
import { HttpError, requireRole } from '@/lib/auth/require-role';

const CreateInput = z.object({
  parentId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  icon: z.string().max(8).optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const parsed = CreateInput.parse(await req.json().catch(() => ({})));
    const page = await createPage(getDb(), {
      workspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
      parentId: parsed.parentId,
      title: parsed.title,
      icon: parsed.icon ?? null,
    });
    return NextResponse.json(page, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    if (/workspace/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/pages-create.test.ts
```

Expected: 4 passed.

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/app/api/pages/route.ts tests/api/pages-create.test.ts && \
  git commit -m "feat: POST /api/pages (editor+ only, nested support)"
```

---

## Task 11: GET / PATCH / DELETE /api/pages/[pageId]

**Goal:** Read, autosave, soft-delete a page. PATCH supports the conflict-detection header `If-Unmodified-Since`-style expectedUpdatedAt body field.

**Files:**
- Create: `src/app/api/pages/[pageId]/route.ts`
- Create: `tests/api/pages-rud.test.ts`

- [x] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';
import { getDb } from '@/db/client';
import { createPage } from '@/lib/pages/create';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: { userId: string } | null) => void };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(method: 'GET' | 'PATCH' | 'DELETE', pageId: string, body?: unknown) {
  const mod = await import('@/app/api/pages/[pageId]/route');
  const handler = mod[method] as (req: Request, ctx: { params: Promise<{ pageId: string }> }) => Promise<Response>;
  const res = await handler(
    new Request(`http://localhost/api/pages/${pageId}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ pageId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('/api/pages/[pageId]', () => {
  it('GET returns the page for viewer+', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId, title: 'X' });
    const r = await call('GET', p.id);
    expect(r.status).toBe(200);
    expect((r.body as { title: string }).title).toBe('X');
  });

  it('GET 404 for page in another workspace', async () => {
    const a = await asUser('viewer');
    const other = await createTestWorkspaceWithUser(getDb());
    const p = await createPage(getDb(), { workspaceId: other.workspaceId, createdBy: other.userId });
    const r = await call('GET', p.id);
    expect(r.status).toBe(404);
  });

  it('PATCH updates content as editor', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('PATCH', p.id, {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] },
    });
    expect(r.status).toBe(200);
    expect((r.body as { contentText: string }).contentText).toContain('Hi');
  });

  it('PATCH 403 for viewer', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('PATCH', p.id, { title: 'Try' });
    expect(r.status).toBe(403);
  });

  it('PATCH 409 on stale write', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await call('PATCH', p.id, { title: 'First' });
    const r = await call('PATCH', p.id, {
      title: 'Stale',
      expectedUpdatedAt: p.updatedAt.toISOString(),
    });
    expect(r.status).toBe(409);
  });

  it('DELETE soft-deletes the page', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('DELETE', p.id);
    expect(r.status).toBe(204);
    const r2 = await call('GET', p.id);
    expect(r2.status).toBe(404);
  });

  it('DELETE 403 for viewer', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('DELETE', p.id);
    expect(r.status).toBe(403);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/pages-rud.test.ts
```

- [x] **Step 3: Write `src/app/api/pages/[pageId]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requirePageAccess } from '@/lib/pages/access';
import { updatePage, PageConflictError } from '@/lib/pages/update';
import { softDeletePage } from '@/lib/pages/delete';
import { HttpError } from '@/lib/auth/require-role';

type RouteCtx = { params: Promise<{ pageId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page } = await requirePageAccess(pageId, 'viewer');
    return NextResponse.json(page);
  } catch (err) {
    return errorToResponse(err);
  }
}

const PatchInput = z.object({
  title: z.string().min(1).max(200).optional(),
  icon: z.string().max(8).nullable().optional(),
  content: z.unknown().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const parsed = PatchInput.parse(await req.json());
    const updated = await updatePage(getDb(), {
      pageId,
      workspaceId: ctx.workspaceId,
      patch: {
        title: parsed.title,
        icon: parsed.icon === undefined ? undefined : parsed.icon,
        content: parsed.content,
      },
      expectedUpdatedAt: parsed.expectedUpdatedAt ? new Date(parsed.expectedUpdatedAt) : undefined,
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof PageConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return errorToResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    await softDeletePage(getDb(), { pageId, workspaceId: ctx.workspaceId });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : 'unknown';
  return NextResponse.json({ error: message }, { status: 500 });
}
```

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/pages-rud.test.ts
```

Expected: 7 passed.

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/app/api/pages/\[pageId\]/route.ts tests/api/pages-rud.test.ts && \
  git commit -m "feat: GET/PATCH/DELETE /api/pages/:id with conflict + soft-delete"
```

---

## Task 12: POST /api/pages/[pageId]/move

**Files:**
- Create: `src/app/api/pages/[pageId]/move/route.ts`
- Create: `tests/api/pages-move.test.ts`

- [x] **Step 1: Write failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../helpers/db';
import { runMigrations } from '@/db/migrate';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';
import { getDb } from '@/db/client';
import { createPage } from '@/lib/pages/create';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: { userId: string } | null) => void };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(pageId: string, body: unknown) {
  const { POST } = await import('@/app/api/pages/[pageId]/move/route');
  const res = await POST(
    new Request(`http://localhost/api/pages/${pageId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ pageId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('POST /api/pages/[pageId]/move', () => {
  it('editor can reparent', async () => {
    const u = await asUser('editor');
    const a = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const b = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call(b.id, { newParentId: a.id });
    expect(r.status).toBe(204);
  });

  it('viewer is 403', async () => {
    const u = await asUser('viewer');
    const a = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call(a.id, { newParentId: null });
    expect(r.status).toBe(403);
  });

  it('400 on cycle', async () => {
    const u = await asUser('editor');
    const a = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const b = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: a.id,
    });
    const r = await call(a.id, { newParentId: b.id });
    expect(r.status).toBe(400);
  });
});
```

- [x] **Step 2: Verify failure**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/pages-move.test.ts
```

- [x] **Step 3: Write `src/app/api/pages/[pageId]/move/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requirePageAccess } from '@/lib/pages/access';
import { movePage } from '@/lib/pages/move';
import { HttpError } from '@/lib/auth/require-role';

const MoveInput = z.object({
  newParentId: z.string().uuid().nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ pageId: string }> }): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const parsed = MoveInput.parse(await req.json());
    await movePage(getDb(), { pageId, workspaceId: ctx.workspaceId, newParentId: parsed.newParentId });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    if (/cycle|workspace|self/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [x] **Step 4: Run tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/api/pages-move.test.ts
```

Expected: 3 passed.

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/app/api/pages/\[pageId\]/move/route.ts tests/api/pages-move.test.ts && \
  git commit -m "feat: POST /api/pages/:id/move with cycle rejection"
```

---

## Task 13: Sidebar page tree component

**Goal:** Replace the "Page list lands in Plan 2" placeholder with a recursive page tree fetched server-side.

**Files:**
- Create: `src/components/sidebar-tree.tsx`
- Modify: `src/components/sidebar.tsx`

- [x] **Step 1: Write `src/components/sidebar-tree.tsx`**

```tsx
import Link from 'next/link';
import { getDb } from '@/db/client';
import { getPageTree, type PageTreeNode } from '@/lib/pages/tree';

export async function SidebarTree({ workspaceId }: { workspaceId: string }) {
  const tree = await getPageTree(getDb(), workspaceId);
  if (tree.length === 0) {
    return <p className="px-2 py-4 text-sm text-muted-foreground">No pages yet.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {tree.map((node) => (
        <TreeItem key={node.id} node={node} depth={0} />
      ))}
    </ul>
  );
}

function TreeItem({ node, depth }: { node: PageTreeNode; depth: number }) {
  return (
    <li>
      <Link
        href={`/pages/${node.id}`}
        className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="w-4 shrink-0 text-center">{node.icon ?? '📄'}</span>
        <span className="truncate">{node.title}</span>
      </Link>
      {node.children.length > 0 && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
```

- [x] **Step 2: Modify `src/components/sidebar.tsx`**

Replace the existing `<nav>` content's placeholder text with the new SidebarTree. Read the current file first; the relevant section is the `<nav>` block.

Locate:
```tsx
      <nav className="flex-1 p-3">
        <p className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
          Pages
        </p>
        <p className="px-2 py-4 text-sm text-muted-foreground">
          Page list lands in Plan 2.
        </p>
      </nav>
```

Replace with:
```tsx
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pages</p>
          <NewPageButton />
        </div>
        <SidebarTree workspaceId={workspaceId} />
      </nav>
```

Add imports at the top of `sidebar.tsx`:
```tsx
import { NewPageButton } from './new-page-button';
import { SidebarTree } from './sidebar-tree';
```

`NewPageButton` is created in Task 14. The sidebar component won't typecheck until Task 14 lands. Acceptable to commit Task 13 + Task 14 together if cleaner.

- [x] **Step 3: Skip typecheck temporarily**

Don't run typecheck yet (NewPageButton doesn't exist). Continue to Task 14, then run typecheck at the end of Task 14.

- [x] **Step 4: Do NOT commit yet — wait for Task 14**

---

## Task 14: New page button + dashboard empty state

**Goal:** Client-side button that POSTs `/api/pages` and routes to the new page. Dashboard page (when no pages exist) shows a friendly CTA.

**Files:**
- Create: `src/components/new-page-button.tsx`
- Modify: `src/app/(app)/page.tsx`

- [x] **Step 1: Write `src/components/new-page-button.tsx`**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function NewPageButton({ parentId }: { parentId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parentId ? { parentId } : {}),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const created = (await res.json()) as { id: string };
      router.push(`/pages/${created.id}`);
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={busy}
      aria-label="New page"
      title="New page"
      className="h-6 w-6"
    >
      <Plus className="h-4 w-4" />
    </Button>
  );
}
```

- [x] **Step 2: Modify `src/app/(app)/page.tsx`**

Replace the placeholder body with:

```tsx
import { getDb } from '@/db/client';
import { getPageTree } from '@/lib/pages/tree';
import { getAuthContext } from '@/lib/auth/require-role';
import { NewPageButton } from '@/components/new-page-button';

export default async function DashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  const tree = await getPageTree(getDb(), ctx.workspaceId);
  if (tree.length > 0) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold">Welcome back</h1>
        <p className="mt-2 text-muted-foreground">
          Select a page from the sidebar, or create a new one.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center py-24 text-center">
      <h1 className="text-3xl font-semibold">Your workspace is empty</h1>
      <p className="mt-2 text-muted-foreground">Create your first page to get started.</p>
      <div className="mt-6">
        <NewPageButton />
      </div>
    </div>
  );
}
```

- [x] **Step 3: Verify Sidebar + NewPageButton compile together**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint
```

Both must exit 0. Fix import order or missing types if Biome complains.

- [x] **Step 4: Build smoke**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm build
```

Must succeed.

- [x] **Step 5: Run all tests**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test
```

Existing + new should all pass.

- [x] **Step 6: Commit (combined Task 13 + 14)**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/components/sidebar.tsx src/components/sidebar-tree.tsx \
          src/components/new-page-button.tsx 'src/app/(app)/page.tsx' && \
  git commit -m "feat: sidebar page tree + new-page button + empty-state CTA"
```

---

## Task 15: Page route /pages/[pageId] with placeholder editor

**Goal:** A page route that loads the page server-side, then mounts a client editor component. The editor itself is a placeholder for this task — Task 19+ wires TipTap.

**Files:**
- Create: `src/app/(app)/pages/[pageId]/page.tsx`
- Create: `src/app/(app)/pages/[pageId]/not-found.tsx`
- Create: `src/components/editor/editor.tsx` (placeholder shell only)

- [x] **Step 1: Write `src/app/(app)/pages/[pageId]/not-found.tsx`**

```tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="max-w-md py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        This page doesn't exist or you don't have access to it.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm underline">
        Back to workspace
      </Link>
    </div>
  );
}
```

- [x] **Step 2: Write `src/components/editor/editor.tsx` (placeholder)**

```tsx
'use client';

import { useState } from 'react';

export type EditorProps = {
  pageId: string;
  initialContent: unknown;
  initialUpdatedAt: string;
};

export function Editor({ initialContent }: EditorProps) {
  const [content] = useState(initialContent);
  return (
    <div className="prose dark:prose-invert max-w-none">
      <p className="text-muted-foreground text-sm">
        TipTap editor is wired in Task 19+. Placeholder for now.
      </p>
      <pre className="bg-muted overflow-auto rounded p-3 text-xs">
        {JSON.stringify(content, null, 2)}
      </pre>
    </div>
  );
}
```

- [x] **Step 3: Write `src/app/(app)/pages/[pageId]/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/pages/access';
import { HttpError } from '@/lib/auth/require-role';
import { Editor } from '@/components/editor/editor';

export default async function PageView({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  let page;
  try {
    ({ page } = await requirePageAccess(pageId, 'viewer'));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <span className="text-3xl">{page.icon ?? '📄'}</span>
        <h1 className="text-3xl font-semibold">{page.title}</h1>
      </div>
      <Editor
        pageId={page.id}
        initialContent={page.content}
        initialUpdatedAt={page.updatedAt.toISOString()}
      />
    </div>
  );
}
```

- [x] **Step 4: Verify build + smoke**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build
```

All clean.

- [x] **Step 5: Manual smoke (if Docker is up)**

Optional but useful: `docker compose up -d --build`, sign up, click the new-page button, verify the placeholder editor shows the empty doc JSON. Then `docker compose down`.

- [x] **Step 6: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add 'src/app/(app)/pages/' src/components/editor/editor.tsx && \
  git commit -m "feat: page route with title/icon header and placeholder editor"
```

---

## Task 16: Inline page title rename + emoji icon picker

**Goal:** Click the title to rename it; click the icon to pick a new emoji. Both autosave via PATCH on blur or selection.

**Files:**
- Create: `src/components/page-title-input.tsx`
- Create: `src/components/icon-picker.tsx`
- Modify: `src/app/(app)/pages/[pageId]/page.tsx`

- [x] **Step 1: Install emoji-picker-element**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm add emoji-picker-element@^1.21.0
```

Note: `emoji-picker-element` is a web component. We'll wrap it in a tiny React shim because it doesn't ship React typings.

- [x] **Step 2: Write `src/components/icon-picker.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';

export type IconPickerProps = {
  value: string | null;
  onChange: (next: string | null) => void;
};

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Lazy-import the web component only when needed (it registers a <emoji-picker>).
    void import('emoji-picker-element').then(() => {
      if (cancelled || !containerRef.current) return;
      const picker = document.createElement('emoji-picker') as HTMLElement & {
        addEventListener: (
          event: 'emoji-click',
          handler: (e: CustomEvent<{ unicode: string }>) => void,
        ) => void;
      };
      picker.addEventListener('emoji-click', (e) => {
        onChange(e.detail.unicode);
        setOpen(false);
      });
      containerRef.current.replaceChildren(picker);
    });
    return () => {
      cancelled = true;
    };
  }, [open, onChange]);

  return (
    <div className="relative inline-block">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change icon"
        className="h-10 w-10 text-3xl"
      >
        {value ?? '📄'}
      </Button>
      {open && (
        <div
          ref={containerRef}
          className="absolute left-0 z-10 mt-2 rounded-md border bg-background shadow-lg"
        />
      )}
    </div>
  );
}
```

- [x] **Step 3: Write `src/components/page-title-input.tsx`**

```tsx
'use client';

import { useState } from 'react';

export type PageTitleInputProps = {
  pageId: string;
  initial: string;
};

export function PageTitleInput({ pageId, initial }: PageTitleInputProps) {
  const [value, setValue] = useState(initial);
  const [savedValue, setSavedValue] = useState(initial);

  async function save(next: string) {
    if (next === savedValue || next.trim() === '') return;
    const res = await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: next }),
    });
    if (res.ok) setSavedValue(next);
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="w-full bg-transparent text-3xl font-semibold outline-none focus:ring-0"
      placeholder="Untitled"
    />
  );
}
```

- [x] **Step 4: Write `src/components/page-icon-picker.tsx` (client wrapper that wires save)**

```tsx
'use client';

import { useState } from 'react';
import { IconPicker } from './icon-picker';

export function PageIconPicker({ pageId, initial }: { pageId: string; initial: string | null }) {
  const [icon, setIcon] = useState<string | null>(initial);

  async function save(next: string | null) {
    setIcon(next);
    await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: next }),
    });
  }

  return <IconPicker value={icon} onChange={(next) => void save(next)} />;
}
```

- [x] **Step 5: Modify `src/app/(app)/pages/[pageId]/page.tsx`**

Replace the static `<h1>` + emoji span with the two new components:

```tsx
import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/pages/access';
import { HttpError } from '@/lib/auth/require-role';
import { Editor } from '@/components/editor/editor';
import { PageTitleInput } from '@/components/page-title-input';
import { PageIconPicker } from '@/components/page-icon-picker';

export default async function PageView({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  let page;
  try {
    ({ page } = await requirePageAccess(pageId, 'viewer'));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <PageIconPicker pageId={page.id} initial={page.icon} />
        <PageTitleInput pageId={page.id} initial={page.title} />
      </div>
      <Editor
        pageId={page.id}
        initialContent={page.content}
        initialUpdatedAt={page.updatedAt.toISOString()}
      />
    </div>
  );
}
```

- [x] **Step 6: Verify build + smoke**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

All exit 0.

- [x] **Step 7: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/components/page-title-input.tsx src/components/icon-picker.tsx \
          src/components/page-icon-picker.tsx 'src/app/(app)/pages/[pageId]/page.tsx' \
          package.json pnpm-lock.yaml && \
  git commit -m "feat: inline title rename + emoji icon picker"
```

---

## Task 17: Install TipTap and editor deps

**Goal:** Land all the editor packages in one task so subsequent editor tasks just consume them.

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [x] **Step 1: Install**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  pnpm add \
    @tiptap/react@^2.10.0 \
    @tiptap/pm@^2.10.0 \
    @tiptap/starter-kit@^2.10.0 \
    @tiptap/extension-task-list@^2.10.0 \
    @tiptap/extension-task-item@^2.10.0 \
    @tiptap/extension-placeholder@^2.10.0 \
    @tiptap/extension-character-count@^2.10.0 \
    @tiptap/extension-code-block-lowlight@^2.10.0 \
    @tiptap/suggestion@^2.10.0 \
    lowlight@^3.1.0 \
    tippy.js@^6.3.7
```

- [x] **Step 2: Verify typecheck still passes**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck
```

- [x] **Step 3: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add package.json pnpm-lock.yaml && \
  git commit -m "chore: install TipTap + lowlight + tippy editor deps"
```

---

## Task 18: TipTap base editor with autosave

**Goal:** Replace the placeholder editor with a real TipTap editor that loads `initialContent`, debounces saves at 800 ms, and PATCHes the content. Only paragraph + headings + plain text for now; lists, blockquote, callout, code arrive in later tasks.

**Files:**
- Create: `src/components/editor/extensions.ts`
- Modify: `src/components/editor/editor.tsx`

- [x] **Step 1: Write `src/components/editor/extensions.ts`**

```ts
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';

export function baseExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false, // replaced by lowlight in Task 21
      heading: { levels: [1, 2, 3] },
      bulletList: false, // re-added in Task 20
      orderedList: false, // re-added in Task 20
      blockquote: false, // re-added in Task 20
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading';
        return "Type '/' for commands";
      },
    }),
    CharacterCount,
  ];
}
```

- [x] **Step 2: Rewrite `src/components/editor/editor.tsx`**

```tsx
'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { baseExtensions } from './extensions';

export type EditorProps = {
  pageId: string;
  initialContent: unknown;
  initialUpdatedAt: string;
};

const AUTOSAVE_MS = 800;

export function Editor({ pageId, initialContent, initialUpdatedAt }: EditorProps) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle');
  const updatedAtRef = useRef(initialUpdatedAt);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (content: unknown) => {
      setStatus('saving');
      const res = await fetch(`/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, expectedUpdatedAt: updatedAtRef.current }),
      });
      if (res.status === 409) {
        setStatus('conflict');
        return;
      }
      if (!res.ok) {
        setStatus('error');
        return;
      }
      const body = (await res.json()) as { updatedAt: string };
      updatedAtRef.current = body.updatedAt;
      setStatus('saved');
    },
    [pageId],
  );

  const editor = useEditor({
    extensions: baseExtensions(),
    content: initialContent as never,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-[50vh]',
      },
    },
    onUpdate({ editor }) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const next = editor.getJSON();
      saveTimerRef.current = setTimeout(() => {
        void save(next);
      }, AUTOSAVE_MS);
    },
  });

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  return (
    <div className="relative">
      <div className="mb-1 text-right text-xs text-muted-foreground">
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved'}
        {status === 'conflict' && (
          <span className="text-destructive">
            Updated elsewhere. Refresh to see latest.
          </span>
        )}
        {status === 'error' && <span className="text-destructive">Save failed.</span>}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
```

- [x] **Step 3: Add prose typography support**

shadcn/ui doesn't ship `prose` classes by default. Install the Tailwind typography plugin:

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm add -D @tailwindcss/typography@^0.5.15
```

Update `tailwind.config.ts` plugins array to include `typography`:

```ts
import typography from '@tailwindcss/typography';
// ...
  plugins: [animate, typography],
```

- [x] **Step 4: Build + test**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

All clean.

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/components/editor/ tailwind.config.ts package.json pnpm-lock.yaml && \
  git commit -m "feat: TipTap base editor with debounced autosave + conflict notice"
```

---

## Task 19: Lists, quote, divider

**Goal:** Re-enable the StarterKit pieces we disabled in Task 18 plus task lists.

**Files:**
- Modify: `src/components/editor/extensions.ts`

- [x] **Step 1: Update `src/components/editor/extensions.ts`**

```ts
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

export function baseExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false, // replaced by lowlight in Task 21
      heading: { levels: [1, 2, 3] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading';
        return "Type '/' for commands";
      },
    }),
    CharacterCount,
  ];
}
```

(StarterKit's default options re-enable bulletList, orderedList, blockquote, horizontalRule. We dropped the per-extension disables.)

- [x] **Step 2: Build + test**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

- [x] **Step 3: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/components/editor/extensions.ts && \
  git commit -m "feat: enable bullet/numbered/task lists, blockquote, divider"
```

---

## Task 20: Code block with lowlight

**Goal:** Replace StarterKit's plain code block with the lowlight-powered one.

**Files:**
- Modify: `src/components/editor/extensions.ts`
- Create: `src/components/editor/code-highlight.css`
- Modify: `src/app/(app)/pages/[pageId]/page.tsx` (import the CSS or attach via global)

- [x] **Step 1: Update `extensions.ts`**

```ts
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);

export function baseExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading';
        return "Type '/' for commands";
      },
    }),
    CharacterCount,
  ];
}
```

- [x] **Step 2: Add syntax-highlight CSS**

Create `src/components/editor/code-highlight.css` using the standard highlight.js token classes (subset):

```css
.hljs-keyword,
.hljs-selector-tag,
.hljs-built_in {
  color: hsl(var(--primary));
  font-weight: 600;
}

.hljs-string,
.hljs-attr,
.hljs-symbol,
.hljs-bullet {
  color: hsl(var(--accent-foreground));
}

.hljs-comment,
.hljs-quote {
  color: hsl(var(--muted-foreground));
  font-style: italic;
}

.hljs-number,
.hljs-literal {
  color: hsl(var(--destructive));
}

.hljs-title,
.hljs-section,
.hljs-name {
  color: hsl(var(--primary));
}

pre code.hljs {
  display: block;
  overflow-x: auto;
  padding: 0.75em;
  background: hsl(var(--muted));
  border-radius: 0.5rem;
  font-size: 0.875rem;
}
```

Import this CSS in `src/app/globals.css` by appending:
```css
@import '../components/editor/code-highlight.css';
```

- [x] **Step 3: Build + test**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

- [x] **Step 4: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/components/editor/ src/app/globals.css && \
  git commit -m "feat: code block with lowlight syntax highlight"
```

---

## Task 21: Callout custom extension (4 colors)

**Goal:** A `callout` block node with 4 color variants: default, blue, green, amber. Renders as a colored box with padding.

**Files:**
- Create: `src/components/editor/callout-extension.ts`
- Modify: `src/components/editor/extensions.ts`
- Modify: `src/components/editor/code-highlight.css` (add `.callout-*` styles) — OR a new `callout.css`

- [x] **Step 1: Write `src/components/editor/callout-extension.ts`**

```ts
import { Node, mergeAttributes } from '@tiptap/core';

export type CalloutColor = 'default' | 'blue' | 'green' | 'amber';

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      color: {
        default: 'default' as CalloutColor,
        parseHTML: (el) => (el.getAttribute('data-color') as CalloutColor) ?? 'default',
        renderHTML: (attrs) => ({ 'data-color': attrs.color }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        class: `callout callout-${HTMLAttributes['data-color'] ?? 'default'}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (color: CalloutColor = 'default') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { color }),
      toggleCallout:
        (color: CalloutColor = 'default') =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { color }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (color?: CalloutColor) => ReturnType;
      toggleCallout: (color?: CalloutColor) => ReturnType;
    };
  }
}
```

- [x] **Step 2: Add Callout to extensions list**

In `src/components/editor/extensions.ts`, import and append:

```ts
import { Callout } from './callout-extension';
// ...
return [
  StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3] } }),
  CodeBlockLowlight.configure({ lowlight }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  Placeholder.configure({ /* ... */ }),
  CharacterCount,
];
```

- [x] **Step 3: Add callout CSS to `src/components/editor/code-highlight.css`**

Append:

```css
.callout {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  border-left: 3px solid hsl(var(--border));
  background: hsl(var(--muted));
  margin: 0.5rem 0;
}
.callout-blue {
  background: rgb(219 234 254 / 0.6);
  border-left-color: rgb(59 130 246);
}
.callout-green {
  background: rgb(220 252 231 / 0.6);
  border-left-color: rgb(34 197 94);
}
.callout-amber {
  background: rgb(254 243 199 / 0.6);
  border-left-color: rgb(245 158 11);
}
.dark .callout-blue {
  background: rgb(30 58 138 / 0.4);
}
.dark .callout-green {
  background: rgb(20 83 45 / 0.4);
}
.dark .callout-amber {
  background: rgb(120 53 15 / 0.4);
}
```

- [x] **Step 4: Build + test**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

- [x] **Step 5: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/components/editor/ && \
  git commit -m "feat: callout block extension with 4 color variants"
```

---

## Task 22: Slash command menu

**Goal:** Typing `/` opens a popover listing all block types. Filter as the user types. Selecting an item inserts/transforms the current block.

**Files:**
- Create: `src/components/editor/slash-menu.tsx`
- Create: `src/components/editor/slash-extension.ts`
- Modify: `src/components/editor/extensions.ts`

- [x] **Step 1: Write `src/components/editor/slash-menu.tsx`**

```tsx
'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { Editor } from '@tiptap/react';

export type SlashItem = {
  title: string;
  description: string;
  command: (editor: Editor) => void;
};

export type SlashMenuRef = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

export const SlashMenu = forwardRef<
  SlashMenuRef,
  { items: SlashItem[]; command: (item: SlashItem) => void }
>(function SlashMenu({ items, command }, ref) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (event.key === 'ArrowUp') {
        setIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        const chosen = items[index];
        if (chosen) command(chosen);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        No results
      </div>
    );
  }

  return (
    <div className="w-64 rounded-md border bg-popover shadow-md">
      <ul className="py-1">
        {items.map((item, i) => (
          <li key={item.title}>
            <button
              type="button"
              onClick={() => command(item)}
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-accent ${
                i === index ? 'bg-accent' : ''
              }`}
            >
              <div className="font-medium">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.description}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
```

- [x] **Step 2: Write `src/components/editor/slash-extension.ts`**

```ts
import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance, type Props as TippyProps } from 'tippy.js';
import { SlashMenu, type SlashItem, type SlashMenuRef } from './slash-menu';

const items: SlashItem[] = [
  {
    title: 'Heading 1',
    description: 'Large section header',
    command: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section header',
    command: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section header',
    command: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: 'Bullet list',
    description: 'Simple bulleted list',
    command: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    description: 'Ordered list',
    command: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: 'Task list',
    description: 'Checkbox list',
    command: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: 'Quote',
    description: 'Block quote',
    command: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: 'Code',
    description: 'Code block with syntax highlight',
    command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    command: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    title: 'Callout',
    description: 'Highlighted aside',
    command: (editor) => editor.chain().focus().setCallout('default').run(),
  },
];

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions(): { suggestion: Partial<SuggestionOptions> } {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          (props as SlashItem).command(editor);
        },
        items: ({ query }) =>
          items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase())).slice(0, 10),
        render: () => {
          let component: ReactRenderer<SlashMenuRef, { items: SlashItem[]; command: (i: SlashItem) => void }>;
          let popup: Instance<TippyProps>;
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, {
                props: { items: props.items, command: (i) => props.command(i) },
                editor: props.editor,
              });
              popup = tippy(document.body, {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
            },
            onUpdate: (props) => {
              component.updateProps({ items: props.items, command: (i) => props.command(i) });
              popup.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                popup.hide();
                return true;
              }
              return component.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              popup.destroy();
              component.destroy();
            },
          };
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});
```

- [x] **Step 3: Add SlashCommand to extensions**

In `src/components/editor/extensions.ts`:

```ts
import { SlashCommand } from './slash-extension';
// ...
return [
  // ...existing extensions
  SlashCommand,
];
```

- [x] **Step 4: Add tippy CSS**

Append to `src/components/editor/code-highlight.css`:

```css
@import 'tippy.js/dist/tippy.css';
```

If the import doesn't resolve (Next.js sometimes doesn't follow @import to node_modules), instead import the CSS directly in `src/app/layout.tsx`:

```tsx
import 'tippy.js/dist/tippy.css';
```

(Adjacent to the other CSS imports.)

- [x] **Step 5: Build + test**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

If typecheck complains about Suggestion's generic typing, add `as never` casts where needed or `// @ts-expect-error` with a comment.

- [x] **Step 6: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/components/editor/ src/app/layout.tsx && \
  git commit -m "feat: slash command menu (10 block types)"
```

---

## Task 23: Drag handle (deferred to Plan 6)

**Goal:** Document the explicit deferral of the Notion-style floating drag handle to Plan 6 (polish). No new files; just a marker comment so future readers see why the editor's left margin is bare.

**Rationale:** A correct floating drag handle requires precise block-boundary detection plus floating-ui positioning, and ships with edge cases (nested lists, code blocks, multi-line callouts) that take real time to harden. The slash menu (Task 22) covers block *insertion*; users can already delete blocks by selecting and pressing Backspace. Plan 6 is the right place to add the polish layer, and it can land without touching any existing extension wiring.

**Files:**
- Modify: `src/components/editor/extensions.ts` (one comment, no behavior change)

- [x] **Step 1: Add a TODO at the top of `extensions.ts`**

Prepend the file with:

```ts
// TODO(plan-6): Floating drag handle UI.
// Slash menu (`/`) covers block insertion; per-block actions (move, duplicate,
// delete) can be added later via a hover-positioned handle without modifying
// the extension list below.
```

- [x] **Step 2: Verify nothing else regressed**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

All clean.

- [x] **Step 3: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/components/editor/extensions.ts && \
  git commit -m "docs: defer drag handle UI to Plan 6"
```

---

## Task 24: Keyboard shortcuts

**Goal:** Wire ⌘N (new page) globally on `(app)/...` routes.

The ⌘/ slash menu and ⌘B/I/U formatting come from TipTap/StarterKit by default.

**Files:**
- Create: `src/components/keyboard-shortcuts.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [x] **Step 1: Write `src/components/keyboard-shortcuts.tsx`**

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function KeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === 'n') {
        e.preventDefault();
        void (async () => {
          const res = await fetch('/api/pages', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          if (res.ok) {
            const created = (await res.json()) as { id: string };
            router.push(`/pages/${created.id}`);
            router.refresh();
          }
        })();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return null;
}
```

- [x] **Step 2: Mount in `src/app/(app)/layout.tsx`**

Add inside the `<div>` returned by AppLayout:

```tsx
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
// ...
<div className="flex min-h-screen">
  <KeyboardShortcuts />
  <Sidebar workspaceId={ctx.workspaceId} />
  <main className="flex-1 p-8">{children}</main>
</div>
```

- [x] **Step 3: Build + test**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

- [x] **Step 4: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add src/components/keyboard-shortcuts.tsx 'src/app/(app)/layout.tsx' && \
  git commit -m "feat: ⌘N global shortcut to create a new page"
```

---

## Task 25: End-to-end manual smoke and CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

- [x] **Step 1: Full E2E smoke**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  docker compose down -v 2>/dev/null || true && \
  docker compose up -d --build && \
  sleep 15
```

Then in a browser:
1. Visit `http://localhost:3000` → redirected to /login.
2. Click "Sign up", fill name/email/password/workspaceName, submit. Land at dashboard with "Your workspace is empty" CTA.
3. Click the New Page button. Land on `/pages/<id>` with the editor.
4. Click the title, type "Meeting notes", press Enter. Title saves.
5. Click the icon, pick an emoji.
6. Type `/` and select Heading 1. Type "Agenda". Press Enter.
7. Type `/list` and select Bullet list. Type a few items.
8. Type `/code`, select language hint (or just type code), type a snippet.
9. Type `/callout`, select Callout. Type "Important context."
10. Wait ~1s. Refresh the page. All changes should be present.
11. Press ⌘N. A new page appears; you're navigated to it.
12. Use the sidebar to navigate between the two pages.
13. Sign out → /login. Sign back in → land at dashboard, both pages still in sidebar.

If any step fails, debug. Common gotchas:
- Editor doesn't load: check browser console for hydration errors. Confirm `immediatelyRender: false` on useEditor.
- Slash menu doesn't pop: tippy.js CSS may not be loaded. Verify `import 'tippy.js/dist/tippy.css';` in `src/app/layout.tsx`.
- Autosave 409 forever: the conflict-detection compares ISO strings; ensure server returns the new `updatedAt` and the client stores it.

- [x] **Step 2: Tear down**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && docker compose down
```

- [x] **Step 3: Update `CHANGELOG.md`**

Append the new entries under `[Unreleased]`:

```markdown
## [Unreleased]

### Added (Plan 2 — Pages & block editor)
- Pages table with FTS columns/trigger and self-referential parent.
- Page CRUD APIs (create, read, update, soft-delete, move) with role gates and workspace scoping.
- Cycle detection on page move; cascade soft-delete with `deleted_root` flag.
- Recursive sidebar page tree (server-rendered) with new-page button.
- Empty-state CTA on the dashboard.
- Page route with inline title rename and emoji icon picker.
- TipTap editor (paragraph, H1/H2/H3, bullet/numbered/task lists, blockquote, code with syntax highlight, callout in 4 colors, divider).
- Slash command menu for block insertion.
- Debounced autosave (800 ms) with optimistic UI and stale-write conflict notice.
- ⌘N keyboard shortcut to create a new page.
- React `cache()` wrap on `getAuthContext` to dedupe per-request DB hits.
- Fixed Next.js `typedRoutes` deprecation.

### Added (Plan 1 — Foundation)
- Multi-tenant workspace model with email/password authentication.
- First-user bootstrap (creates workspace, becomes owner) and invite-token signup for subsequent users.
- Roles: owner, admin, editor, viewer (enforced via `requireRole` helper).
- Admin-only invite token issuance API.
- Health endpoint at `/api/health` with database probe and version reporting.
- Light/dark/system theme with toggle.
- Authenticated dashboard shell with sidebar (workspace name, version footer).
- Dockerfile (multi-stage) and docker-compose for app + postgres.
- GitHub Actions CI: lint, typecheck, test with Postgres service container, build smoke.
- Repository scaffolding: Biome (lint/format), Vitest with testcontainers, Drizzle ORM with migrations applied at startup.
```

- [x] **Step 4: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  git add CHANGELOG.md && \
  git commit -m "docs: changelog entry for pages & editor (Plan 2)"
```

---

## Done

At this point:

- Pages CRUD works end-to-end via APIs and the sidebar UI.
- Users can create, nest, rename, icon-decorate, and edit pages.
- TipTap renders a real block-based editor with the v0.1.0 text-block set.
- Slash menu inserts blocks. Autosave persists every ~800 ms.
- Soft-delete cascades through the page subtree; the data shape is ready for Plan 3's trash bin and search.

**Next plan:** `2026-MM-DD-cairn-search-and-trash.md` — `pg_trgm` extension, search index tuning, ⌘K search palette, trash view, restore, auto-purge.
