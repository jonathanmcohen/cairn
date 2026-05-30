# P24 — Database Block: Views + Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the database view tabs actually work and read correctly, and give an empty database a proper, discoverable "add row" affordance with a row count.

**Architecture:** The view tabs in `src/components/databases/view-switcher.tsx` are **create affordances** that POST to `/api/databases/{id}/views` — they always insert a brand-new view (see `createView` in `src/lib/databases/views.ts`, which appends a new `db_views` row at the next `position`; there is no dedupe/switch path). The audit's "no visible result" (#115) is a perception bug from two real defects: (1) after creating a view, `view-switcher` discards the POST response and never activates the new view, so the content pane keeps rendering `meta.views[0]` — nothing changes on screen; (2) for a default database that already has a "Table" view, clicking "+ Table" appends a **second, identically-named, identically-styled "Table" tab** at the far right, which is visually indistinguishable from the existing one. So the fix for #115 is: consume the created view from the response and call `onChange(view.id)` to switch to it (the control IS a create-then-switch). #99 then drops the per-type "+ X" buttons in favor of one **"+ Add view"** control with a type picker (reusing `ui/select`), and renders the existing view tabs as plain name + type-icon buttons (no "+"). #100 builds on the P03/round-1 #19 empty-state header row already in `table-view.tsx`: it adds a row-count line ("0 rows") and a top-level primary **"Add row"** CTA (reusing `ui/button`) above the empty grid, complementing the existing bottom "+ New row".

**Tech Stack:** React 19, `radix-ui` Select (via `@/components/ui/select`), shadcn `Button` (`@/components/ui/button`), Tailwind v4, flat-key i18n via `useT()` from `@/lib/i18n/provider` (`t('flat.key', { count })` — `createT` does ICU-less interpolation + `Intl.PluralRules`, so plural keys are `<key>.one`/`<key>.other`), lucide-react icons.

**Covers:** GH #115 (view tabs are a no-op), #99 ("+" prefix on view tabs is confusing), #100 (empty database has no top-level add-row CTA / no row count).

**Diagnosis of #115 (do not skip — confirm in-file before editing):**
- `view-switcher.tsx` `addSimpleView`/`addDateView` `await fetch(... POST .../views ...)` then call `onViewsChanged()` (which is `refresh` from `use-database-data.ts`). They never read the response body and never call `onChange(...)`.
- `DatabaseBlock` (`database-block.tsx`) computes `activeView = meta.views.find((v) => v.id === viewId) ?? meta.views[0]`, where `viewId` is local state set only by `onChange`. So a newly created view never becomes active.
- Net effect: a tab appears at the right after `refresh`, but the visible pane is unchanged, and a duplicate "Table" tab is indistinguishable from the original ⇒ "clicking does nothing."
- Resolution: these are **create** controls (server always inserts). Fix = switch to the created view after create.

---

### Task 1: Switch to the newly created view (fix #115 no-op)

**Files:**
- Modify: `src/components/databases/view-switcher.tsx`
- Modify (prop wiring): `src/components/databases/database-block.tsx`
- Test: `tests/components/databases/view-switcher.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';
import { ViewSwitcher } from '@/components/databases/view-switcher';

function renderWithI18n(ui: React.ReactNode) {
  return render(<I18nProvider locale="en" messages={enMessages}>{ui}</I18nProvider>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<ViewSwitcher> create-then-switch (#115)', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'view-new', type: 'gallery', name: 'Gallery' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('activates the created view via onChange after a successful POST', async () => {
    const onChange = vi.fn();
    const onViewsChanged = vi.fn();
    renderWithI18n(
      <ViewSwitcher
        databaseId="db1"
        views={[{ id: 'view-1', type: 'table', name: 'Table' }]}
        activeId="view-1"
        dateProperties={[]}
        onChange={onChange}
        onViewsChanged={onViewsChanged}
      />,
    );
    // Open the "Add view" control and pick Gallery (exact UI built in Task 2;
    // for this task the per-type buttons may still exist — target by accessible name).
    fireEvent.click(screen.getByRole('button', { name: /add.*gallery|gallery/i }));
    await waitFor(() => expect(onViewsChanged).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith('view-new');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases/view-switcher.test.tsx`
Expected: FAIL — `onChange` not called with the new view id (currently never called on create).

- [ ] **Step 3: Implement — read the created view from the POST and switch to it**

In `src/components/databases/view-switcher.tsx`, change both create paths to parse the response and activate the new view. `addSimpleView`:

```tsx
  async function addSimpleView(type: 'table' | 'gallery' | 'list') {
    setAdding(true);
    try {
      const res = await fetch(`/api/databases/${databaseId}/views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          name: t(`database.view.type.${type}`),
          config: {},
        }),
      });
      if (!res.ok) return; // leave error UX to a later pass; do not silently "succeed"
      const view = (await res.json()) as { id: string };
      onViewsChanged();
      onChange(view.id);
    } finally {
      setAdding(false);
    }
  }
```

Apply the same pattern to `addDateView` (parse `view.id`, then `onViewsChanged()` + `onChange(view.id)` after the existing `setPendingType(null)`/`setPickedDateProp('')` resets). Use `t('database.view.type.calendar' | '...timeline')` for the `name`.

Note: `onViewsChanged()` (refresh) must run **before** `onChange(view.id)` is observed by `DatabaseBlock` so that `meta.views` already contains the new view when `viewId` flips — both are React state updates batched in the same tick, and `DatabaseBlock`'s `activeView` falls back to `meta.views[0]` for one render if the refresh is still in flight, which is acceptable (the next refresh tick resolves it). Do not block on the refresh promise.

`addSimpleView`/`addDateView`/`startDateView` callers stay the same. The `name` strings now come from i18n (Task 3 adds the keys; until then `t(...)` returns the key string, which is fine for the test that mocks fetch).

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases/view-switcher.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/databases/view-switcher.tsx tests/components/databases/view-switcher.test.tsx
git commit -m "fix(databases): switch to newly created view after add (no-op tabs) — refs #115"
```

---

### Task 2: Consolidate view tabs — drop "+", add one "+ Add view" picker (#99)

**Files:**
- Modify: `src/components/databases/view-switcher.tsx`
- Test: `tests/components/databases/view-switcher.test.tsx` (extend)

**Decision (records #115's finding):** the existing tabs ARE existing views (the `views` array), and the per-type buttons ARE create affordances. So per #99: render the existing-view tabs as **name + type icon, no "+"**, and consolidate the six `+ Table/Gallery/List/Calendar/Timeline` buttons into **one** trailing **"+ Add view"** control that opens a type picker (`ui/select`). Picking a non-date type calls `addSimpleView`; picking `calendar`/`timeline` enters the existing `pendingType` date-property flow.

- [ ] **Step 1: Extend the test**

```tsx
  it('renders existing view tabs by name with a type icon and no "+" prefix', () => {
    renderWithI18n(
      <ViewSwitcher
        databaseId="db1"
        views={[
          { id: 'view-1', type: 'table', name: 'Table' },
          { id: 'view-2', type: 'gallery', name: 'Photos' },
        ]}
        activeId="view-1"
        dateProperties={[]}
        onChange={() => {}}
        onViewsChanged={() => {}}
      />,
    );
    const photos = screen.getByRole('button', { name: /photos/i });
    expect(photos.textContent).not.toContain('+');
    // exactly one "add view" affordance, not six per-type buttons
    expect(screen.getAllByRole('button', { name: /add view/i })).toHaveLength(1);
  });

  it('marks the active tab with aria-current', () => {
    renderWithI18n(
      <ViewSwitcher
        databaseId="db1"
        views={[{ id: 'view-1', type: 'table', name: 'Table' }]}
        activeId="view-1"
        dateProperties={[]}
        onChange={() => {}}
        onViewsChanged={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /table/i })).toHaveAttribute('aria-current', 'true');
  });
```

(Update the Task 1 test's button query to `name: /add view/i` flow if needed once the UI lands — open "Add view", choose Gallery.)

- [ ] **Step 2: Run, confirm fail**

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases/view-switcher.test.tsx`
Expected: FAIL — multiple per-type buttons exist; no "add view" control.

- [ ] **Step 3: Implement**

Add imports at the top of `view-switcher.tsx`:

```tsx
import { Calendar, GalleryThumbnails, List, Plus, Table2, GanttChartSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';
```

Add a type→icon map and a type list near the top of the module (outside the component):

```tsx
const VIEW_TYPE_ICON: Record<string, typeof Table2> = {
  table: Table2,
  gallery: GalleryThumbnails,
  list: List,
  calendar: Calendar,
  timeline: GanttChartSquare,
  kanban: Table2, // kanban has no add-button (needs groupBy); icon only for existing tabs
};
const ADDABLE_TYPES = ['table', 'gallery', 'list', 'calendar', 'timeline'] as const;
const DATE_TYPES = new Set(['calendar', 'timeline']);
```

Inside the component, call `const t = useT();`. Replace the existing-view tab rendering so each tab shows its icon + name and marks the active one:

```tsx
        {views.map((v) => {
          const Icon = VIEW_TYPE_ICON[v.type] ?? Table2;
          const active = v.id === activeId;
          return (
            <button
              key={v.id}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onChange(v.id)}
              className={`flex min-h-11 items-center gap-1.5 rounded px-2 py-1 text-sm ${
                active ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              <Icon className="h-4 w-4 opacity-70" aria-hidden="true" />
              {v.name}
            </button>
          );
        })}
```

Replace the entire `<div className="ml-auto flex items-center gap-1">…six buttons…</div>` block with one "Add view" control. Use `ui/select` as the type picker; on value-change, dispatch to the right path:

```tsx
        <div className="ml-auto flex items-center gap-1">
          <Select
            value=""
            onValueChange={(next) => {
              if (DATE_TYPES.has(next)) {
                startDateView(next as 'calendar' | 'timeline');
              } else {
                void addSimpleView(next as 'table' | 'gallery' | 'list');
              }
            }}
          >
            <SelectTrigger
              aria-label={t('database.view.add')}
              disabled={adding}
              className="h-auto min-h-11 w-auto gap-1.5 border-0 px-2 py-1 text-xs text-muted-foreground shadow-none hover:bg-accent"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <SelectValue placeholder={t('database.view.add')} />
            </SelectTrigger>
            <SelectContent>
              {ADDABLE_TYPES.map((type) => {
                const dateDisabled = DATE_TYPES.has(type) && dateProperties.length === 0;
                return (
                  <SelectItem key={type} value={type} disabled={dateDisabled}>
                    {t(`database.view.type.${type}`)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
```

Keep the `pendingType` date-property picker block below (it already exists). Migrate its inner native `<select>` for the date property to `ui/select` to match (reuse `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`); label via `t('database.view.dateProperty', { type: pendingType })`, and the Add/Cancel buttons to `ui/button` (`<Button size="sm">{t('common.add')}</Button>`, `<Button size="sm" variant="ghost">{t('common.cancel')}</Button>`). Keep the existing `startDateView`/`addDateView` logic.

Accessibility: the SelectTrigger gives a 44px target via `min-h-11`; each existing-view tab also `min-h-11`. The disabled date-type items keep the "add a date property first" intent — add `title` only if `ui/select`'s `SelectItem` forwards it (it spreads `...props`, so `title` works).

- [ ] **Step 4: Run, confirm pass**

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases/view-switcher.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/databases/view-switcher.tsx tests/components/databases/view-switcher.test.tsx
git commit -m "feat(databases): consolidate view tabs into name+icon + one Add-view picker — Closes #99 refs #115"
```

---

### Task 3: Add i18n strings for the view switcher

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/es.json` (if present — match existing locales)

- [ ] **Step 1: Confirm locale files**

Run: `source ~/.zshenv && ls messages/` — `en.json` exists (flat keys). If `es.json`/`ar.json` exist, add the same keys there (Spanish/Arabic translations; if unsure of the translation, copy the English value so the key resolves and flag for a translator — do NOT leave keys missing or `t()` returns the raw key).

- [ ] **Step 2: Add keys to `messages/en.json`**

Insert these flat keys (alphabetical placement is not required; the file is a flat object — append before the closing brace, keeping valid JSON / trailing-comma rules):

```json
  "database.view.add": "Add view",
  "database.view.dateProperty": "{type} date property",
  "database.view.type.table": "Table",
  "database.view.type.gallery": "Gallery",
  "database.view.type.list": "List",
  "database.view.type.calendar": "Calendar",
  "database.view.type.timeline": "Timeline",
  "database.view.type.kanban": "Board",
  "common.add": "Add",
  "common.cancel": "Cancel",
  "database.rowCount.one": "{count} row",
  "database.rowCount.other": "{count} rows",
  "database.addRow": "Add row",
  "database.emptyHint": "No rows yet — add your first row."
```

(If `common.add`/`common.cancel` already exist, reuse them; grep first: `grep -n '"common.add"\|"common.cancel"' messages/en.json`.)

- [ ] **Step 3: Verify the Biome i18n rule + JSON validity**

Run: `source ~/.zshenv && pnpm lint`
Expected: clean. (P31 added a Biome rule guarding literal user-facing strings; the new `t(...)` calls satisfy it.)

- [ ] **Step 4: Commit**

```bash
git add messages/
git commit -m "i18n(databases): add view-switcher + empty-state strings — refs #99 #100"
```

---

### Task 4: Empty-state — row count + top-level "Add row" CTA (#100)

**Files:**
- Modify: `src/components/databases/table-view.tsx`
- Test: `tests/components/databases/table-view-empty.test.tsx` (create)

**Build on P03/round-1 #19:** `table-view.tsx` already renders an empty column-header row when `rows.length === 0` (the `role="grid"` block with the `No rows yet — add one with + New row.` hint). This task adds, **above** that header, a row-count line and a primary "Add row" button, and replaces the literal hint string with the i18n key. The bottom "+ New row" button stays (it's the in-grid affordance).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';
import { TableView } from '@/components/databases/table-view';

// offline-context: action allowed by default
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));

const meta = {
  database: { id: 'db1', name: 'DB', config: {} },
  properties: [{ id: 'p1', name: 'Name', type: 'text', config: {}, position: 0 }],
  views: [{ id: 'v1', type: 'table', name: 'Table', config: {}, position: 0 }],
};

function renderTable(rows: unknown[]) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      <TableView
        databaseId="db1"
        meta={meta as never}
        rows={rows as never}
        view={{ id: 'v1', type: 'table', name: 'Table', config: {} }}
        onChange={() => {}}
      />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('<TableView> empty state (#100)', () => {
  it('shows a "0 rows" count and a top-level Add row button when empty', () => {
    renderTable([]);
    expect(screen.getByText('0 rows')).toBeTruthy();
    // primary CTA in the empty state (distinct from the bottom "+ New row")
    expect(screen.getByRole('button', { name: 'Add row' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases/table-view-empty.test.tsx`
Expected: FAIL — no "0 rows" text / no "Add row" button.

- [ ] **Step 3: Implement**

Add imports to `table-view.tsx`:

```tsx
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';
```

Inside `TableView`, add `const t = useT();` near the other hooks (top of the component body, after `useState`s).

In the non-grouped empty branch (the `rows.length === 0 ?` block, currently starting `// a10 #19 — render the column header row…`), wrap the existing `<div className="overflow-x-auto">…</div>` so a count + CTA sit above it:

```tsx
            <div>
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  {t('database.rowCount', { count: rows.length })}
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void addRow()}
                  disabled={adding || !rowMutateAllowed}
                  title={rowMutateAllowed ? undefined : 'Unavailable offline'}
                  className="min-h-11"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t('database.addRow')}
                </Button>
              </div>
              <div className="overflow-x-auto">
                {/* …existing role="grid" empty header + hint, unchanged… */}
              </div>
            </div>
```

Replace the literal empty-hint string in that block:

```tsx
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t('database.emptyHint')}
              </div>
```

Notes:
- `rows.length` is `0` here, so `t('database.rowCount', { count: 0 })` resolves via `Intl.PluralRules` (en: `other` ⇒ "0 rows"). The count line is intentionally rendered in the empty branch only; a populated-state count is out of scope for this patch (the grouped path already shows per-group counts).
- Reuse the existing `addRow()` handler — do not add a second create path. The CTA and the bottom "+ New row" both call `addRow()`.
- Keep the `min-h-11` for the 44px target; `Button size="sm"` is `h-8` by default, so the `min-h-11` override is required for WCAG AA touch sizing.
- Leave the populated branch (`<div className="h-[600px] …">{body}</div>`) and the bottom "+ New row" / templates `<select>` untouched (templates select migration is out of scope — tracked under #38).

- [ ] **Step 4: Run, confirm pass**

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases/table-view-empty.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/databases/table-view.tsx tests/components/databases/table-view-empty.test.tsx
git commit -m "feat(databases): empty-state row count + primary Add-row CTA — Closes #100"
```

---

### Task 5: Verify the whole patch + close issues

- [ ] **Step 1: Full verification**

Run: `source ~/.zshenv && pnpm vitest run tests/components/databases ; pnpm lint && pnpm typecheck && pnpm build`
Expected: database component tests pass; lint/types/build clean. If `pnpm build` flags an unused import or a `Route` typing on any href, fix in place.

- [ ] **Step 2: Manual smoke (optional, if a dev server is run by the human)**

- Open a page with a database block. Click **Add view → Gallery**: a new "Gallery" tab appears AND the pane switches to the gallery view (validates #115).
- Existing tabs show **icon + name, no "+"**; the active tab is highlighted (validates #99).
- Open a database with zero rows: a **"0 rows"** count and a primary **Add row** button show above the empty header row; clicking either adds a row (validates #100).

- [ ] **Step 3: Issue trailers**

The commits close #99 and #100 via trailers. #115 is fixed across Task 1 + Task 2 — close it in the PR body (`Closes #115`) or:

```bash
gh issue comment 115 --body "Root cause: the view tabs were create affordances (server always inserts a new db_views row) but \`view-switcher\` discarded the POST response and never called \`onChange(view.id)\`, so the active pane (\`meta.views[0]\` fallback in database-block.tsx) never changed — and a fresh DB's \"+ Table\" produced a duplicate, identically-styled tab, reading as a no-op. Fixed by activating the created view after POST, and consolidating the six \"+ Type\" buttons into one \"+ Add view\" picker (#99)."
```

---

## Self-Review

- #115 diagnosed (create-not-switch; no-op = discarded response + no `onChange` + duplicate-tab invisibility) and fixed (Task 1 activates created view). ✓
- #99 decided + implemented: tabs are existing views → render name + type icon, no "+"; one consolidated "+ Add view" picker (`ui/select`). ✓
- #100: row count ("0 rows", plural-safe) + top-level primary "Add row" CTA (`ui/button`), building on the P03/#19 empty header row; bottom "+ New row" retained. ✓
- New user-facing strings are i18n keys (Task 3); `t({ count })` uses `Intl.PluralRules`. ✓
- WCAG AA: all new interactive controls are `min-h-11` (44px); icons `aria-hidden`; active tab `aria-current`; SelectTrigger has `aria-label`. ✓
- Reused `ui/select` + `ui/button` (no new primitives). ✓
- Out of scope (logged, not done here): the bottom templates native `<select>` migration (#38), populated-state row count.
