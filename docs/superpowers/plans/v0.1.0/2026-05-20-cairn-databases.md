# Cairn Databases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inline databases (Notion-style) inside pages. Users can insert a `/database` block, define typed properties (text, number, select, multi_select, date, checkbox, URL), add rows and edit cells inline, and switch between table / kanban / gallery views. Each view stores its own sort + AND-only filter config.

**Architecture:** Five new tables — `databases`, `db_properties`, `db_rows`, `db_cells`, `db_views`. The page editor stores a `database` node with a `databaseId` attribute; the client component fetches the database + its rows on mount. Filter and sort compilation happens on the server; cell values are stored as `jsonb` with type-aware coercion. Three view components (table, kanban, gallery) share a single data hook.

**Tech Stack additions:** No new infra. `@tanstack/react-table` for the table view (sortable headers, virtual scrolling later). `date-fns` for date display.

---

## What's in scope for Plan 5

- 5-table schema for databases (databases, db_properties, db_rows, db_cells, db_views)
- Property types: text, number, select, multi_select, date, checkbox, url
- Server-side helpers: create/get/update database, CRUD for properties, rows, cells, views
- Filter compilation: AND list of `{property, op, value}` → SQL WHERE
- Sort compilation: ordered list of `{property, direction}` → SQL ORDER BY
- API routes for all of the above
- Database node in the editor: insertable via `/database`
- Client component renders the active view
- Table view: inline cell editing, sortable headers
- Kanban view: group by a select property
- Gallery view: card layout
- View switcher + property panel (add/remove/edit properties, configure sort/filter)

## What's explicitly NOT in this plan

- Formulas, relations, rollups — explicitly out of scope per spec
- Calendar, timeline views — deferred
- Row-level permissions — deferred
- Multi-property sort UI beyond two columns — first iteration shows up to 5
- Nested OR filter groups — AND-only

---

## File structure produced by this plan

```
cairn/
├── drizzle/migrations/
│   └── 0006_databases.sql                  # NEW
├── src/
│   ├── app/api/
│   │   ├── databases/
│   │   │   ├── route.ts                    # POST create
│   │   │   └── [databaseId]/
│   │   │       ├── route.ts                # GET, PATCH, DELETE
│   │   │       ├── properties/route.ts     # POST create
│   │   │       ├── properties/[propId]/route.ts
│   │   │       ├── rows/route.ts           # POST create + GET list (with filters)
│   │   │       ├── rows/[rowId]/route.ts   # PATCH cells, DELETE row
│   │   │       └── views/
│   │   │           ├── route.ts
│   │   │           └── [viewId]/route.ts
│   ├── components/
│   │   ├── editor/
│   │   │   └── database-extension.ts       # NEW — TipTap node
│   │   └── databases/
│   │       ├── database-block.tsx          # NEW — client-mounted block
│   │       ├── table-view.tsx              # NEW
│   │       ├── kanban-view.tsx             # NEW
│   │       ├── gallery-view.tsx            # NEW
│   │       ├── view-switcher.tsx           # NEW
│   │       ├── property-panel.tsx          # NEW
│   │       ├── filter-builder.tsx          # NEW
│   │       └── sort-builder.tsx            # NEW
│   ├── db/schema/
│   │   ├── databases.ts                    # NEW
│   │   └── index.ts                        # MODIFIED
│   └── lib/
│       └── databases/
│           ├── create.ts                   # NEW
│           ├── get.ts                      # NEW
│           ├── properties.ts               # NEW
│           ├── rows.ts                     # NEW
│           ├── views.ts                    # NEW
│           ├── filter.ts                   # NEW — predicate compilation
│           └── sort.ts                     # NEW
└── tests/
    ├── lib/databases/
    │   ├── create.test.ts
    │   ├── properties.test.ts
    │   ├── rows.test.ts
    │   ├── views.test.ts
    │   ├── filter.test.ts
    │   └── sort.test.ts
    └── api/
        ├── databases-routes.test.ts
        └── databases-rows-filter.test.ts
```

---

## Conventions

- pnpm, TDD, conventional commits, no pushes.
- Cell values are stored as `jsonb` keyed by property id and validated by property type at write time.
- All routes use `requireRole` and additionally validate that the targeted database belongs to the caller's workspace.

---

## Task 1: Migration — five tables

**Files:**
- Create: `src/db/schema/databases.ts`
- Modify: `src/db/schema/index.ts`
- Generate: `drizzle/migrations/0006_*.sql`
- Create: `tests/db/databases-schema.test.ts`

- [x] **Step 1: Write `src/db/schema/databases.ts`**

```ts
import { boolean, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

export const propertyType = pgEnum('property_type', [
  'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url',
]);
export const viewType = pgEnum('view_type', ['table', 'kanban', 'gallery']);

export const databases = pgTable('databases', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Untitled database'),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const dbProperties = pgTable('db_properties', {
  id: uuid('id').primaryKey().defaultRandom(),
  databaseId: uuid('database_id').notNull().references(() => databases.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: propertyType('type').notNull(),
  config: jsonb('config').$type<unknown>().notNull().default({}),
  position: integer('position').notNull().default(0),
});

export const dbRows = pgTable('db_rows', {
  id: uuid('id').primaryKey().defaultRandom(),
  databaseId: uuid('database_id').notNull().references(() => databases.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const dbCells = pgTable(
  'db_cells',
  {
    rowId: uuid('row_id').notNull().references(() => dbRows.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id').notNull().references(() => dbProperties.id, { onDelete: 'cascade' }),
    value: jsonb('value').$type<unknown>(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.rowId, t.propertyId] }) }),
);

export const dbViews = pgTable('db_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  databaseId: uuid('database_id').notNull().references(() => databases.id, { onDelete: 'cascade' }),
  type: viewType('type').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').$type<unknown>().notNull().default({}),
  position: integer('position').notNull().default(0),
});

export type Database = typeof databases.$inferSelect;
export type DbProperty = typeof dbProperties.$inferSelect;
export type DbRow = typeof dbRows.$inferSelect;
export type DbCell = typeof dbCells.$inferSelect;
export type DbView = typeof dbViews.$inferSelect;
export type PropertyType = (typeof propertyType.enumValues)[number];
export type ViewType = (typeof viewType.enumValues)[number];
```

- [x] **Step 2: Index, generate migration, write test**

Update `src/db/schema/index.ts` with `export * from './databases';`. Generate migration. Write a small schema test (analogous to Plan 4 Task 1) verifying inserts work for each table and FK cascades behave.

- [x] **Step 3: Run + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  DATABASE_URL=postgres://cairn:cairn@localhost:5432/cairn pnpm db:generate && \
  pnpm test tests/db/databases-schema.test.ts && \
  pnpm lint && pnpm typecheck && pnpm test
git add src/db/schema/ drizzle/ tests/db/databases-schema.test.ts && \
  git commit -m "feat: databases schema (5 tables) + property/view enums"
```

---

## Task 2: Database CRUD helpers

**Goal:** `createDatabase`, `getDatabase`, `archiveDatabase`, `renameDatabase`.

**Files:**
- Create: `src/lib/databases/create.ts`, `src/lib/databases/get.ts`, `src/lib/databases/update.ts`
- Create: `tests/lib/databases/create.test.ts`

- [x] **Step 1: Write `src/lib/databases/create.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type CreateDatabaseInput = {
  workspaceId: string;
  pageId: string;
  createdBy: string;
  name?: string;
};

export async function createDatabase(
  db: PostgresJsDatabase<typeof schema>,
  input: CreateDatabaseInput,
): Promise<schema.Database> {
  return db.transaction(async (tx) => {
    const [page] = await tx
      .select({ workspaceId: schema.pages.workspaceId })
      .from(schema.pages)
      .where(and(eq(schema.pages.id, input.pageId), eq(schema.pages.workspaceId, input.workspaceId)))
      .limit(1);
    if (!page) throw new Error('page not found in workspace');

    const [database] = await tx
      .insert(schema.databases)
      .values({
        workspaceId: input.workspaceId,
        pageId: input.pageId,
        createdBy: input.createdBy,
        name: input.name ?? 'Untitled database',
      })
      .returning();
    if (!database) throw new Error('failed to insert database');

    // Seed with a default "Name" text property + default table view.
    const [nameProp] = await tx
      .insert(schema.dbProperties)
      .values({ databaseId: database.id, name: 'Name', type: 'text', position: 0 })
      .returning();
    if (!nameProp) throw new Error('failed to insert property');

    await tx.insert(schema.dbViews).values({
      databaseId: database.id,
      type: 'table',
      name: 'Default',
      config: { sorts: [], filters: [], visibleProperties: [nameProp.id] },
      position: 0,
    });
    return database;
  });
}
```

- [x] **Step 2: Write get + update helpers**

`src/lib/databases/get.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export async function getDatabaseWithMeta(
  db: PostgresJsDatabase<typeof schema>,
  args: { databaseId: string; workspaceId: string },
) {
  const [database] = await db
    .select()
    .from(schema.databases)
    .where(eq(schema.databases.id, args.databaseId))
    .limit(1);
  if (!database || database.workspaceId !== args.workspaceId) return null;

  const properties = await db
    .select()
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.databaseId, args.databaseId))
    .orderBy(schema.dbProperties.position);

  const views = await db
    .select()
    .from(schema.dbViews)
    .where(eq(schema.dbViews.databaseId, args.databaseId))
    .orderBy(schema.dbViews.position);

  return { database, properties, views };
}
```

- [x] **Step 3: Test cases**

5 tests for `create`: success, parent page in different workspace rejected, seed property exists, seed view exists, default name applied. Plus 3 tests for `getDatabaseWithMeta`: returns null when wrong workspace; returns properties ordered; returns views.

- [x] **Step 4: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/databases/create.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/databases/ tests/lib/databases/create.test.ts && \
  git commit -m "feat: createDatabase + getDatabaseWithMeta (seeded with default Name + table view)"
```

---

## Task 3: Properties helpers

**Goal:** `createProperty`, `updateProperty`, `deleteProperty`, `reorderProperties`.

Type-specific config validation (e.g., select needs `options: string[]`).

**Files:**
- Create: `src/lib/databases/properties.ts`
- Create: `tests/lib/databases/properties.test.ts`

- [x] **Step 1: Property helpers**

```ts
import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '@/db/schema';

const SelectConfig = z.object({ options: z.array(z.object({ id: z.string(), name: z.string(), color: z.string().optional() })).default([]) });
const NoConfig = z.object({}).strict();

const ConfigByType: Record<schema.PropertyType, z.ZodTypeAny> = {
  text: NoConfig,
  number: z.object({ format: z.enum(['plain', 'currency', 'percent']).default('plain') }).default({ format: 'plain' }),
  select: SelectConfig,
  multi_select: SelectConfig,
  date: NoConfig,
  checkbox: NoConfig,
  url: NoConfig,
};

export async function createProperty(
  db: PostgresJsDatabase<typeof schema>,
  input: {
    databaseId: string;
    workspaceId: string;
    name: string;
    type: schema.PropertyType;
    config?: unknown;
  },
): Promise<schema.DbProperty> {
  return db.transaction(async (tx) => {
    // Validate the database is in the workspace.
    const [database] = await tx
      .select({ workspaceId: schema.databases.workspaceId })
      .from(schema.databases)
      .where(eq(schema.databases.id, input.databaseId))
      .limit(1);
    if (!database || database.workspaceId !== input.workspaceId) {
      throw new Error('database not found in workspace');
    }
    const config = ConfigByType[input.type].parse(input.config ?? {});
    const [maxPos] = await tx
      .select({ pos: schema.dbProperties.position })
      .from(schema.dbProperties)
      .where(eq(schema.dbProperties.databaseId, input.databaseId))
      .orderBy(schema.dbProperties.position)
      .limit(1);
    const nextPos = (maxPos?.pos ?? -1) + 1;

    const [row] = await tx
      .insert(schema.dbProperties)
      .values({ databaseId: input.databaseId, name: input.name, type: input.type, config, position: nextPos })
      .returning();
    if (!row) throw new Error('insert failed');
    return row;
  });
}

export async function updateProperty(
  db: PostgresJsDatabase<typeof schema>,
  input: { propertyId: string; databaseId: string; workspaceId: string; patch: { name?: string; config?: unknown } },
): Promise<schema.DbProperty> {
  return db.transaction(async (tx) => {
    const [prop] = await tx
      .select()
      .from(schema.dbProperties)
      .where(and(eq(schema.dbProperties.id, input.propertyId), eq(schema.dbProperties.databaseId, input.databaseId)))
      .limit(1);
    if (!prop) throw new Error('property not found');
    const values: Partial<typeof prop> = {};
    if (input.patch.name !== undefined) values.name = input.patch.name;
    if (input.patch.config !== undefined) values.config = ConfigByType[prop.type].parse(input.patch.config) as never;
    const [updated] = await tx
      .update(schema.dbProperties)
      .set(values)
      .where(eq(schema.dbProperties.id, input.propertyId))
      .returning();
    if (!updated) throw new Error('update failed');
    return updated;
  });
}

export async function deleteProperty(
  db: PostgresJsDatabase<typeof schema>,
  input: { propertyId: string; databaseId: string; workspaceId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    // Ownership check.
    const [database] = await tx
      .select({ workspaceId: schema.databases.workspaceId })
      .from(schema.databases)
      .where(eq(schema.databases.id, input.databaseId))
      .limit(1);
    if (!database || database.workspaceId !== input.workspaceId) {
      throw new Error('database not found in workspace');
    }
    await tx
      .delete(schema.dbProperties)
      .where(and(eq(schema.dbProperties.id, input.propertyId), eq(schema.dbProperties.databaseId, input.databaseId)));
    // db_cells FK cascade removes the cells.
  });
}
```

- [x] **Step 2: Tests**

Cases: create+default position, type-specific config validation (select requires options), cross-database rejection, delete cascades cells, update enforces config validation.

- [x] **Step 3: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/databases/properties.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/databases/properties.ts tests/lib/databases/properties.test.ts && \
  git commit -m "feat: database property CRUD with type-specific config validation"
```

---

## Task 4: Row + cell CRUD helpers

**Goal:** `createRow`, `updateCells`, `archiveRow`, `listRows(filter, sort, limit, offset)`. Cell values type-coerced per property.

**Files:**
- Create: `src/lib/databases/rows.ts`
- Create: `tests/lib/databases/rows.test.ts`

- [x] **Step 1: Row + cell helpers**

```ts
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export async function createRow(
  db: PostgresJsDatabase<typeof schema>,
  input: { databaseId: string; workspaceId: string; createdBy: string; cells?: Record<string, unknown> },
): Promise<schema.DbRow> {
  return db.transaction(async (tx) => {
    const [database] = await tx
      .select({ workspaceId: schema.databases.workspaceId })
      .from(schema.databases)
      .where(eq(schema.databases.id, input.databaseId))
      .limit(1);
    if (!database || database.workspaceId !== input.workspaceId) {
      throw new Error('database not found in workspace');
    }
    const [row] = await tx
      .insert(schema.dbRows)
      .values({ databaseId: input.databaseId, createdBy: input.createdBy })
      .returning();
    if (!row) throw new Error('insert row failed');

    if (input.cells) {
      const props = await tx
        .select()
        .from(schema.dbProperties)
        .where(eq(schema.dbProperties.databaseId, input.databaseId));
      const propsById = new Map(props.map((p) => [p.id, p]));
      const cellValues = Object.entries(input.cells)
        .filter(([propId]) => propsById.has(propId))
        .map(([propId, value]) => ({
          rowId: row.id,
          propertyId: propId,
          value: coerce(propsById.get(propId)!.type, value),
        }));
      if (cellValues.length > 0) {
        await tx.insert(schema.dbCells).values(cellValues);
      }
    }
    return row;
  });
}

export async function updateCells(
  db: PostgresJsDatabase<typeof schema>,
  input: { rowId: string; databaseId: string; workspaceId: string; cells: Record<string, unknown> },
): Promise<void> {
  await db.transaction(async (tx) => {
    // Validate ownership via a join.
    const [row] = await tx
      .select({ databaseId: schema.dbRows.databaseId, workspaceId: schema.databases.workspaceId })
      .from(schema.dbRows)
      .innerJoin(schema.databases, eq(schema.dbRows.databaseId, schema.databases.id))
      .where(eq(schema.dbRows.id, input.rowId))
      .limit(1);
    if (!row || row.workspaceId !== input.workspaceId || row.databaseId !== input.databaseId) {
      throw new Error('row not found in database');
    }
    const props = await tx
      .select()
      .from(schema.dbProperties)
      .where(eq(schema.dbProperties.databaseId, input.databaseId));
    const propsById = new Map(props.map((p) => [p.id, p]));

    for (const [propId, raw] of Object.entries(input.cells)) {
      const prop = propsById.get(propId);
      if (!prop) continue;
      const value = coerce(prop.type, raw);
      // Upsert
      await tx
        .insert(schema.dbCells)
        .values({ rowId: input.rowId, propertyId: propId, value })
        .onConflictDoUpdate({
          target: [schema.dbCells.rowId, schema.dbCells.propertyId],
          set: { value },
        });
    }
    await tx
      .update(schema.dbRows)
      .set({ updatedAt: new Date() })
      .where(eq(schema.dbRows.id, input.rowId));
  });
}

function coerce(type: schema.PropertyType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return Boolean(value);
    case 'date': {
      if (typeof value === 'string') {
        const d = new Date(value);
        return Number.isFinite(d.getTime()) ? d.toISOString() : null;
      }
      return null;
    }
    case 'multi_select':
      return Array.isArray(value) ? value.map(String) : [];
    case 'select':
    case 'text':
    case 'url':
      return typeof value === 'string' ? value : String(value);
  }
}

export async function archiveRow(
  db: PostgresJsDatabase<typeof schema>,
  input: { rowId: string; databaseId: string; workspaceId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ databaseId: schema.dbRows.databaseId, workspaceId: schema.databases.workspaceId })
      .from(schema.dbRows)
      .innerJoin(schema.databases, eq(schema.dbRows.databaseId, schema.databases.id))
      .where(eq(schema.dbRows.id, input.rowId))
      .limit(1);
    if (!row || row.workspaceId !== input.workspaceId || row.databaseId !== input.databaseId) {
      throw new Error('row not found');
    }
    await tx
      .update(schema.dbRows)
      .set({ archivedAt: new Date() })
      .where(eq(schema.dbRows.id, input.rowId));
  });
}

export type FilterCondition = { propertyId: string; op: string; value: unknown };
export type SortSpec = { propertyId: string; direction: 'asc' | 'desc' };

export async function listRows(
  db: PostgresJsDatabase<typeof schema>,
  input: { databaseId: string; workspaceId: string; filters?: FilterCondition[]; sorts?: SortSpec[]; limit?: number; offset?: number },
): Promise<{ row: schema.DbRow; cells: Record<string, unknown> }[]> {
  // Filter + sort compilation moved to lib/databases/filter.ts and lib/databases/sort.ts (Task 5+6).
  // This helper just runs the basic query; tests in Task 4 use filters: [] and sorts: [].
  // Full filtering arrives in Task 5.
  const rows = await db
    .select()
    .from(schema.dbRows)
    .where(and(eq(schema.dbRows.databaseId, input.databaseId), isNull(schema.dbRows.archivedAt)))
    .orderBy(schema.dbRows.createdAt)
    .limit(input.limit ?? 100)
    .offset(input.offset ?? 0);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const cells = await db
    .select()
    .from(schema.dbCells)
    .where(inArray(schema.dbCells.rowId, ids));

  const cellsByRow = new Map<string, Record<string, unknown>>();
  for (const c of cells) {
    if (!cellsByRow.has(c.rowId)) cellsByRow.set(c.rowId, {});
    cellsByRow.get(c.rowId)![c.propertyId] = c.value;
  }
  return rows.map((r) => ({ row: r, cells: cellsByRow.get(r.id) ?? {} }));
}
```

- [x] **Step 2: Tests**

8 cases covering: row create with no cells; create with cells (coerced); cell update overwrites; numeric coercion of strings; archived rows excluded from list; cross-db row update rejected; cross-workspace cell update rejected; listRows pagination.

- [x] **Step 3: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/databases/rows.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/databases/rows.ts tests/lib/databases/rows.test.ts && \
  git commit -m "feat: row + cell CRUD with type coercion + archive + paginated list"
```

---

## Task 5: Filter compilation

**Goal:** Take an array of `{propertyId, op, value}` and produce a Drizzle WHERE clause that filters `dbCells` correctly.

Supported ops by type:
- text/url: `eq`, `neq`, `contains`, `not_contains`, `is_empty`, `is_not_empty`, `starts_with`, `ends_with`
- number: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `is_empty`
- checkbox: `is_true`, `is_false`
- date: `eq`, `gt`, `gte`, `lt`, `lte`, `is_empty`
- select: `eq`, `neq`, `is_empty`
- multi_select: `contains`, `not_contains`, `is_empty`

**Files:**
- Create: `src/lib/databases/filter.ts`
- Create: `tests/lib/databases/filter.test.ts`

- [x] **Step 1: Implement compileFilters**

Returns a SQL fragment suitable for use inside `WHERE EXISTS (SELECT 1 FROM db_cells WHERE ...)` per condition. Multiple conditions AND-ed.

```ts
import { sql as rawSql, type SQL } from 'drizzle-orm';
import * as schema from '@/db/schema';

export type FilterCondition = { propertyId: string; op: string; value: unknown };

/**
 * Compile a list of conditions to a SQL fragment that filters db_rows.
 * Each condition becomes:  EXISTS (SELECT 1 FROM db_cells WHERE row_id = db_rows.id AND property_id = '...' AND <predicate>)
 * Conditions are AND-ed.
 */
export function compileFilters(
  conditions: FilterCondition[],
  propsById: Map<string, schema.DbProperty>,
): SQL | undefined {
  if (conditions.length === 0) return undefined;
  const fragments: SQL[] = [];
  for (const c of conditions) {
    const prop = propsById.get(c.propertyId);
    if (!prop) continue;
    const inner = predicateFor(prop.type, c.op, c.value);
    if (!inner) continue;
    fragments.push(rawSql`EXISTS (
      SELECT 1 FROM db_cells dc
      WHERE dc.row_id = db_rows.id
        AND dc.property_id = ${c.propertyId}
        AND ${inner}
    )`);
    // For is_empty we want the *absence* of the row OR a null value. Handled inside predicateFor.
  }
  if (fragments.length === 0) return undefined;
  return fragments.reduce((acc, cur) => rawSql`${acc} AND ${cur}`);
}

function predicateFor(type: schema.PropertyType, op: string, value: unknown): SQL | null {
  switch (type) {
    case 'text':
    case 'url':
    case 'select':
      switch (op) {
        case 'eq': return rawSql`dc.value::text = ${JSON.stringify(value)}::jsonb::text`;
        case 'neq': return rawSql`dc.value::text <> ${JSON.stringify(value)}::jsonb::text`;
        case 'contains': return rawSql`dc.value::text ILIKE ${`"%${String(value)}%"`}`;
        case 'not_contains': return rawSql`dc.value::text NOT ILIKE ${`"%${String(value)}%"`}`;
        case 'starts_with': return rawSql`dc.value::text ILIKE ${`"${String(value)}%"`}`;
        case 'ends_with': return rawSql`dc.value::text ILIKE ${`"%${String(value)}"`}`;
        case 'is_empty': return rawSql`(dc.value IS NULL OR dc.value::text = '""')`;
        case 'is_not_empty': return rawSql`dc.value IS NOT NULL AND dc.value::text <> '""'`;
        default: return null;
      }
    case 'number':
      switch (op) {
        case 'eq': return rawSql`(dc.value)::numeric = ${Number(value)}`;
        case 'neq': return rawSql`(dc.value)::numeric <> ${Number(value)}`;
        case 'gt': return rawSql`(dc.value)::numeric > ${Number(value)}`;
        case 'gte': return rawSql`(dc.value)::numeric >= ${Number(value)}`;
        case 'lt': return rawSql`(dc.value)::numeric < ${Number(value)}`;
        case 'lte': return rawSql`(dc.value)::numeric <= ${Number(value)}`;
        case 'is_empty': return rawSql`dc.value IS NULL`;
        default: return null;
      }
    case 'checkbox':
      switch (op) {
        case 'is_true': return rawSql`dc.value::text = 'true'`;
        case 'is_false': return rawSql`(dc.value IS NULL OR dc.value::text = 'false')`;
        default: return null;
      }
    case 'date':
      switch (op) {
        case 'eq': return rawSql`(dc.value->>0)::date = ${String(value)}::date`;
        case 'gt': return rawSql`(dc.value->>0)::date > ${String(value)}::date`;
        case 'gte': return rawSql`(dc.value->>0)::date >= ${String(value)}::date`;
        case 'lt': return rawSql`(dc.value->>0)::date < ${String(value)}::date`;
        case 'lte': return rawSql`(dc.value->>0)::date <= ${String(value)}::date`;
        case 'is_empty': return rawSql`dc.value IS NULL`;
        default: return null;
      }
    case 'multi_select':
      switch (op) {
        case 'contains': return rawSql`dc.value @> ${JSON.stringify([String(value)])}::jsonb`;
        case 'not_contains': return rawSql`NOT (dc.value @> ${JSON.stringify([String(value)])}::jsonb)`;
        case 'is_empty': return rawSql`(dc.value IS NULL OR jsonb_array_length(dc.value) = 0)`;
        default: return null;
      }
  }
  return null;
}
```

NOTE: the JSON value handling has sharp edges — `dc.value::text` vs `dc.value->>0`. Tests will catch wrong shapes; iterate as needed.

- [x] **Step 2: Tests** (8+ cases across the property types and ops)

- [x] **Step 3: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/databases/filter.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/databases/filter.ts tests/lib/databases/filter.test.ts && \
  git commit -m "feat: filter compilation (8 ops across 7 property types)"
```

---

## Task 6: Sort compilation + applied listRows

**Goal:** Multi-column ORDER BY using `db_cells` joins per sort key.

**Files:**
- Create: `src/lib/databases/sort.ts`
- Modify: `src/lib/databases/rows.ts` — extend `listRows` to accept filters + sorts

- [x] **Step 1: Write `sort.ts`**

```ts
import { sql as rawSql, type SQL } from 'drizzle-orm';
import * as schema from '@/db/schema';

export type SortSpec = { propertyId: string; direction: 'asc' | 'desc' };

export function compileSorts(sorts: SortSpec[], propsById: Map<string, schema.DbProperty>): SQL | undefined {
  if (sorts.length === 0) return undefined;
  const parts: SQL[] = [];
  for (const s of sorts) {
    const prop = propsById.get(s.propertyId);
    if (!prop) continue;
    parts.push(rawSql`(
      SELECT ${rawSql.raw(cellExpr(prop.type))} FROM db_cells dc
      WHERE dc.row_id = db_rows.id AND dc.property_id = ${s.propertyId}
      LIMIT 1
    ) ${rawSql.raw(s.direction.toUpperCase())} NULLS LAST`);
  }
  if (parts.length === 0) return undefined;
  return parts.reduce((acc, cur) => rawSql`${acc}, ${cur}`);
}

function cellExpr(type: schema.PropertyType): string {
  switch (type) {
    case 'number': return '(dc.value)::numeric';
    case 'date': return '(dc.value->>0)::timestamptz';
    case 'checkbox': return '(dc.value)::boolean';
    default: return 'dc.value::text';
  }
}
```

- [x] **Step 2: Apply in listRows**

Update `listRows` in `rows.ts` to:
1. Fetch properties once (for the propsById map).
2. Compose `whereClause = and(eq(databaseId), isNull(archivedAt), compileFilters(...))`.
3. Compose orderBy.

Replace the existing simple query with the parameterized version.

- [x] **Step 3: Test multi-property filter + multi-column sort**

A pair of integration tests exercising filter+sort combinations.

- [x] **Step 4: Commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test tests/lib/databases/
pnpm lint && pnpm typecheck && pnpm test
git add src/lib/databases/sort.ts src/lib/databases/rows.ts tests/lib/databases/ && \
  git commit -m "feat: sort compilation; listRows applies filters + sorts"
```

---

## Task 7: Views CRUD

**Files:**
- Create: `src/lib/databases/views.ts`
- Create: `tests/lib/databases/views.test.ts`

- [x] **Step 1: View helpers**

`createView`, `updateView`, `deleteView`. View config Zod schema:

```ts
const ViewConfig = z.object({
  sorts: z.array(z.object({ propertyId: z.string().uuid(), direction: z.enum(['asc', 'desc']) })).default([]),
  filters: z.array(z.object({ propertyId: z.string().uuid(), op: z.string(), value: z.unknown() })).default([]),
  groupBy: z.string().uuid().nullable().default(null),
  visibleProperties: z.array(z.string().uuid()).default([]),
});
```

- [x] **Step 2: Tests** — 5 cases: create per type, update config validated, delete cascades, kanban requires groupBy, default view always exists.

- [x] **Step 3: Commit**

```sh
git add src/lib/databases/views.ts tests/lib/databases/views.test.ts && \
  git commit -m "feat: view CRUD with config schema (sorts/filters/groupBy/visibleProperties)"
```

---

## Task 8: API routes — databases CRUD

**Files:**
- Create: `src/app/api/databases/route.ts` (POST create)
- Create: `src/app/api/databases/[databaseId]/route.ts` (GET, PATCH, DELETE)

Standard pattern: `requireRole('editor')` on writes, `requireRole('viewer')` on GET. Workspace scoping via `databases.workspace_id`.

- [x] **Step 1: Implement routes**

Concise — follow exactly the same shape as Plan 2's `/api/pages` routes. Use `getDatabaseWithMeta` for GET.

- [x] **Step 2: Tests** — 6+ cases across the four operations and role/workspace gates.

- [x] **Step 3: Commit**

```sh
git add 'src/app/api/databases/' tests/api/databases-routes.test.ts && \
  git commit -m "feat: API for database CRUD (workspace + role gated)"
```

---

## Task 9: API routes — properties / rows / views

**Files:**
- Many routes under `src/app/api/databases/[databaseId]/{properties,rows,views}/...`
- One consolidated test file `tests/api/databases-rows-filter.test.ts`

- [x] **Step 1: Implement routes**

Pattern: each route validates the database belongs to the caller's workspace (via `requireRole` + `getDatabaseWithMeta`), then delegates to the lib helper.

- [x] **Step 2: Tests** — 12+ cases (property create, update, delete; row create with cells, update cells, archive; views CRUD; filter+sort query via `GET /api/databases/[id]/rows?filter=...&sort=...`).

- [x] **Step 3: Commit**

```sh
git add 'src/app/api/databases/' tests/api/databases-rows-filter.test.ts && \
  git commit -m "feat: API for properties + rows + views + filter/sort query"
```

---

## Task 10: Database TipTap node + slash menu

**Goal:** Insert `/database` block. Stores `attrs.databaseId`. Renders a placeholder that mounts the client database component.

**Files:**
- Create: `src/components/editor/database-extension.ts`
- Modify: `src/components/editor/extensions.ts`
- Modify: `src/components/editor/slash-extension.ts`

- [x] **Step 1: Extension**

```ts
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DatabaseBlock } from '@/components/databases/database-block';

export const DatabaseNode = Node.create({
  name: 'database',
  group: 'block',
  atom: true,
  addAttributes() {
    return { databaseId: { default: null as string | null } };
  },
  parseHTML() { return [{ tag: 'div[data-cairn-database]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-cairn-database': 'true' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlock);
  },
});
```

- [x] **Step 2: Slash item**

```ts
{
  title: 'Database',
  description: 'Inline database with table/kanban/gallery',
  command: async (editor) => {
    // For the current page, create the database server-side first.
    // We need the page id — pull it from somewhere reachable from the editor;
    // the simplest approach: the editor is mounted in a page that knows its id,
    // so we attach the page id to the editor as a custom storage value at mount time.
    const pageId = (editor.storage as { cairn?: { pageId?: string } }).cairn?.pageId;
    if (!pageId) return;
    const res = await fetch('/api/databases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId }),
    });
    if (!res.ok) return;
    const { id } = (await res.json()) as { id: string };
    editor.chain().focus().insertContent({ type: 'database', attrs: { databaseId: id } }).run();
  },
},
```

- [x] **Step 3: Pass pageId into editor storage**

In `editor.tsx`, after `useEditor({ ... })`, set: `editor?.storage.cairn = { pageId };`.

- [x] **Step 4: Commit**

```sh
git add src/components/editor/ && \
  git commit -m "feat: database editor node + slash insertion"
```

---

## Task 11: DatabaseBlock client component + data hook

**Files:**
- Create: `src/components/databases/database-block.tsx`
- Create: `src/components/databases/use-database-data.ts`

- [x] **Step 1: Hook**

```tsx
'use client';
import { useEffect, useState } from 'react';

export type DatabaseMeta = {
  database: { id: string; name: string };
  properties: { id: string; name: string; type: string; config: unknown; position: number }[];
  views: { id: string; type: string; name: string; config: unknown; position: number }[];
};
export type RowData = { row: { id: string; createdAt: string }; cells: Record<string, unknown> };

export function useDatabaseData(databaseId: string, viewId: string | null) {
  const [meta, setMeta] = useState<DatabaseMeta | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const [metaRes, rowsRes] = await Promise.all([
      fetch(`/api/databases/${databaseId}`),
      fetch(`/api/databases/${databaseId}/rows${viewId ? `?viewId=${viewId}` : ''}`),
    ]);
    if (metaRes.ok) setMeta(await metaRes.json());
    if (rowsRes.ok) {
      const body = (await rowsRes.json()) as { rows: RowData[] };
      setRows(body.rows);
    }
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, [databaseId, viewId]);

  return { meta, rows, loading, refresh };
}
```

- [x] **Step 2: DatabaseBlock**

```tsx
'use client';
import { useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useDatabaseData } from './use-database-data';
import { TableView } from './table-view';
import { KanbanView } from './kanban-view';
import { GalleryView } from './gallery-view';
import { ViewSwitcher } from './view-switcher';

export function DatabaseBlock({ node }: NodeViewProps) {
  const databaseId = (node.attrs as { databaseId?: string }).databaseId;
  const [viewId, setViewId] = useState<string | null>(null);
  const data = useDatabaseData(databaseId ?? '', viewId);

  if (!databaseId || !data.meta) {
    return (
      <NodeViewWrapper className="my-4 rounded-md border p-4 text-sm text-muted-foreground">
        {data.loading ? 'Loading database…' : 'Database not found'}
      </NodeViewWrapper>
    );
  }
  const activeView = data.meta.views.find((v) => v.id === viewId) ?? data.meta.views[0]!;
  return (
    <NodeViewWrapper className="my-4 rounded-md border">
      <ViewSwitcher views={data.meta.views} activeId={activeView.id} onChange={setViewId} />
      {activeView.type === 'table' && <TableView meta={data.meta} rows={data.rows} onChange={data.refresh} view={activeView} databaseId={databaseId} />}
      {activeView.type === 'kanban' && <KanbanView meta={data.meta} rows={data.rows} onChange={data.refresh} view={activeView} databaseId={databaseId} />}
      {activeView.type === 'gallery' && <GalleryView meta={data.meta} rows={data.rows} onChange={data.refresh} view={activeView} databaseId={databaseId} />}
    </NodeViewWrapper>
  );
}
```

- [x] **Step 3: Commit**

```sh
git add src/components/databases/database-block.tsx src/components/databases/use-database-data.ts && \
  git commit -m "feat: DatabaseBlock client wrapper + data hook"
```

---

## Task 12: Table view

**Goal:** Spreadsheet-style grid with inline cell editing and clickable column headers (for sort).

**Files:**
- Create: `src/components/databases/table-view.tsx`
- Create: `src/components/databases/cell-editor.tsx` (small per-type editor)

- [x] **Step 1: Cell editor (per type)**

Switches over property type to render the right input. On blur or Enter, PATCHes `/api/databases/[id]/rows/[rowId]` with the new cell value.

- [x] **Step 2: Table view**

Renders `<table>` with property columns; one `<tr>` per row. Last row is a "+ New row" inline button. Header click toggles sort direction (writes back to the view's config via PATCH).

- [x] **Step 3: Commit**

```sh
git add src/components/databases/table-view.tsx src/components/databases/cell-editor.tsx && \
  git commit -m "feat: database table view with inline cell editing"
```

---

## Task 13: Kanban view

**Goal:** Columns = options of a `select` property; rows render as cards within each column. Drag a card to change its select value.

**Files:**
- Create: `src/components/databases/kanban-view.tsx`

- [x] **Step 1: Kanban view**

Reads `view.config.groupBy` (the select property id). Iterates options, groups rows by their cell value for that property. Native HTML5 drag-and-drop between columns updates the cell.

If `groupBy` is not configured or the property type isn't `select`, render a hint to "Pick a select property to group by."

- [x] **Step 2: Commit**

```sh
git add src/components/databases/kanban-view.tsx && \
  git commit -m "feat: kanban view with drag-to-reclassify"
```

---

## Task 14: Gallery view

**Files:**
- Create: `src/components/databases/gallery-view.tsx`

Cards in a CSS grid. Each card shows the first text/title-ish property prominently and other visible properties below.

- [x] **Step 1: Implement + commit**

```sh
git add src/components/databases/gallery-view.tsx && \
  git commit -m "feat: gallery view with card layout"
```

---

## Task 15: View switcher + property panel

**Files:**
- Create: `src/components/databases/view-switcher.tsx`
- Create: `src/components/databases/property-panel.tsx`
- Create: `src/components/databases/filter-builder.tsx`
- Create: `src/components/databases/sort-builder.tsx`

ViewSwitcher: a row of tabs across the top of the database block. "+" button to add a new view (modal asks for name + type).

PropertyPanel: collapsible drawer; shows the property list with rename/edit, "Add property" button. For `select` / `multi_select`, an inline options editor.

FilterBuilder / SortBuilder: tiny popovers attached to view header buttons. Update the active view's `config` via PATCH.

- [x] **Step 1: Implement + commit**

```sh
git add src/components/databases/view-switcher.tsx src/components/databases/property-panel.tsx \
        src/components/databases/filter-builder.tsx src/components/databases/sort-builder.tsx && \
  git commit -m "feat: view switcher + property panel + filter/sort builders"
```

---

## Task 16: E2E smoke + CHANGELOG

- [x] **Step 1: Smoke**

Bring up docker compose, sign in, create a page, insert `/database`, add properties (text Title, select Status with options Todo/Doing/Done, date Due), add 3 rows, switch to Kanban grouped by Status, drag a card from Todo to Doing, switch to Gallery, add a filter Status=Doing, verify only 1 row shows.

- [x] **Step 2: CHANGELOG entry**

```markdown
### Added (Plan 5 — Databases)
- 5 new tables (`databases`, `db_properties`, `db_rows`, `db_cells`, `db_views`) + enums for property/view types.
- Server helpers for database, property, row+cell, view CRUD with type-specific coercion and config validation.
- Filter compilation (AND of conditions, 8 ops across 7 property types) and multi-column sort compilation.
- API surface for inline databases under `/api/databases/...`.
- TipTap `database` node inserted via slash menu.
- Table, kanban, and gallery views with inline editing, drag-to-reclassify, and per-view sort/filter config.
- View switcher, property panel, filter/sort builders.
```

- [x] **Step 3: Tear down + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && docker compose down
git add CHANGELOG.md && git commit -m "docs: changelog entry for databases (Plan 5)"
```

---

## Done

After this plan: inline databases work end-to-end inside pages with three views, filtering, sorting, and live editing. **Next plan:** `2026-MM-DD-cairn-release-and-ship.md` — drag handle polish, multi-arch ghcr.io release workflow, README polish, tag v0.1.0.
