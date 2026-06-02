# Cairn v0.9.9 — Plan Q: Audit Log Polish

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal**: The admin audit-log viewer (`/settings/admin/audit`) currently renders raw, truncated UUIDs for both the actor (`actorUserId.slice(0, 8)`) and the target (`targetType:targetId.slice(0, 8)`), and always shows a "Show/Hide" metadata toggle even when `metadata` is the empty object `{}`. This plan resolves the actor user_id to a human display name (#91/#265), resolves the target entity reference to a titled, clickable link where the entity type supports one (#92/#265), and hides the metadata expand button (or renders a "No additional metadata" hint) when `metadata` is empty (#93/#269). All work is confined to the audit query layer (`src/lib/audit/query.ts` + a new resolver), the admin API route (`src/app/api/admin/audit/route.ts`), and the client component (`src/components/admin/audit-viewer.tsx`). New user-facing strings land in `messages/{en,es,ar}.json` and are consumed via `useT()`.

**Architecture**:
- The audit store (`src/db/schema/audit-log.ts`) keeps actor/target as opaque ids: `actorUserId uuid → users.id (on delete set null)`, `targetType text`, `targetId uuid`. No FK exists for `targetId` because it is polymorphic (page / database / workspace / member / …). We therefore resolve names in an **enrichment pass** in the query layer rather than via a single SQL join.
- `listAuditLog` returns raw `auditLog` rows today. We add a separate `enrichAuditEntries(db, rows)` helper that batch-resolves: (a) all distinct `actorUserId`s → `users.name` via one `inArray` query against `users`; (b) all distinct `(targetType='page', targetId)` → `pages.title` and `(targetType='database', targetId)` → `databases.name` via two batched `inArray` queries. Resolution is best-effort: if an id no longer resolves (deleted/cross-table), we fall back to the existing short-id display. This keeps the query at O(1 + 1 + 1) extra round-trips regardless of page size — no N+1.
- The API route reshapes each entry into an `actorName: string | null` + `targetTitle: string | null` + `targetHref: string | null` envelope alongside the raw fields, so the client renders names/links without itself touching the DB. Only `page` targets get an in-app `targetHref` (`/pages/<id>`); `database` targets render a resolved title without a link (DB blocks live inside a page, no standalone route); all other target types render the existing `type:shortid` text.
- The client component switches its hardcoded English strings to `useT()` keys and gates the metadata `<button>` on `Object.keys(entry.metadata).length > 0`, rendering a muted "No additional metadata" span otherwise.

**Tech Stack**: Next.js 16 App Router (React 19, TS6), Drizzle + Postgres (`PostgresJsDatabase<typeof schema>`, batched `inArray`), Vitest 4 + Testcontainers (real Postgres for query/route tests, jsdom for the component test), Biome v2 (0 errors), i18n en/es/ar via `useT()` (`src/lib/i18n/provider.tsx`). No new dependency. No migration (read-only enrichment over existing columns).

---

## Q1 — Resolve actor user_id → display name (#91/#265)

The viewer shows `entry.actorUserId.slice(0, 8)` (`audit-viewer.tsx:345`). Resolve to `users.name`, falling back to the short id when the user is `null` (system action) or no longer exists (`onDelete: 'set null'` already nulls the column, but a stale id can persist if a row pre-dates the FK). Batched in the query layer, surfaced through the API as `actorName`.

**Files:**
- Create: `src/lib/audit/enrich.ts` — `enrichAuditEntries(db, rows)` resolver + `EnrichedAuditEntry` type.
- Create: `tests/lib/audit/enrich.test.ts` — Testcontainers test for actor-name resolution.
- Modify: `src/app/api/admin/audit/route.ts` — call enricher, return enriched entries.
- Modify: `tests/api/admin-audit.test.ts` — assert `actorName` in the response payload.
- Modify: `src/components/admin/audit-viewer.tsx` — consume `actorName`, fall back to short id.

**Steps:**

- [ ] Write a failing Testcontainers test `tests/lib/audit/enrich.test.ts` that seeds a workspace, a user `{ name: 'Ada Lovelace' }`, and an `auditLog` row with `actorUserId = ada.id`, then asserts `enrichAuditEntries(db, rows)[0].actorName === 'Ada Lovelace'`, and a second row with `actorUserId: null` resolves to `actorName: null`:
  ```ts
  // @vitest-environment node
  import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
  import { auditLog } from '@/db/schema/audit-log';
  import { users } from '@/db/schema/users';
  import { workspaces } from '@/db/schema/workspaces';
  import { enrichAuditEntries } from '@/lib/audit/enrich';
  import { getTestDb, resetDb, startPostgres, stopPostgres } from '../../helpers/db';

  describe('enrichAuditEntries — actor resolution (#91)', () => {
    beforeAll(startPostgres);
    afterAll(stopPostgres);
    beforeEach(resetDb);

    it('resolves actorUserId to users.name and null actor to null', async () => {
      const db = getTestDb();
      const [ws] = await db.insert(workspaces).values({ name: 'WS', slug: 'ws' }).returning();
      const [ada] = await db
        .insert(users)
        .values({ email: 'ada@x.test', name: 'Ada Lovelace', passwordHash: 'x' })
        .returning();
      const rows = await db
        .insert(auditLog)
        .values([
          { workspaceId: ws.id, actorUserId: ada.id, action: 'page.published' },
          { workspaceId: ws.id, actorUserId: null, action: 'trash.purged_auto' },
        ])
        .returning();
      const enriched = await enrichAuditEntries(db, rows);
      const byId = new Map(enriched.map((e) => [e.id, e]));
      expect(byId.get(rows[0].id)?.actorName).toBe('Ada Lovelace');
      expect(byId.get(rows[1].id)?.actorName).toBeNull();
    });
  });
  ```
  (Match the seed/reset helper signatures to the existing `tests/helpers/db.ts` exports — read that file and adapt `getTestDb`/`resetDb`/`startPostgres`/`stopPostgres` names + the `workspaces` insert columns to the real schema before running.)
- [ ] Run it to fail (module `@/lib/audit/enrich` does not exist): `source ~/.zshenv && pnpm vitest run tests/lib/audit/enrich.test.ts`
- [ ] Create `src/lib/audit/enrich.ts` with the actor-resolution slice (target resolution lands in Q2):
  ```ts
  import { inArray } from 'drizzle-orm';
  import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
  import * as schema from '@/db/schema';

  type Db = PostgresJsDatabase<typeof schema>;
  type AuditRow = typeof schema.auditLog.$inferSelect;

  export type EnrichedAuditEntry = AuditRow & {
    /** Resolved actor display name, or null for system / deleted-user actions. */
    actorName: string | null;
    /** Resolved human title for the target entity, or null when unresolved. */
    targetTitle: string | null;
    /** In-app href for the target when one exists (pages only), else null. */
    targetHref: string | null;
  };

  export async function enrichAuditEntries(
    db: Db,
    rows: AuditRow[],
  ): Promise<EnrichedAuditEntry[]> {
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v))];
    const actorNames = new Map<string, string>();
    if (actorIds.length > 0) {
      const found = await db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(inArray(schema.users.id, actorIds));
      for (const u of found) actorNames.set(u.id, u.name);
    }
    return rows.map((r) => ({
      ...r,
      actorName: r.actorUserId ? (actorNames.get(r.actorUserId) ?? null) : null,
      targetTitle: null,
      targetHref: null,
    }));
  }
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/audit/enrich.test.ts`
- [ ] Wire the enricher into the API route. Modify `src/app/api/admin/audit/route.ts` to call `enrichAuditEntries` on `result.entries` and return the enriched shape:
  ```ts
  import { enrichAuditEntries } from '@/lib/audit/enrich';
  // …inside GET, after listAuditLog(…):
  const enriched = await enrichAuditEntries(getDb(), result.entries);
  return NextResponse.json({ entries: enriched, nextCursor: result.nextCursor });
  ```
- [ ] Add a failing assertion to `tests/api/admin-audit.test.ts`: seed an actor user, hit `GET /api/admin/audit`, assert `body.entries[0].actorName` equals the seeded name. Run to fail, then it passes once the route change above is in. `source ~/.zshenv && pnpm vitest run tests/api/admin-audit.test.ts`
- [ ] Modify `src/components/admin/audit-viewer.tsx`: extend `AuditEntry` with `actorName: string | null; targetTitle: string | null; targetHref: string | null;`, and change the actor cell (currently line 345/352) to prefer the name:
  ```tsx
  const actor = entry.actorName ?? (entry.actorUserId ? entry.actorUserId.slice(0, 8) : '—');
  // …
  <td className="py-2 pr-3" title={entry.actorUserId ?? undefined}>{actor}</td>
  ```
  (Drop the `font-mono text-xs text-muted-foreground` classes from the actor `<td>` so resolved names read as normal text; keep the raw id in the `title` for forensics. Q2 styles the target cell.)
- [ ] Add/extend the component test `tests/components/admin/audit-viewer-themed.test.tsx` (or a sibling `audit-viewer-resolve.test.tsx`) to mock `fetch` returning one entry with `actorName: 'Ada Lovelace'` and assert `screen.getByText('Ada Lovelace')` is present. Run to fail then pass: `source ~/.zshenv && pnpm vitest run tests/components/admin/audit-viewer-resolve.test.tsx`
- [ ] Commit: `feat(audit): resolve actor user_id to display name in audit viewer (#91, #265)`

---

## Q2 — Resolve target entity ref → titled link (#92/#265)

The viewer shows `${targetType}:${targetId.slice(0,8)}` (`audit-viewer.tsx:346-348`). Resolve `page` targets to `pages.title` + an in-app link `/pages/<id>`, and `database` targets to `databases.name` (text only — DB blocks have no standalone route). All other target types keep the existing `type:shortid` text (no link). Resolution is best-effort and batched.

**Files:**
- Modify: `src/lib/audit/enrich.ts` — add page + database title batch resolution and `targetHref` for pages.
- Modify: `tests/lib/audit/enrich.test.ts` — add target-resolution cases.
- Modify: `src/components/admin/audit-viewer.tsx` — render resolved title as `<Link>` for pages, plain text for databases, fallback otherwise.

**Steps:**

- [ ] Add a failing case to `tests/lib/audit/enrich.test.ts`: seed a page `{ title: 'Q3 Roadmap' }` and a database `{ name: 'Bug Tracker' }`, insert audit rows `{ targetType: 'page', targetId: page.id }`, `{ targetType: 'database', targetId: db.id }`, `{ targetType: 'workspace', targetId: ws.id }`, and assert:
  ```ts
  expect(byId.get(pageRow.id)?.targetTitle).toBe('Q3 Roadmap');
  expect(byId.get(pageRow.id)?.targetHref).toBe(`/pages/${page.id}`);
  expect(byId.get(dbRow.id)?.targetTitle).toBe('Bug Tracker');
  expect(byId.get(dbRow.id)?.targetHref).toBeNull();   // databases: title only
  expect(byId.get(wsRow.id)?.targetTitle).toBeNull();  // unresolved type → fallback in UI
  ```
  (Adapt the `pages` / `databases` insert columns to the real schema: `pages.title` defaults to `'Untitled'`, `databases.name` defaults to `'Untitled database'` — set them explicitly. A `page` needs a valid `workspaceId`.) Run to fail: `source ~/.zshenv && pnpm vitest run tests/lib/audit/enrich.test.ts`
- [ ] Extend `enrichAuditEntries` in `src/lib/audit/enrich.ts` to batch-resolve page + database titles. Insert before the `return`:
  ```ts
  const pageIds = [
    ...new Set(
      rows
        .filter((r) => r.targetType === 'page' && r.targetId)
        .map((r) => r.targetId as string),
    ),
  ];
  const dbIds = [
    ...new Set(
      rows
        .filter((r) => r.targetType === 'database' && r.targetId)
        .map((r) => r.targetId as string),
    ),
  ];
  const pageTitles = new Map<string, string>();
  if (pageIds.length > 0) {
    const found = await db
      .select({ id: schema.pages.id, title: schema.pages.title })
      .from(schema.pages)
      .where(inArray(schema.pages.id, pageIds));
    for (const p of found) pageTitles.set(p.id, p.title);
  }
  const dbNames = new Map<string, string>();
  if (dbIds.length > 0) {
    const found = await db
      .select({ id: schema.databases.id, name: schema.databases.name })
      .from(schema.databases)
      .where(inArray(schema.databases.id, dbIds));
    for (const d of found) dbNames.set(d.id, d.name);
  }
  function resolveTarget(r: AuditRow): { title: string | null; href: string | null } {
    if (!r.targetId) return { title: null, href: null };
    if (r.targetType === 'page') {
      const title = pageTitles.get(r.targetId) ?? null;
      return { title, href: title ? `/pages/${r.targetId}` : null };
    }
    if (r.targetType === 'database') {
      return { title: dbNames.get(r.targetId) ?? null, href: null };
    }
    return { title: null, href: null };
  }
  ```
  Then change the `return` map to call it:
  ```ts
  return rows.map((r) => {
    const { title, href } = resolveTarget(r);
    return {
      ...r,
      actorName: r.actorUserId ? (actorNames.get(r.actorUserId) ?? null) : null,
      targetTitle: title,
      targetHref: href,
    };
  });
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/lib/audit/enrich.test.ts`
- [ ] Modify `src/components/admin/audit-viewer.tsx`. Import `Link` and `Route`:
  ```tsx
  import Link from 'next/link';
  import type { Route } from 'next';
  ```
  Replace the target cell (`audit-viewer.tsx:346-348` builds `target`, line 353 renders it). New render:
  ```tsx
  const shortTarget = entry.targetType
    ? `${entry.targetType}${entry.targetId ? `:${entry.targetId.slice(0, 8)}` : ''}`
    : '—';
  // …in the row:
  <td className="py-2 pr-3 text-sm">
    {entry.targetHref && entry.targetTitle ? (
      <Link
        href={entry.targetHref as Route}
        className="text-primary underline hover:no-underline"
      >
        {entry.targetTitle}
      </Link>
    ) : entry.targetTitle ? (
      <span title={entry.targetId ?? undefined}>{entry.targetTitle}</span>
    ) : (
      <span className="text-muted-foreground font-mono text-xs">{shortTarget}</span>
    )}
  </td>
  ```
- [ ] Extend the component test to render an entry with `targetType: 'page', targetTitle: 'Q3 Roadmap', targetHref: '/pages/abc'` and assert a link with name `/Q3 Roadmap/i` whose `href` is `/pages/abc`; and a second entry with `targetType: 'workspace', targetTitle: null` asserts the `workspace:<short>` fallback text renders. Run to fail then pass: `source ~/.zshenv && pnpm vitest run tests/components/admin/audit-viewer-resolve.test.tsx`
- [ ] Commit: `feat(audit): resolve target entity to titled link in audit viewer (#92, #265)`

---

## Q3 — Hide expand button on empty metadata / show "No additional metadata" (#93/#269)

The viewer always renders a `Show`/`Hide` `<button>` + `<pre>` for metadata (`audit-viewer.tsx:357-371`), even when `entry.metadata` is `{}` (the column default). When metadata is empty, hide the toggle and render a muted "No additional metadata" hint instead. While here, switch the component's hardcoded English strings (`'Show'`, `'Hide'`, `'No audit entries match these filters.'`, `'Load more'`, `'Loading…'`, the four filter labels/placeholders, the five column headers) to `useT()` keys so this component finally complies with the i18n gate.

**Files:**
- Modify: `src/components/admin/audit-viewer.tsx` — empty-metadata gate + `useT()` adoption.
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json` — new `auditLog.*` keys.
- Modify: `tests/components/admin/audit-viewer-resolve.test.tsx` — assert empty-metadata behavior (wrap render in `I18nProvider`).

**Steps:**

- [ ] Add the i18n keys. Append to `messages/en.json`:
  ```json
  "auditLog.column.action": "Action",
  "auditLog.column.actor": "Actor",
  "auditLog.column.target": "Target",
  "auditLog.column.when": "When",
  "auditLog.column.metadata": "Metadata",
  "auditLog.filter.actionLabel": "Action",
  "auditLog.filter.actionPlaceholder": "All actions",
  "auditLog.filter.allActions": "All actions",
  "auditLog.filter.targetLabel": "Target type",
  "auditLog.filter.targetPlaceholder": "All targets",
  "auditLog.filter.allTargets": "All targets",
  "auditLog.filter.from": "From",
  "auditLog.filter.to": "To",
  "auditLog.empty": "No audit entries match these filters.",
  "auditLog.metadata.show": "Show",
  "auditLog.metadata.hide": "Hide",
  "auditLog.metadata.none": "No additional metadata",
  "auditLog.loadMore": "Load more",
  "auditLog.loading": "Loading…",
  "auditLog.error.load": "Failed to load audit log ({status})",
  "auditLog.error.loadMore": "Failed to load more ({status})"
  ```
  Append the Spanish equivalents to `messages/es.json`:
  ```json
  "auditLog.column.action": "Acción",
  "auditLog.column.actor": "Autor",
  "auditLog.column.target": "Objetivo",
  "auditLog.column.when": "Cuándo",
  "auditLog.column.metadata": "Metadatos",
  "auditLog.filter.actionLabel": "Acción",
  "auditLog.filter.actionPlaceholder": "Todas las acciones",
  "auditLog.filter.allActions": "Todas las acciones",
  "auditLog.filter.targetLabel": "Tipo de objetivo",
  "auditLog.filter.targetPlaceholder": "Todos los objetivos",
  "auditLog.filter.allTargets": "Todos los objetivos",
  "auditLog.filter.from": "Desde",
  "auditLog.filter.to": "Hasta",
  "auditLog.empty": "Ninguna entrada de auditoría coincide con estos filtros.",
  "auditLog.metadata.show": "Mostrar",
  "auditLog.metadata.hide": "Ocultar",
  "auditLog.metadata.none": "Sin metadatos adicionales",
  "auditLog.loadMore": "Cargar más",
  "auditLog.loading": "Cargando…",
  "auditLog.error.load": "No se pudo cargar el registro de auditoría ({status})",
  "auditLog.error.loadMore": "No se pudieron cargar más entradas ({status})"
  ```
  Append the Arabic equivalents to `messages/ar.json`:
  ```json
  "auditLog.column.action": "الإجراء",
  "auditLog.column.actor": "المنفِّذ",
  "auditLog.column.target": "الهدف",
  "auditLog.column.when": "الوقت",
  "auditLog.column.metadata": "البيانات الوصفية",
  "auditLog.filter.actionLabel": "الإجراء",
  "auditLog.filter.actionPlaceholder": "كل الإجراءات",
  "auditLog.filter.allActions": "كل الإجراءات",
  "auditLog.filter.targetLabel": "نوع الهدف",
  "auditLog.filter.targetPlaceholder": "كل الأهداف",
  "auditLog.filter.allTargets": "كل الأهداف",
  "auditLog.filter.from": "من",
  "auditLog.filter.to": "إلى",
  "auditLog.empty": "لا توجد إدخالات تدقيق تطابق هذه المرشحات.",
  "auditLog.metadata.show": "عرض",
  "auditLog.metadata.hide": "إخفاء",
  "auditLog.metadata.none": "لا توجد بيانات وصفية إضافية",
  "auditLog.loadMore": "تحميل المزيد",
  "auditLog.loading": "جارٍ التحميل…",
  "auditLog.error.load": "تعذّر تحميل سجل التدقيق ({status})",
  "auditLog.error.loadMore": "تعذّر تحميل المزيد من الإدخالات ({status})"
  ```
- [ ] Write the failing component assertion in `tests/components/admin/audit-viewer-resolve.test.tsx`: render `<AuditViewer />` wrapped in `<I18nProvider locale="en" messages={enMessages}>` with mocked `fetch` returning two entries — one `metadata: {}`, one `metadata: { foo: 'bar' }`. Assert: the empty one renders `screen.getByText('No additional metadata')` and has **no** "Show" button in that row; the non-empty one renders a "Show" button. (Import `enMessages from '../../../messages/en.json' with { type: 'json' }`.) Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/admin/audit-viewer-resolve.test.tsx`
- [ ] Modify `src/components/admin/audit-viewer.tsx`:
  - Add `import { useT } from '@/lib/i18n/provider';` and `const t = useT();` as the first hook in `AuditViewer()`.
  - Replace the two `setError(\`Failed to load…\`)` calls with `setError(t('auditLog.error.load', { status: res.status }))` and `t('auditLog.error.loadMore', { status: res.status })`.
  - Replace filter labels/placeholders/items: `Action` → `t('auditLog.filter.actionLabel')`, `All actions` placeholder + `__all` item → `t('auditLog.filter.actionPlaceholder')` / `t('auditLog.filter.allActions')`; same for target (`auditLog.filter.targetLabel` / `targetPlaceholder` / `allTargets`). Pass `label={t('auditLog.filter.from')}` / `t('auditLog.filter.to')` to the two `<DateField>`s.
  - Replace the five `<th>` texts with `t('auditLog.column.action')` … `t('auditLog.column.metadata')`.
  - Replace the empty-state cell text with `t('auditLog.empty')`.
  - Replace the metadata cell body (lines 357-371) with the empty-aware gate:
    ```tsx
    <td className="py-2">
      {Object.keys(entry.metadata).length === 0 ? (
        <span className="text-muted-foreground text-xs">{t('auditLog.metadata.none')}</span>
      ) : (
        <>
          <button
            type="button"
            className="text-xs underline hover:no-underline"
            aria-expanded={isOpen}
            onClick={() => setExpanded((m) => ({ ...m, [entry.id]: !m[entry.id] }))}
          >
            {isOpen ? t('auditLog.metadata.hide') : t('auditLog.metadata.show')}
          </button>
          {isOpen ? (
            <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          ) : null}
        </>
      )}
    </td>
    ```
  - Replace the `Load more` / `Loading…` button label with `loading ? t('auditLog.loading') : t('auditLog.loadMore')`.
- [ ] Update the existing `tests/components/admin/audit-viewer-themed.test.tsx` to wrap its `render(<AuditViewer />)` in `<I18nProvider locale="en" messages={enMessages}>` (the component now requires the provider) and keep the `aria-label` lookup as `/filter by action/i` — note the `aria-label` strings on the `<SelectTrigger>` (`"Filter by action"` / `"Filter by target type"`) stay literal English for the a11y test stability, OR move them to `auditLog.filter.actionLabel` and update the test regex. Pick the move-to-i18n path and update the test query to `t('auditLog.filter.actionLabel')`’s English value (`/^Action$/i` via `name`). Run to fail then pass: `source ~/.zshenv && pnpm vitest run tests/components/admin/audit-viewer-themed.test.tsx tests/components/admin/audit-viewer-resolve.test.tsx`
- [ ] Run the i18n audit to confirm the new keys exist in all three locales and no key is orphaned: `source ~/.zshenv && pnpm tsx scripts/i18n-audit.ts` (must report 0 new untranslated keys vs baseline). If the script name/flag differs, match `package.json`’s i18n script.
- [ ] Commit: `feat(audit): hide metadata toggle on empty metadata + i18n the audit viewer (#93, #269)`

---

## Q-GATE — Plan Q verification gate (HOLD for GO)

No migration in this plan (read-only enrichment over existing `audit_log` / `users` / `pages` / `databases` columns; latest applied migration remains 0061, v0.9.9’s first new migration 0062 belongs to other plans). All Plan Q work merges into the single `patches/v0.9.9` branch via one PR.

**Steps:**

- [ ] Lint with 0 errors (Biome v2, GitHub-hosted runner constraint — no self-hosted): `source ~/.zshenv && pnpm lint`
- [ ] Typecheck clean: `source ~/.zshenv && pnpm typecheck`
- [ ] i18n audit shows **no new untranslated keys** (the `auditLog.*` keys present in en/es/ar): `source ~/.zshenv && pnpm tsx scripts/i18n-audit.ts`
- [ ] FULL test suite green (zero-deferral — run the whole suite, not just touched files; needs Docker/Colima for Testcontainers): `source ~/.zshenv && pnpm vitest run`
- [ ] Production build succeeds: `source ~/.zshenv && pnpm build`
- [ ] **e2e UI-acceptance gate** (new v0.9.9 gate, GitHub-hosted runner):
  - Route-reachability: `/settings/admin/audit` returns 200 for an admin session and renders the audit table (Playwright smoke against the deployed `ghcr.io/jonathanmcohen/cairn` image).
  - Per-feature deployed-image checklist on a workspace seeded with at least one audit row whose actor is a named user and whose target is a `page`:
    - Q1: the Actor column renders the user’s display name (not an 8-char hex id).
    - Q2: the Target column renders the page title as a link whose `href` is `/pages/<id>` and navigation lands on that page; a `database` target renders its name as plain text; a `workspace` target still renders the `workspace:<short>` fallback.
    - Q3: an audit row with empty `{}` metadata shows "No additional metadata" and **no** Show button; a row with non-empty metadata shows a working Show/Hide toggle.
- [ ] Open a single PR onto `patches/v0.9.9` titled `feat(audit): audit-log polish — resolve actor + target, empty-metadata gate (#91, #92, #93, #265, #269)`, link all five issues, paste the gate output. **HOLD — do not merge; await user GO.**
