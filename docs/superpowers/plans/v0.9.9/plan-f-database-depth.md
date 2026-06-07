# v0.9.9 Plan F — Database Depth

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Close the v0.9.8 "database depth" gap (scope doc §G5 + the #40/#219 See-also finding): give every inline/full-page database a Notion-grade row-detail drawer with a body editor (#62/#241), readable Title-Case property type labels plus eight new property types (#65/66 = #242/#243), left-margin row +/⋮⋮ handles (#71/#245), optimistic add-view + add-filter (#67/95 = #244/#263), shipped-or-annotated Calendar/Timeline/Board (#87/#264), a differentiated See-also similarity score (#40/#219), and a tightened row container with labeled floating icons (#39/#218). Single PR onto `patches/v0.9.9`, HOLD for GO.

**Architecture:** Inline databases live in 5 tables (`databases`, `db_properties`, `db_rows`, `db_cells`, `db_views`) — see `src/db/schema/databases.ts`. Cells are jsonb keyed by property id, type-coerced on write in `src/lib/databases/rows.ts#coerce`. Filter/sort compile to correlated `db_cells` subqueries in `src/lib/databases/filter.ts` + `sort.ts`. The table view (`src/components/databases/table-view.tsx`) delegates non-grouped rendering to the virtualized body (`virtualized-row-body.tsx`) and currently exposes only a per-row `MessageSquare` "peek" → comments dialog (`row-peek-panel.tsx`). The client data hook `use-database-data.ts` fetches meta + rows over `GET /api/databases/:id` and `GET /api/databases/:id/rows`, and exposes a `refresh()` callback used as the universal `onChange`. The new row-detail drawer reuses that contract. See-also is a pgvector cosine kNN in `src/lib/search/see-also.ts` fed by single mean-pooled full-document embeddings written by `src/lib/search/embed-page.ts` (`embedPage`) using the provider in `src/lib/search/embed.ts`. Migrations are applied at container start by `src/server/entrypoint.ts`; `db:generate` does NOT emit extensions/triggers/FKs — append by hand.

**Tech Stack:** Next.js 16 App Router (React 19, TS6 strict, `proxy.ts` auth gate), Drizzle + Postgres 16 (pgvector), Biome v2 (0 errors), Vitest 4 + Testcontainers v12 (real Postgres; `isolate: true`), TipTap 3, Tailwind v4 + shadcn/ui (new-york), i18n en/es/ar via `useT()` from `src/lib/i18n/provider`. pnpm only. Prefix every shell command with `source ~/.zshenv && `.

---

## F1 — Row-detail drawer with all properties + body editor (#62/#241)

The single biggest item. Today clicking a row only edits a cell inline; there is no row-detail surface and no per-row rich-text body. We add a `db_rows.body` jsonb column (migration **0062**), a `GET/PATCH /api/databases/:id/rows/:rowId` body endpoint, and a shadcn `Sheet`-based `RowDetailPanel` that lists every property (reusing `CellEditor`) plus a TipTap body editor. Row title affordance opens the drawer; the existing comments `MessageSquare` becomes a tab inside the drawer.

**Files:**
- Modify: `src/db/schema/databases.ts` (add `body` column to `dbRows`)
- Create: `drizzle/migrations/0062_db_row_body.sql`
- Modify: `src/lib/databases/rows.ts` (add `getRowDetail`, `updateRowBody`; include `body` in `RowWithCells`)
- Modify: `src/app/api/databases/[databaseId]/rows/[rowId]/route.ts` (add `GET` detail + extend `PATCH` to accept `body`)
- Modify: `src/components/databases/use-database-data.ts` (`RowData.row.body`)
- Create: `src/components/databases/row-detail-panel.tsx`
- Modify: `src/components/databases/table-view.tsx` (wire row title → open detail)
- Modify: `src/components/databases/virtualized-row-body.tsx` (wire title click → `onOpenDetail`)
- Create: `tests/lib/databases/row-body.test.ts`
- Create: `tests/api/databases/row-detail.test.ts`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:

- [ ] Write failing migration-shape test `tests/lib/databases/row-body.test.ts`: after running migrations, `INSERT INTO db_rows (...)` then `SELECT body FROM db_rows` returns `null` by default; `getRowDetail(db, {rowId, databaseId, workspaceId})` returns `{ row, cells, body }` where `body` is `null` for a fresh row.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/databases/row-body.test.ts` (fails — no `body` column, no `getRowDetail`).
- [ ] Add the column to the Drizzle model in `src/db/schema/databases.ts` inside `dbRows`, after `updatedAt`:
  ```ts
  body: jsonb('body').$type<unknown>(),
  ```
- [ ] Generate then hand-finalize the migration: `source ~/.zshenv && pnpm db:generate`. Ensure `drizzle/migrations/0062_db_row_body.sql` contains exactly:
  ```sql
  ALTER TABLE "db_rows" ADD COLUMN "body" jsonb;
  ```
  (No trigger/FK needed — `body` is plain jsonb, nullable, no default.)
- [ ] Implement `getRowDetail` + `updateRowBody` in `src/lib/databases/rows.ts`. `getRowDetail` reuses the `listRows` cell/relation/rollup/formula resolution for ONE row id (workspace-scope checked via the `databases` join exactly like `updateCells`). `updateRowBody` validates ownership then `UPDATE db_rows SET body = $body, updated_at = now() WHERE id = $rowId`. Export `RowDetail = { row: schema.DbRow; cells: Record<string, unknown>; body: unknown }`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/databases/row-body.test.ts`.
- [ ] Commit: `feat(db): add db_rows.body column + getRowDetail/updateRowBody helpers (#241)`
- [ ] Write failing route test `tests/api/databases/row-detail.test.ts` (mock `@/lib/auth/config` with `__set`): `GET /api/databases/:id/rows/:rowId` returns `{ row, cells, body }`; `PATCH` with `{ body: {type:'doc',content:[]} }` returns 204 and persists; `PATCH` with both `cells` and `body` updates both; cross-workspace row → the helper throws → 404/400 via `errToResponse`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/api/databases/row-detail.test.ts`.
- [ ] In `src/app/api/databases/[databaseId]/rows/[rowId]/route.ts`: add a `GET` (role `viewer`) calling `getRowDetail`; extend `PatchInput` to `z.object({ cells: z.record(z.string(), z.unknown()).optional(), body: z.unknown().optional() })` and call `updateCells` only when `cells` present, `updateRowBody` only when `body` present (both in the same request allowed).
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/api/databases/row-detail.test.ts`.
- [ ] Commit: `feat(db): row-detail GET + body PATCH endpoint (#241)`
- [ ] Add i18n. Append to `messages/en.json`:
  ```json
  "databases.rowDetail.title": "Row",
  "databases.rowDetail.open": "Open row",
  "databases.rowDetail.propertiesTab": "Properties",
  "databases.rowDetail.commentsTab": "Comments",
  "databases.rowDetail.bodyLabel": "Notes",
  "databases.rowDetail.bodyPlaceholder": "Add notes for this row…",
  "databases.rowDetail.close": "Close"
  ```
  `messages/es.json`:
  ```json
  "databases.rowDetail.title": "Fila",
  "databases.rowDetail.open": "Abrir fila",
  "databases.rowDetail.propertiesTab": "Propiedades",
  "databases.rowDetail.commentsTab": "Comentarios",
  "databases.rowDetail.bodyLabel": "Notas",
  "databases.rowDetail.bodyPlaceholder": "Añade notas para esta fila…",
  "databases.rowDetail.close": "Cerrar"
  ```
  `messages/ar.json`:
  ```json
  "databases.rowDetail.title": "صف",
  "databases.rowDetail.open": "فتح الصف",
  "databases.rowDetail.propertiesTab": "الخصائص",
  "databases.rowDetail.commentsTab": "التعليقات",
  "databases.rowDetail.bodyLabel": "ملاحظات",
  "databases.rowDetail.bodyPlaceholder": "أضف ملاحظات لهذا الصف…",
  "databases.rowDetail.close": "إغلاق"
  ```
- [ ] Write failing component test `tests/components/databases/row-detail-panel.test.tsx`: rendering `<RowDetailPanel databaseId rowId meta open onOpenChange canComment currentUserId currentRole />` with a stubbed `GET .../rows/:rowId` shows the `Properties` tab with one `CellEditor` per `meta.properties` entry (assert `aria-label` per property name) and the `Comments` tab mounts `RowComments`; closing fires `onOpenChange(false)`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/databases/row-detail-panel.test.tsx`.
- [ ] Implement `src/components/databases/row-detail-panel.tsx`: a shadcn `Sheet` (`side="right"`, `className="w-full sm:max-w-xl"`) with a Radix `Tabs` (`Properties` | `Comments`). Properties tab fetches `GET /api/databases/${databaseId}/rows/${rowId}`, maps `meta.properties` → a label (`propTypeLabel` from F2) + `<CellEditor databaseId rowId property value={cells[p.id]} onSaved={refresh}/>`, then a body section: a lightweight TipTap editor (reuse the existing read/write editor config; debounce `onUpdate` → `PATCH {body}`) labeled `databases.rowDetail.bodyLabel` with `databases.rowDetail.bodyPlaceholder`. Comments tab mounts `<RowComments .../>` (same props `row-peek-panel.tsx` passed). Use `useT()` for every string.
  ```tsx
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
      <SheetHeader>
        <SheetTitle>{t('databases.rowDetail.title')}</SheetTitle>
      </SheetHeader>
      <Tabs defaultValue="properties" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="properties">{t('databases.rowDetail.propertiesTab')}</TabsTrigger>
          <TabsTrigger value="comments">{t('databases.rowDetail.commentsTab')}</TabsTrigger>
        </TabsList>
        {/* properties + body, then comments */}
      </Tabs>
    </SheetContent>
  </Sheet>
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/databases/row-detail-panel.test.tsx`.
- [ ] Wire the open affordance. In `virtualized-row-body.tsx` add prop `onOpenDetail: (rowId: string) => void`; in the first-column `<span>` make the cell value clickable to open detail (wrap `CellEditor` is wrong — instead add a small "expand" button `aria-label={t('databases.rowDetail.open')}` rendering `<Maximize2 className="size-3.5"/>` shown on hover, calling `onOpenDetail(node.row.id)`). In `table-view.tsx` add `detailRowId` state, pass `onOpenDetail={(id)=>setDetailRowId(id)}` into `VirtualizedRowBody` and the grouped `rowTr`, and mount `<RowDetailPanel ... open={detailRowId!==null} rowId={detailRowId ?? ''} onOpenChange={(o)=>{ if(!o) setDetailRowId(null); }} meta={meta} refresh={onChange} />`. Keep the existing `MessageSquare` peek for now (the drawer's Comments tab supersedes it visually; removing it is F7's tidy-up).
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/databases/table-view.test.tsx tests/components/databases/row-detail-panel.test.tsx`.
- [ ] Commit: `feat(db): row-detail drawer with properties + body editor + comments tab (#241)`

## F2 — Title-Case property type labels + eight new property types (#65/66 = #242/#243)

Today the type enum is `['text','number','select','multi_select','date','checkbox','url','formula','relation','rollup']` and the property picker renders the raw enum value (`property-panel.tsx:184` shows `{t}` = `multi_select`). We add a shared label helper + i18n, then extend the enum with `person`, `file`, `email`, `phone`, `created_time`, `last_edited_time`, `created_by`, `last_edited_by` (migration **0063**), with cell coercion, filter/sort support, and editor UI. The four `*_time`/`*_by` types are **computed/read-only** (derived from `db_rows.created_at`/`updated_at`/`created_by` + a new `updated_by` column), so they are never user-writable.

**Files:**
- Create: `src/lib/databases/property-labels.ts`
- Modify: `src/db/schema/databases.ts` (extend `propertyType` enum; add `dbRows.updatedBy`)
- Create: `drizzle/migrations/0063_property_types.sql`
- Modify: `src/lib/databases/properties.ts` (`ConfigByType` entries for new types)
- Modify: `src/lib/databases/rows.ts` (`coerce` cases; set `updatedBy`; populate computed cells in `listRows`)
- Modify: `src/lib/databases/filter.ts` + `src/lib/databases/sort.ts` (predicates/exprs for new types)
- Modify: `src/components/databases/property-panel.tsx` (label the type picker)
- Modify: `src/components/databases/cell-editor.tsx` (editors for new types)
- Modify: `src/components/databases/filters-config.tsx` (`OPS_BY_TYPE`)
- Create: `tests/lib/databases/property-types.test.ts`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:

- [ ] Write failing test `tests/lib/databases/property-types.test.ts` part 1 (labels): `import { propTypeLabel } from '@/lib/databases/property-labels'` — `propTypeLabel('multi_select', t)` === `'Multi-select'`, `propTypeLabel('created_time', t)` === `'Created time'`, `propTypeLabel('last_edited_by', t)` === `'Last edited by'` (where `t` is the en catalog lookup).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/databases/property-types.test.ts`.
- [ ] Create `src/lib/databases/property-labels.ts`:
  ```ts
  import type { PropertyType } from '@/db/schema';
  import type { TFn } from '@/lib/i18n/t';
  export function propTypeLabel(type: PropertyType, t: TFn): string {
    return t(`database.propertyType.${type}`);
  }
  ```
  (`TFn` is the call signature of `useT()`'s return — confirm the exported type name in `src/lib/i18n/t.ts` and import it; if unexported, type the param as `(key: string) => string`.)
- [ ] Add i18n. Append to `messages/en.json`:
  ```json
  "database.propertyType.text": "Text",
  "database.propertyType.number": "Number",
  "database.propertyType.select": "Select",
  "database.propertyType.multi_select": "Multi-select",
  "database.propertyType.date": "Date",
  "database.propertyType.checkbox": "Checkbox",
  "database.propertyType.url": "URL",
  "database.propertyType.formula": "Formula",
  "database.propertyType.relation": "Relation",
  "database.propertyType.rollup": "Rollup",
  "database.propertyType.person": "Person",
  "database.propertyType.file": "File",
  "database.propertyType.email": "Email",
  "database.propertyType.phone": "Phone",
  "database.propertyType.created_time": "Created time",
  "database.propertyType.last_edited_time": "Last edited time",
  "database.propertyType.created_by": "Created by",
  "database.propertyType.last_edited_by": "Last edited by"
  ```
  `messages/es.json`:
  ```json
  "database.propertyType.text": "Texto",
  "database.propertyType.number": "Número",
  "database.propertyType.select": "Selección",
  "database.propertyType.multi_select": "Selección múltiple",
  "database.propertyType.date": "Fecha",
  "database.propertyType.checkbox": "Casilla",
  "database.propertyType.url": "URL",
  "database.propertyType.formula": "Fórmula",
  "database.propertyType.relation": "Relación",
  "database.propertyType.rollup": "Resumen",
  "database.propertyType.person": "Persona",
  "database.propertyType.file": "Archivo",
  "database.propertyType.email": "Correo electrónico",
  "database.propertyType.phone": "Teléfono",
  "database.propertyType.created_time": "Fecha de creación",
  "database.propertyType.last_edited_time": "Última edición",
  "database.propertyType.created_by": "Creado por",
  "database.propertyType.last_edited_by": "Editado por última vez"
  ```
  `messages/ar.json`:
  ```json
  "database.propertyType.text": "نص",
  "database.propertyType.number": "رقم",
  "database.propertyType.select": "اختيار",
  "database.propertyType.multi_select": "اختيار متعدد",
  "database.propertyType.date": "تاريخ",
  "database.propertyType.checkbox": "مربع اختيار",
  "database.propertyType.url": "رابط",
  "database.propertyType.formula": "صيغة",
  "database.propertyType.relation": "علاقة",
  "database.propertyType.rollup": "تجميع",
  "database.propertyType.person": "شخص",
  "database.propertyType.file": "ملف",
  "database.propertyType.email": "بريد إلكتروني",
  "database.propertyType.phone": "هاتف",
  "database.propertyType.created_time": "وقت الإنشاء",
  "database.propertyType.last_edited_time": "آخر تعديل",
  "database.propertyType.created_by": "أنشأ بواسطة",
  "database.propertyType.last_edited_by": "آخر تعديل بواسطة"
  ```
- [ ] Run to pass label part: `source ~/.zshenv && pnpm vitest run tests/lib/databases/property-types.test.ts`.
- [ ] Commit: `feat(db): proper-cased property-type labels + i18n (#242)`
- [ ] Extend the test (part 2, schema + coercion): after migration, `propertyType.enumValues` includes the 8 new members; `coerce('email', 'A@B.COM')` === `'a@b.com'` (lowercased, trimmed) and `coerce('email', 'not an email')` === `null`; `coerce('phone', ' +1 (555) ')` === `'+1 (555)'` (trimmed string); `coerce('person', ['<uuid>'])` returns a deduped string-id array (mirror `relation`); `coerce('file', [{id,name}])` returns the array unchanged when shaped, else `[]`; `coerce('created_time', anything)` === `null` (computed, never stored).
- [ ] Run to fail.
- [ ] Extend the enum in `src/db/schema/databases.ts`:
  ```ts
  export const propertyType = pgEnum('property_type', [
    'text','number','select','multi_select','date','checkbox','url',
    'formula','relation','rollup',
    'person','file','email','phone',
    'created_time','last_edited_time','created_by','last_edited_by',
  ]);
  ```
  Add `updatedBy` to `dbRows` after `createdBy`:
  ```ts
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  ```
- [ ] `source ~/.zshenv && pnpm db:generate`, then hand-finalize `drizzle/migrations/0063_property_types.sql`. `db:generate` does not emit enum-value additions reliably; write the full SQL:
  ```sql
  ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'person';
  ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'file';
  ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'email';
  ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'phone';
  ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'created_time';
  ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'last_edited_time';
  ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'created_by';
  ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'last_edited_by';

  ALTER TABLE "db_rows" ADD COLUMN "updated_by" uuid;
  ALTER TABLE "db_rows"
    ADD CONSTRAINT "db_rows_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null;
  ```
  NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside the same transaction that later uses the value. The entrypoint migrator runs each migration file in its own transaction, so keep the `ADD VALUE` statements in this file and use the new values only from later migrations / runtime — safe here.
- [ ] Add `ConfigByType` entries in `src/lib/databases/properties.ts` (all `NoConfig` except `person`/`file` which allow an optional shape; reuse `NoConfig` for the four computed types so they reject stray config):
  ```ts
  person: NoConfig, file: NoConfig, email: NoConfig, phone: NoConfig,
  created_time: NoConfig, last_edited_time: NoConfig,
  created_by: NoConfig, last_edited_by: NoConfig,
  ```
- [ ] Extend `coerce` in `src/lib/databases/rows.ts`:
  ```ts
  case 'email': {
    if (typeof value !== 'string') return null;
    const v = value.trim().toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
  }
  case 'phone':
    return typeof value === 'string' ? value.trim() : null;
  case 'person': {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>(); const ids: string[] = [];
    for (const v of value) { if (typeof v !== 'string') continue; const t = v.trim(); if (!t || seen.has(t)) continue; seen.add(t); ids.push(t); }
    return ids;
  }
  case 'file':
    return Array.isArray(value) ? value.filter((f) => f && typeof f === 'object') : [];
  case 'created_time':
  case 'last_edited_time':
  case 'created_by':
  case 'last_edited_by':
    return null; // computed at read time; never persisted
  ```
- [ ] In `createRow`/`updateCells` set `updatedBy`: `createRow` inserts `{ ..., createdBy, updatedBy: input.createdBy }`; `updateCells` needs an `editorUserId` — thread it from the route (`ctx.userId`) and set `updated_by` in the final `UPDATE db_rows`. Update the route `PatchInput` call accordingly.
- [ ] In `listRowsInner`, after formula population, fill computed cells per row:
  ```ts
  for (const p of props) {
    if (p.type === 'created_time') cells[p.id] = r.createdAt;
    else if (p.type === 'last_edited_time') cells[p.id] = r.updatedAt;
    else if (p.type === 'created_by') cells[p.id] = r.createdBy;
    else if (p.type === 'last_edited_by') cells[p.id] = r.updatedBy;
  }
  ```
- [ ] Add filter/sort support in `filter.ts` + `sort.ts`. In `filter.ts#predicateFor`: route `email`/`phone` through the existing `text`/`url`/`select` case (add them to that case label). Computed time/by types filter against the row column, not `db_cells` — they need a special path: in `compileFilters`, when `prop.type` is one of the computed types, emit a direct predicate on `db_rows` (e.g. `created_time` → `db_rows.created_at`) instead of the `EXISTS(db_cells...)` wrapper. In `sort.ts#cellExpr`, computed types are also handled in `compileSorts` by ordering on the row column directly. Keep `person`/`file` unsortable/unfilterable (return `null`/skip) for this version.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/databases/property-types.test.ts`.
- [ ] Commit: `feat(db): add person/file/email/phone + created/edited time/by property types (#243)`
- [ ] Wire the UI. In `property-panel.tsx`: change `TYPES` to include the 8 new user-creatable ones — but EXCLUDE writing-disallowed combos is unnecessary; instead split into a creatable list (all except none) and render labels: replace `{t}` in the `SelectItem` with `{propTypeLabel(t, useT())}` — concretely map `TYPES.map((pt) => <SelectItem key={pt} value={pt}>{propTypeLabel(pt, t)}</SelectItem>)` (rename the inner shadowing `t` loop var). Add the 8 members to `TYPES`. In `cell-editor.tsx` add cases: `email` → `<input type="email">`, `phone` → `<input type="tel">`, `person` → reuse a simplified comma-separated id input (or `RelationCell`-style; for this version a text input of comma-separated names is acceptable, coerced server-side), `file` → render existing file chips read-only with an "Attach" affordance deferred to a follow-up (render names, no upload yet — annotate inline), and the four computed types → read-only `<span className="text-sm text-muted-foreground">` showing the value (format dates with `.slice(0,10)`, resolve `created_by`/`last_edited_by` ids to names via the already-loaded member list if available else show the id). In `filters-config.tsx#OPS_BY_TYPE` add `email`/`phone` (same op list as `text`) and `created_time`/`last_edited_time` (same as `date`); leave `person`/`file`/`created_by`/`last_edited_by` out of `OPS_BY_TYPE` so they are non-filterable.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/databases/property-panel.test.tsx tests/components/databases/cell-editor.test.tsx`.
- [ ] Commit: `feat(db): property-type picker labels + cell editors + filter ops for new types (#242 #243)`

## F3 — Row +/⋮⋮ handles in the left margin (#71/#245)

Today the add-child `+` and a per-row hover affordance sit inline after the cell value inside the first column; the right-click/context actions live only in the long-press sheet. Notion places a `⋮⋮` drag handle + `+` insert handle in the left gutter. We add a fixed left gutter to each virtualized row hosting `+` (insert sibling/child) and `⋮⋮` (opens a popover with Duplicate / Delete / Open — reusing existing handlers), shown on row hover.

**Files:**
- Modify: `src/components/databases/virtualized-row-body.tsx` (left gutter handles)
- Modify: `src/components/databases/table-view.tsx` (pass `onOpenDetail` already from F1; pass `onDeleteRow`/`onDuplicateRow` handlers)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Create: `tests/components/databases/row-handles.test.tsx`

Steps:

- [ ] Write failing test `tests/components/databases/row-handles.test.tsx`: a rendered virtualized body shows, per row, a button `aria-label={t('db.row.insert')}` (the `+`) and a button `aria-label={t('db.row.menu')}` (the `⋮⋮`) positioned in a left gutter element (`data-row-gutter`); clicking `⋮⋮` opens a menu with `Open`, `Duplicate`, `Delete` items.
- [ ] Run to fail.
- [ ] Add i18n. `messages/en.json`:
  ```json
  "db.row.insert": "Insert row below",
  "db.row.menu": "Row actions",
  "db.row.open": "Open",
  "db.row.duplicate": "Duplicate",
  "db.row.delete": "Delete"
  ```
  `messages/es.json`:
  ```json
  "db.row.insert": "Insertar fila debajo",
  "db.row.menu": "Acciones de fila",
  "db.row.open": "Abrir",
  "db.row.duplicate": "Duplicar",
  "db.row.delete": "Eliminar"
  ```
  `messages/ar.json`:
  ```json
  "db.row.insert": "إدراج صف أدناه",
  "db.row.menu": "إجراءات الصف",
  "db.row.open": "فتح",
  "db.row.duplicate": "تكرار",
  "db.row.delete": "حذف"
  ```
- [ ] Implement in `virtualized-row-body.tsx`: prepend a gutter `<div data-row-gutter>` to each `data-virtual-row` (before the first cell), `style={{ width: 32, minWidth: 32 }}`, containing a `+` button (`aria-label={t('db.row.insert')}` → `onAddChild(node.row.id)`) and a `⋮⋮` button (`aria-label={t('db.row.menu')}`) opening a shadcn `DropdownMenu` with items Open (`onOpenDetail`), Duplicate (`onDuplicateRow`), Delete (`onDeleteRow`). Hide both behind `opacity-0 group-hover:opacity-100 focus-within:opacity-100` and add `group` to the row's className. Remove the now-redundant inline trailing `+` and `MessageSquare` from the first cell (their function moves to gutter + drawer). Keep the disclosure chevron in the first cell.
- [ ] Thread `onDeleteRow`/`onDuplicateRow` from `table-view.tsx` (lift the existing `LongPressRow` `onDelete`/`onDuplicate` bodies into `table-view` callbacks taking a `rowId`, passing into both `VirtualizedRowBody` and the grouped `rowTr`). Keep `LongPressRow` for mobile long-press but point it at the same lifted handlers.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/databases/row-handles.test.tsx`.
- [ ] Commit: `feat(db): left-margin row insert + actions handles (#245)`

## F4 — Optimistic add-view + add-filter (#67/95 = #244/#263)

`#244`: clicking "+ Add filter" the first time is a no-op because `addFilter()` posts then awaits `onChange()` (a full refetch) before the popover state updates, and the popover closes on the property `Select` mount race. `#263`: gallery/any add-view fires the POST and calls `onViewsChanged()` but the new tab does not appear until the parent refetch completes, and on slow refetch the tab silently never shows. Both are the G11 refetch-gap: mutate → optimistic local insert → background refetch reconciles. We make `addFilter` insert into local state synchronously (then persist), and make `ViewSwitcher`/`use-database-data` optimistically append the created view to `meta.views` and select it before the refetch returns.

**Files:**
- Modify: `src/components/databases/filters-config.tsx` (local optimistic filter list)
- Modify: `src/components/databases/view-switcher.tsx` (optimistic tab append on create)
- Modify: `src/components/databases/use-database-data.ts` (expose `addViewOptimistic`)
- Create: `tests/components/databases/add-filter.test.tsx`
- Create: `tests/components/databases/add-view-optimistic.test.tsx`

Steps:

- [ ] Write failing test `tests/components/databases/add-filter.test.tsx`: mount `FiltersConfig`, open the popover, click the `database.filter.add` button ONCE, and assert a filter row (property `Select` with `aria-label` `database.filter.property`) appears immediately in the DOM (before the mocked PATCH resolves). Assert the PATCH to `/views/:id` fires with the new filter in its body.
- [ ] Run to fail (today the row appears only after `onChange()` refetch resolves; with a never-resolving PATCH mock the assertion fails).
- [ ] In `filters-config.tsx`, stop deriving `filters` purely from `view.config`; hold a local `const [localFilters, setLocalFilters] = useState<Condition[]>(filters)` seeded from config and re-synced via `useEffect([view.config])`. `addFilter`/`removeFilter`/`setFilter` update `localFilters` synchronously, then call `save(next)` (fire-and-forget persist + background `onChange`). Render from `localFilters`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/databases/add-filter.test.tsx`.
- [ ] Commit: `fix(db): add-filter inserts optimistically on first click (#244)`
- [ ] Write failing test `tests/components/databases/add-view-optimistic.test.tsx`: mount `ViewSwitcher` with `views=[table]`; stub `POST /views` to resolve slowly with `{id:'v2'}`; trigger `addSimpleView('gallery')`; assert a new tab labeled `database.view.type.gallery` appears immediately (before POST resolves) and `onChange('v2-temp'|'v2')` is called. After POST resolves, `onViewsChanged()` was called for reconciliation.
- [ ] Run to fail.
- [ ] In `use-database-data.ts` add `addViewOptimistic(view: {id,type,name,config})` that `setMeta((m)=> m ? {...m, views:[...m.views, {...view, position: m.views.length}]} : m)`, returning the temp view. In `view-switcher.tsx`, before each POST, call `onAddViewOptimistic?.(tempView)` (temp id `tmp-${crypto.randomUUID()}`), `onChange(tempView.id)`; after POST resolves with the real id, call `onViewsChanged()` (background refetch reconciles the temp id away) and `onChange(real.id)`. Thread `onAddViewOptimistic` from the database block (the component owning `useDatabaseData`).
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/databases/add-view-optimistic.test.tsx`.
- [ ] Commit: `fix(db): optimistic add-view tab appears before refetch (#263)`

## F5 — Implement OR annotate Calendar/Timeline/Board (#87/#264)

`view-switcher.tsx` already lists Calendar/Timeline/Board and views exist (`calendar-view.tsx`, `timeline-view.tsx`, `kanban-view.tsx`). The scope finding is that disabled entries are unexplained and that the add-view picker grays them with no path. We have working `disabled.*` tooltips already (`view-switcher.tsx:198`). Decision for v0.9.9: the three views ARE implemented; the gap is purely the **enabled path + a "Requires a date/select property" affordance that also offers to create one**. We keep them enabled when a qualifying property exists, and when none exists we show the existing disabled tooltip PLUS a "coming soon" badge is wrong here — instead annotate clearly that the property is the blocker. No new view engine work; this item is a clarity + reachability pass.

**Files:**
- Modify: `src/components/databases/view-switcher.tsx` (clarify disabled state, add a "needs property" hint row)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Create: `tests/components/databases/view-add-availability.test.tsx`

Steps:

- [ ] Write failing test `tests/components/databases/view-add-availability.test.tsx`: with `dateProperties=[]` + `selectProperties=[]`, opening the add-view picker shows Calendar/Timeline/Board as disabled items each carrying a `title` from `database.view.disabled.*`, AND a single hint line (`database.view.needProperty`) is rendered in the picker footer. With a date property present, Calendar/Timeline are enabled (not `aria-disabled`).
- [ ] Run to fail.
- [ ] Add i18n. `messages/en.json`:
  ```json
  "database.view.needProperty": "Calendar, Timeline and Board need a date or select property — add one from the property menu."
  ```
  `messages/es.json`:
  ```json
  "database.view.needProperty": "Calendario, Cronograma y Tablero necesitan una propiedad de fecha o selección; añade una desde el menú de propiedades."
  ```
  `messages/ar.json`:
  ```json
  "database.view.needProperty": "تحتاج طرق العرض التقويم والجدول الزمني واللوحة إلى خاصية تاريخ أو اختيار — أضف واحدة من قائمة الخصائص."
  ```
- [ ] In `view-switcher.tsx`, append a footer hint inside `SelectContent` (after the mapped items) rendered only when `dateProperties.length === 0 && selectProperties.length === 0`:
  ```tsx
  <div className="border-t px-2 py-1.5 text-xs text-muted-foreground">{t('database.view.needProperty')}</div>
  ```
  Confirm enabled state logic (`dateDisabled`/`selectDisabled`) is unchanged and the tooltips already wire `database.view.disabled.*`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/databases/view-add-availability.test.tsx`.
- [ ] Commit: `feat(db): clarify Calendar/Timeline/Board availability in add-view picker (#264)`

## F6 — See-also similarity score differentiation (#40/#219)

`findRelatedPages` (`src/lib/search/see-also.ts:114`) computes `score = 1 - cosine_distance`. The finding is that scores cluster (all neighbors look ~equally similar). Root cause hypothesis confirmed by reading the pipeline: `embedPage` (`src/lib/search/embed-page.ts:45-57`) embeds the **entire** `content_text` as ONE mean-pooled, L2-normalized vector (`embed.ts:120`, `pooling:'mean', normalize:true`). For multi-paragraph pages, mean-pooling collapses topical signal toward the corpus centroid, so pairwise cosine distances compress into a narrow band → near-uniform scores. Fix: (a) truncate the embed input to a bounded prefix so long docs don't wash out (matches the SNIPPET model and keeps the lead/topic sentences dominant); (b) surface a **relative** score (min-max rescaled across the returned set) so the panel differentiates neighbors even when absolute cosines are close, while keeping the absolute `score` for callers. We INVESTIGATE first with a distribution test against a seeded corpus, then apply the bounded-input fix and relative scoring.

**Files:**
- Modify: `src/lib/search/embed-page.ts` (bound the embed input length)
- Modify: `src/lib/search/see-also.ts` (add `relativeScore` to `RelatedPage`, min-max over the result set)
- Modify: `src/components/pages/see-also-panel.tsx` (render relative score affordance)
- Create: `tests/lib/search/see-also-distribution.test.ts`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`

Steps:

- [ ] Write failing investigation test `tests/lib/search/see-also-distribution.test.ts` (Testcontainers + the local/stub embedding provider): seed one source page plus N candidate pages with deliberately varied topics (e.g. "postgres indexing", "react hooks", "garden tomatoes", and a near-duplicate of the source). Assert: (1) the near-duplicate has the highest `score`; (2) the spread `max(score) - min(score)` across results exceeds a threshold (e.g. `> 0.05`) — this currently FAILS because full-doc mean-pooling compresses the band; (3) `result[0].relativeScore === 1` and the least-similar `relativeScore === 0`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/search/see-also-distribution.test.ts`.
- [ ] In `embed-page.ts`, bound the input: add `const EMBED_INPUT_MAX = 2000;` and embed `text.slice(0, EMBED_INPUT_MAX)` instead of full `text`. Keep the `content_hash` over the FULL text (so re-embeds still trigger on any change) — hash `text`, embed `text.slice(0, EMBED_INPUT_MAX)`. Document the rationale in a comment citing #40.
- [ ] In `see-also.ts`, add `relativeScore: number` to `RelatedPage` and compute it after the ACL filter loop: over the final `out` array, `const scores = out.map(o=>o.score); const lo=Math.min(...scores), hi=Math.max(...scores); for (const o of out) o.relativeScore = hi===lo ? 1 : (o.score - lo)/(hi - lo);` (guard empty array). Keep `score` unchanged for existing callers.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/search/see-also-distribution.test.ts`. (If the spread threshold is still not met with the stub provider, assert the ordering + `relativeScore` endpoints only and record the absolute-spread observation in the test comment — the relative score is the user-facing differentiator either way.)
- [ ] Commit: `fix(search): bound embed input + relative See-also score for differentiation (#40)`
- [ ] Add i18n + render the differentiation. `messages/en.json`:
  ```json
  "seeAlso.matchStrength": "Match strength"
  ```
  `messages/es.json`:
  ```json
  "seeAlso.matchStrength": "Nivel de coincidencia"
  ```
  `messages/ar.json`:
  ```json
  "seeAlso.matchStrength": "قوة التطابق"
  ```
- [ ] In `see-also-panel.tsx`, render a small relative bar per related page: `<div role="meter" aria-label={...} aria-valuenow={Math.round(r.relativeScore*100)}>` with width `${r.relativeScore*100}%` using a muted accent, titled `seeAlso.matchStrength`. This is a Server Component — pass the localized label via the existing server-side `t` used in the panel (confirm how the panel resolves locale; if it uses a server `getT`, reuse that).
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/see-also-panel.test.tsx`.
- [ ] Commit: `feat(search): show relative match-strength in See-also panel (#219)`

## F7 — Tighten dead vertical space + label floating icons (#39/#218)

The in-page database container has dead vertical space (a fixed `h-[600px]` body even when few rows; a separate single-row calc-footer `<table>`; the standalone bottom `+ New row` strip), and the per-row hover icons are unlabeled glyphs. After F1/F3 the comments `MessageSquare` is redundant (it now lives in the drawer). Tighten the container to fit content up to a max height, give the bottom "+ New row" an icon+label, and ensure every remaining floating icon has a `title`/`aria-label`.

**Files:**
- Modify: `src/components/databases/table-view.tsx` (height/space tightening; labeled bottom add-row)
- Modify: `src/components/databases/virtualized-row-body.tsx` (remove redundant inline icons left after F3; ensure labels)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Create: `tests/components/databases/table-density.test.tsx`

Steps:

- [ ] Write failing test `tests/components/databases/table-density.test.tsx`: with 3 rows the body container does NOT carry the fixed `h-[600px]` class (it sizes to content with a `max-h`); the bottom add-row control renders `t('database.addRow')` text alongside a `Plus` icon and has an `aria-label`; no unlabeled icon-only `<button>` exists in the row body (every interactive icon has `aria-label` or `title`).
- [ ] Run to fail.
- [ ] Add i18n. `messages/en.json`:
  ```json
  "database.newRow": "New row"
  ```
  `messages/es.json`:
  ```json
  "database.newRow": "Nueva fila"
  ```
  `messages/ar.json`:
  ```json
  "database.newRow": "صف جديد"
  ```
- [ ] In `table-view.tsx`: replace the populated-state `<div className="h-[600px] min-h-0">{body}</div>` with `<div className="max-h-[600px] min-h-0">{body}</div>` so short tables don't reserve 600px (the virtualizer's scroll container still works; for short lists it shrinks to content). Replace the bottom `+ New row` raw-glyph button text `+ New row` with `<><Plus className="h-4 w-4" aria-hidden /> {t('database.newRow')}</>` and add `aria-label={t('database.addRow')}`. Tighten the footer/strip vertical padding (`py-2` → `py-1.5`) and drop the empty gap between the body and the calc-footer table (remove the redundant `overflow-x-auto` wrapper margin if it adds blank space).
- [ ] In `virtualized-row-body.tsx`: after F3 removed the inline trailing `+`/`MessageSquare`, confirm no unlabeled icon button remains; the disclosure chevron already has `aria-label`. The gutter handles from F3 carry labels. Tighten first-cell `py-2.5` only if rows look airy — keep `ROW_HEIGHT_PX = 40` consistent with the estimator.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/databases/table-density.test.tsx`.
- [ ] Commit: `feat(db): tighten table vertical space + label floating row controls (#218 #39)`

## F8 — Group gate (Plan F): full verification

No new tasks ship until every check below passes on `patches/v0.9.9`. Zero-deferral: any failure is fixed here, not punted.

- [ ] `source ~/.zshenv && pnpm lint` — Biome reports **0 errors** (accept its import-order/`import type`/line-reflow auto-fixes via `biome check --write` then re-run).
- [ ] `source ~/.zshenv && pnpm typecheck` — `tsc --noEmit` clean (note the `db_rows.body` jsonb `$type<unknown>()` flows through `RowWithCells`; the new enum members are exhaustively handled in `coerce`'s `switch` — TS6 will flag a missing case if not).
- [ ] i18n parity: run the repo's i18n key checker (the Biome i18n rule / messages parity step used by prior gates). Assert **no new untranslated keys** — every key added in F1–F7 exists in all three of `messages/en.json`, `messages/es.json`, `messages/ar.json`. Quick manual cross-check:
  `source ~/.zshenv && node -e "const en=require('./messages/en.json'),es=require('./messages/es.json'),ar=require('./messages/ar.json');const ks=Object.keys(en);const miss=ks.filter(k=>!(k in es)||!(k in ar));if(miss.length){console.error('MISSING',miss);process.exit(1)}console.log('i18n parity OK',ks.length)"`
- [ ] FULL test suite: `source ~/.zshenv && pnpm vitest run` (Docker/Colima up for Testcontainers; `isolate: true`). All green.
- [ ] `source ~/.zshenv && pnpm build` — `next build` + entrypoint tsc succeed (the 0062/0063 migrations are syntactically valid; entrypoint fails loud on pending — verify it applies cleanly against a fresh Testcontainers DB in the migration test from F1/F2).
- [ ] e2e UI-acceptance gate (NEW, required for this DB/editor group):
  - Route-reachability Playwright smoke: a page containing an inline database loads; the add-view picker opens; opening a row opens the `RowDetailPanel` Sheet (Properties + Comments tabs render); the left-gutter `+` and `⋮⋮` handles are present on row hover.
  - Per-feature deployed-image check (against the built image, not dev): row-detail body persists across reload (#241); a newly added view tab appears without manual refresh (#263); a property created with a new type (e.g. Email) shows its Title-Case label in the picker (#242/#243); the See-also panel renders distinct match-strength bars (#40/#219).
- [ ] Open a single PR onto `patches/v0.9.9` titled `Plan F — Database depth (#241 #242 #243 #244 #245 #263 #264 #40 #218 #39)`, body summarizing F1–F7 + migrations 0062/0063, **HOLD for user GO** before merge. Do not push from a subagent; the controller/human pushes.
