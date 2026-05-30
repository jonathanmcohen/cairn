# P31 — Working "Add cover" + Discoverable Slash Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (1) Make the in-flow "+ Add cover" affordance actually open a working picker and apply a cover (GH #121). (2) Make the full slash-command catalog discoverable instead of hiding ~30 of ~38 blocks behind typeahead, by grouping items into categories with a raised/removed slice cap, while keeping typeahead and keyboard navigation working across all groups (GH #122).

**Architecture:**

- **#121 — diagnosis (the button is wired, but to the wrong contract).** Round-1 #16 (commit `1b80c1f`) removed the *floating* `CoverPicker` mount from `src/app/(app)/pages/[pageId]/page.tsx` and kept the in-flow `CoverImage` button as "the single canonical affordance." The problem: `CoverImage` (`src/components/cover-image.tsx`) is a **legacy** control that predates the v0.8.0 G7 P20 cover model. Its `upload()`/`remove()` handlers `PATCH /api/pages/${pageId}` with `{ coverUrl }` (the legacy `pages.cover_url` text column) and seed its state from `page.coverUrl`. But the renderer on the page is `CoverBanner`, which reads the **new** `pages.cover` jsonb descriptor (`{ kind: 'color' | 'unsplash' | 'upload', value }`) via `getPageCover()`. The schema comment is explicit: *"`{}` means 'no banner'; renderer prefers this over legacy `coverUrl`"* (`src/db/schema/pages.ts:43`). So `CoverImage`'s `onClick={upload}` **does fire** and the file-input dialog opens, but the resulting write lands in `cover_url`, which `CoverBanner` ignores — the banner never appears, so the button looks dead. (The removed `CoverPicker` was the *only* control wired to the live `/api/pages/[pageId]/cover` route + `cover` jsonb.) **Fix:** retire the legacy `CoverImage` control and re-mount the real `CoverPicker` as the single in-flow affordance where `CoverImage` sat, gated on `canEdit`, passing `unsplashKey` (re-add the `NEXT_PUBLIC_CAIRN_UNSPLASH_ACCESS_KEY` read that #16 deleted). `CoverPicker` already PATCHes `/api/pages/[pageId]/cover`, uploads via `/api/files`, and calls `router.refresh()` so the server-rendered `CoverBanner` re-fetches the new `cover` — verified end-to-end. We do **not** touch `CoverImage`'s only other consumer if any exists (it has none — see Task 1 grep), so the file is deleted.

- **#122 — slash catalog discoverability.** The `items` array in `src/components/editor/slash-extension.ts` holds ~38 entries, but the suggestion `items()` callback returns `…filter(...).slice(0, 10)` — so opening `/` shows only the first ~8–10 (Heading 1/2/3, lists, Quote, Code, Divider, Callout…) and everything after (Table, Image, File, Embed, Video, Audio, Equation, diagrams, PDF, Database, Page embed…) is reachable *only* if the user already knows the title to type. **Fix:** assign each item a `category` (`Basic` / `Media` / `Database` / `Advanced`), raise the slice cap so the full catalog is returned, and render the `SlashMenu` as grouped, scrollable sections with non-interactive group headers. Keyboard nav (Arrow/Enter, forwarded from TipTap's keymap) must traverse the *flat* selectable order across groups, and typeahead filtering must apply across all items (hiding empty groups). This is a pure client/editor change — no schema, no API, no Yjs document mutation.

**Yjs-safety:** Neither change touches the collaborative document. The cover lives in `pages.cover` (server row, PATCH route), not in the Yjs doc. The slash menu only *inserts* nodes via existing `editor.chain()…` commands that already round-trip through the Yjs binding unchanged — we are reordering/grouping the *menu*, not the insertion commands. No new node types, no schema edits.

**Accessibility:** `CoverPicker`'s trigger and dialog already exist; we add a 44px min touch target to its trigger `Button` and confirm the dialog's tab roles. The grouped slash menu keeps its `role="listbox"` + `aria-activedescendant` model; group headers get `role="presentation"` (decorative) so they are skipped by the activedescendant index. All user-visible strings added go through the `messages/*.json` i18n catalog (en + es + ar).

**Tech Stack:** React 19, TipTap 3, `@tiptap/suggestion`, Tailwind v4, `cn()` from `src/lib/utils.ts`, next-intl-style flat-key catalogs in `messages/{en,es,ar}.json`.

**Covers:** GH #121 (dead "Add cover" button), #122 (slash catalog discoverability).

---

### Task 1: Diagnose + confirm the dead-cover contract mismatch (no code change)

**Files:** read-only — `src/components/cover-image.tsx`, `src/components/pages/cover-picker.tsx`, `src/components/pages/cover-banner.tsx`, `src/app/(app)/pages/[pageId]/page.tsx`, `src/lib/pages/cover.ts`, `src/app/api/pages/[pageId]/cover/route.ts`, `src/db/schema/pages.ts`.

- [ ] **Step 1: Confirm `CoverImage` has exactly one mount and writes the legacy field**

Run:

```bash
source ~/.zshenv && grep -rn "CoverImage" src ; echo "--- cover_url writers ---" ; grep -rn "coverUrl" src
```

Expected findings (the implementer must confirm these before proceeding):
- `CoverImage` is imported and mounted **only** in `src/app/(app)/pages/[pageId]/page.tsx` (line ~70). Deleting the component is safe.
- `CoverImage.upload()` PATCHes `/api/pages/${pageId}` with `{ coverUrl: signedUrl }`; the page renders the banner from `cover` (jsonb) via `CoverBanner`, **not** `coverUrl`. This is the root cause: the click works, the write succeeds against the wrong column, and the banner never updates.

- [ ] **Step 2: Confirm `CoverPicker` is the live, correct control and is currently unmounted**

Run:

```bash
source ~/.zshenv && grep -rn "CoverPicker" src
```

Expected: `CoverPicker` is defined (`src/components/pages/cover-picker.tsx`) but **not mounted anywhere** in `src/app/(app)/pages/[pageId]/page.tsx` (commit `1b80c1f` removed the mount). It PATCHes `/api/pages/[pageId]/cover` → `setPageCover()` → `pages.cover`, and uploads to `/api/files`. This is the affordance to restore.

- [ ] **Step 3: Record the diagnosis in the PR description / commit body**

No file change in this task. The diagnosis (verbatim) for the commit body: *"Round-1 #16 kept the legacy `CoverImage` button (writes `pages.cover_url`) but the banner renders from the new `pages.cover` jsonb — so clicking Add cover wrote a field nothing reads. Restore the real `CoverPicker` (writes `pages.cover` via `/api/pages/[pageId]/cover`) and delete the legacy `CoverImage`."*

---

### Task 2: Add i18n strings for the cover picker

**Files:**
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`

The current `CoverPicker` hardcodes English strings ("Page cover", "Add cover", "Change cover", "Color", "Unsplash", "Upload", "Custom hex", "Use", "Remove cover", "Close cover picker", "Images are stored locally and served through signed URLs."). Per the i18n constraint, the new affordance's strings must be catalog-backed. Add keys; wiring happens in Task 3.

- [ ] **Step 1: Add the `cover.*` keys to `messages/en.json`**

Add (flat keys, matching the file's existing style — see `locale.*`):

```json
  "cover.add": "Add cover",
  "cover.change": "Change cover",
  "cover.dialogTitle": "Page cover",
  "cover.close": "Close cover picker",
  "cover.tab.color": "Color",
  "cover.tab.unsplash": "Unsplash",
  "cover.tab.upload": "Upload",
  "cover.customHex": "Custom hex",
  "cover.use": "Use",
  "cover.remove": "Remove cover",
  "cover.uploadHint": "Images are stored locally and served through signed URLs.",
  "cover.useColor": "Use {hex}"
```

- [ ] **Step 2: Mirror the keys in `messages/es.json` and `messages/ar.json`**

Provide translations (es) and Arabic (ar). If the project has an established convention that untranslated keys fall back to English, follow it — but read the head of each file first to confirm whether `es.json`/`ar.json` are complete mirrors or partial. Match whatever the existing files do (e.g. if `ar.json` mirrors every key, add all twelve; if it only carries a subset, match that subset and let fallback handle the rest). Suggested es values: `"Añadir portada"`, `"Cambiar portada"`, `"Portada de la página"`, `"Cerrar selector de portada"`, `"Color"`, `"Unsplash"`, `"Subir"`, `"Hex personalizado"`, `"Usar"`, `"Quitar portada"`, `"Las imágenes se almacenan localmente y se sirven mediante URL firmadas."`, `"Usar {hex}"`.

- [ ] **Step 3: Verify the i18n audit passes**

Run:

```bash
source ~/.zshenv && pnpm lint
```

(If the repo has a dedicated i18n parity check — e.g. an `i18n-audit` script that produced `i18n-audit.report.json` — run it too and confirm no new missing-key regressions.) Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/es.json messages/ar.json
git commit -m "i18n: add cover picker strings — refs #121"
```

---

### Task 3: Wire `CoverPicker` to the i18n catalog

**Files:**
- Modify: `src/components/pages/cover-picker.tsx`

`CoverPicker` is a Client Component. Read how other client components in the repo read translations (grep for `useTranslations`/`useFormatter`/`getTranslations` to find the established hook — likely `useTranslations()` from the i18n provider used by `locale-switcher.tsx`). Use the same hook. Do **not** invent a new i18n mechanism.

- [ ] **Step 1: Replace hardcoded strings with catalog lookups**

Read `src/components/locale-switcher.tsx` first to copy the exact translation-hook import and call signature this project uses. Then in `cover-picker.tsx`:
- Import the translation hook.
- Trigger label: `{'kind' in current ? t('cover.change') : t('cover.add')}`.
- Dialog title `h2`: `t('cover.dialogTitle')`.
- Close overlay `aria-label`: `t('cover.close')`.
- Tab labels: `tabBtn('color', t('cover.tab.color'))`, `tabBtn('unsplash', t('cover.tab.unsplash'))`, `tabBtn('upload', t('cover.tab.upload'))`.
- `Custom hex` label: `t('cover.customHex')`; `Use` button: `t('cover.use')`; `Remove cover` button: `t('cover.remove')`.
- Upload hint `<p>`: `t('cover.uploadHint')`.
- Color swatch `aria-label`: `t('cover.useColor', { hex })` (replaces the template-literal `` `Use ${hex}` ``).

Preserve all existing behavior (tabs, save/upload handlers, `onChange` vs `router.refresh()` fallback).

- [ ] **Step 2: Meet the 44px touch target on the trigger**

Add `className="min-h-11"` to the trigger `Button` (line ~92) so the affordance hits the WCAG AA 44px minimum:

```tsx
      <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setOpen(true)}>
        {'kind' in current ? t('cover.change') : t('cover.add')}
      </Button>
```

- [ ] **Step 3: Verify**

Run:

```bash
source ~/.zshenv && pnpm lint && pnpm typecheck
```

Expected: clean. (No new test file here — Task 5 adds the integration test that asserts the page mounts `CoverPicker`.)

- [ ] **Step 4: Commit**

```bash
git add src/components/pages/cover-picker.tsx
git commit -m "fix(cover): i18n + 44px trigger on CoverPicker — refs #121"
```

---

### Task 4: Restore `CoverPicker` as the in-flow affordance; delete legacy `CoverImage`

**Files:**
- Modify: `src/app/(app)/pages/[pageId]/page.tsx`
- Delete: `src/components/cover-image.tsx`

- [ ] **Step 1: Swap the mount in the page**

In `src/app/(app)/pages/[pageId]/page.tsx`:
- Replace the import `import { CoverImage } from '@/components/cover-image';` with `import { CoverPicker } from '@/components/pages/cover-picker';`.
- Re-add the env read that #16 removed, near the other env/cookie reads (~L55, after `showTocSidebar`):

```tsx
  const unsplashKey = env().NEXT_PUBLIC_CAIRN_UNSPLASH_ACCESS_KEY;
```

- Replace the `CoverImage` block (the `a7 #16` comment + `<CoverImage pageId={page.id} initial={page.coverUrl} />`, ~L66-70) with the picker, gated on `canEdit`, mounted in-flow where the cover renders:

```tsx
        {/* #121 — the in-flow CoverPicker is the single canonical "Add cover" /
            "Change cover" affordance. It writes the live `pages.cover` jsonb via
            /api/pages/[pageId]/cover and refreshes so CoverBanner re-renders.
            (Round-1 #16 had left the legacy CoverImage button here, which wrote
            the orphaned `cover_url` column the banner no longer reads.) */}
        {canEdit && (
          <div className="mb-2 flex justify-start">
            <CoverPicker pageId={page.id} current={cover} unsplashKey={unsplashKey} />
          </div>
        )}
```

Note `current={cover}` reuses the `cover` value already computed at ~L49 (`const cover = await getPageCover(...)`). `CoverBanner` above it already renders that same `cover`. Viewers (non-editors) see the banner but no picker, matching the pre-#16 behavior.

- [ ] **Step 2: Delete the legacy component**

```bash
source ~/.zshenv && rm src/components/cover-image.tsx
```

Confirm nothing else imports it:

```bash
source ~/.zshenv && grep -rn "cover-image" src ; grep -rn "CoverImage" src
```

Expected: no remaining references (Task 1 Step 1 already confirmed the page was the only consumer).

- [ ] **Step 3: Verify env var exists**

Confirm `NEXT_PUBLIC_CAIRN_UNSPLASH_ACCESS_KEY` is a declared/optional env (it was read here before #16):

```bash
source ~/.zshenv && grep -rn "NEXT_PUBLIC_CAIRN_UNSPLASH_ACCESS_KEY" src
```

Expected: present in `src/lib/env.ts` (or wherever env is validated). If absent, it's optional/undefined-tolerant (`CoverPicker` already treats `unsplashKey` as optional and hides the Unsplash tab when unset) — do not add validation; just pass it through.

- [ ] **Step 4: Verify**

```bash
source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build
```

Expected: clean build; `coverUrl`/`cover-image` no longer referenced.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/pages/[pageId]/page.tsx' src/components/cover-image.tsx
git commit -m "fix(cover): restore working CoverPicker, drop dead CoverImage button — Closes #121"
```

---

### Task 5: Integration test — the page mounts a working cover affordance

**Files:**
- Create: `tests/components/pages/cover-affordance.test.tsx`

The existing `tests/api/pages-cover.test.ts` + `tests/lib/pages/cover.test.ts` already cover the live route + lib. This task adds a component test proving the *affordance* is present and opens, guarding against a future regression that re-introduces a dead button.

- [ ] **Step 1: Write the failing test**

Read `tests/components/locale-switcher-es.test.tsx` first to copy the project's i18n-provider test harness (how it wraps a component so `t()` resolves). Then:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoverPicker } from '@/components/pages/cover-picker';

// Mock next/navigation router.refresh used by CoverPicker's save fallback.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

describe('CoverPicker affordance', () => {
  it('renders the Add cover trigger and opens the picker dialog on click', () => {
    // Wrap in the project's i18n provider — copy the wrapper from
    // tests/components/locale-switcher-es.test.tsx.
    render(/* <Provider><CoverPicker pageId="p1" current={{}} /></Provider> */);
    const trigger = screen.getByRole('button', { name: /add cover/i });
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: /page cover/i })).toBeTruthy();
  });
});
```

The implementer fills in the provider wrapper from the locale test. The assertion intent: trigger exists with the i18n "Add cover" label, and clicking it reveals the `role="dialog"` picker (proving the affordance is *not* dead).

- [ ] **Step 2: Run it, confirm it passes against the fixed code**

```bash
source ~/.zshenv && pnpm vitest run tests/components/pages/cover-affordance.test.tsx
```

Expected: PASS (the fix from Tasks 3-4 is in). If the i18n provider isn't trivially mountable in jsdom, fall back to asserting the trigger via its `aria-label`/text using whatever default-message behavior the harness gives — keep the "opens dialog on click" assertion regardless.

- [ ] **Step 3: Commit**

```bash
git add tests/components/pages/cover-affordance.test.tsx
git commit -m "test(cover): guard the Add cover affordance opens a picker — refs #121"
```

---

### Task 6: Add `category` to every slash item + group order helper

**Files:**
- Modify: `src/components/editor/slash-menu.tsx` (extend `SlashItem` type)
- Modify: `src/components/editor/slash-extension.ts` (tag items + raise slice; add a grouping helper)

- [ ] **Step 1: Extend the `SlashItem` type with a `category`**

In `src/components/editor/slash-menu.tsx`, add a category union and field:

```tsx
export type SlashCategory = 'basic' | 'media' | 'database' | 'advanced';

export type SlashItem = {
  title: string;
  description: string;
  category: SlashCategory;
  command: (editor: Editor) => void;
};
```

- [ ] **Step 2: Tag every item in `slash-extension.ts`**

Add `category` to each entry in the `items` array and to `pdfSlashItem`/`toSlashItem` outputs. Suggested mapping (the implementer assigns each existing entry to exactly one bucket):
- **basic:** Heading 1/2/3, Bullet list, Numbered list, Task list, Quote, Code, Divider, Callout, Toggle, Columns, Table of contents.
- **media:** Image, File, Video, Audio, PDF, Embed, Bookmark, Image gallery, Button.
- **database:** Table, Database, Page embed.
- **advanced:** Equation, Synced block, Mermaid diagram, PlantUML diagram, drawio diagram, Footnote, Citation, Date/time, Flashcard.

For `toSlashItem(entry)`, give it a category param: `toSlashItem(entry, 'advanced')` and spread it in. For `pdfSlashItem`, add `category: 'media'`.

(The exact bucket per item is a judgment call — keep it stable and obvious; the test in Task 8 only asserts that every item *has* a category and that the grouped order is a permutation of the flat list.)

- [ ] **Step 3: Raise the slice cap and keep filtering across all items**

Replace the suggestion `items` callback (currently `…filter(...).slice(0, 10)`):

```tsx
        items: ({ query }) =>
          items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase())),
```

Rationale: the grouped, scrollable menu (Task 7) shows the full catalog with a bounded `max-h` + overflow scroll, so the slice cap that was hiding ~30 blocks is removed. Typeahead still filters across *all* items (no cap), so every block is now reachable both by scrolling and by typing.

> **If a hard ceiling is desired** for very-empty queries, the alternative is `.slice(0, 50)` (well above the ~38 catalog size) — but a flat removal is simpler and the menu is already scroll-bounded. Use the removal unless the reviewer prefers an explicit cap.

- [ ] **Step 4: Add a stable grouping helper (exported for the menu + test)**

In `src/components/editor/slash-menu.tsx` (so both the renderer and the test import one source of truth), add:

```tsx
export const SLASH_CATEGORY_ORDER: SlashCategory[] = ['basic', 'media', 'database', 'advanced'];

export type SlashGroup = { category: SlashCategory; items: SlashItem[] };

/** Group items by category in a fixed display order, dropping empty groups.
 *  The flattened group order MUST equal the input filter order's category
 *  partition so keyboard nav (which indexes the flat list) stays coherent. */
export function groupSlashItems(items: SlashItem[]): SlashGroup[] {
  return SLASH_CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);
}
```

- [ ] **Step 5: Verify it compiles**

```bash
source ~/.zshenv && pnpm typecheck
```

Expected: clean (the menu renderer still consumes the flat `items` until Task 7; adding the field + helper is non-breaking).

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/slash-menu.tsx src/components/editor/slash-extension.ts
git commit -m "feat(editor): categorize slash items + remove 10-item cap — refs #122"
```

---

### Task 7: Render the grouped, scrollable, keyboard-navigable slash menu

**Files:**
- Modify: `src/components/editor/slash-menu.tsx`
- Modify: `messages/{en,es,ar}.json` (group header labels)

The menu must: render category headers, keep the flat `aria-activedescendant` keyboard model so Arrow/Enter traverse across groups, bound the height and scroll, and keep the active option scrolled into view.

- [ ] **Step 1: Add group-header i18n strings**

Add to `messages/en.json`:

```json
  "slash.group.basic": "Basic",
  "slash.group.media": "Media",
  "slash.group.database": "Database",
  "slash.group.advanced": "Advanced"
```

Mirror in `es.json` (`"Básico"`, `"Multimedia"`, `"Base de datos"`, `"Avanzado"`) and `ar.json` (match the file's existing coverage convention). The slash menu is a Client Component rendered via `ReactRenderer`; confirm it sits under the i18n provider — read whether other editor client components call `useTranslations`. If the `ReactRenderer`-mounted tree is **outside** the provider (a known TipTap pitfall — it portals to `document.body`), then either (a) pass the resolved labels in as props from a provider-scoped parent, or (b) use a small static label map keyed by category as a fallback. Prefer (a)/the provider if reachable; document the choice in a code comment.

- [ ] **Step 2: Rewrite `SlashMenu` to render groups while preserving the flat index**

Key invariant: build the **flat** ordered list (`groups.flatMap(g => g.items)`) for keyboard indexing and `command`, but *render* it partitioned with headers. Compute each item's flat index as you map so `aria-activedescendant`/highlight stay correct across group boundaries.

```tsx
'use client';

import type { Editor } from '@tiptap/react';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

export type SlashCategory = 'basic' | 'media' | 'database' | 'advanced';

export type SlashItem = {
  title: string;
  description: string;
  category: SlashCategory;
  command: (editor: Editor) => void;
};

export type SlashMenuRef = { onKeyDown: (event: KeyboardEvent) => boolean };

export const SLASH_CATEGORY_ORDER: SlashCategory[] = ['basic', 'media', 'database', 'advanced'];
export type SlashGroup = { category: SlashCategory; items: SlashItem[] };

export function groupSlashItems(items: SlashItem[]): SlashGroup[] {
  return SLASH_CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);
}

// ReactRenderer portals this tree to document.body, which may sit outside the
// i18n provider. Use a static label map so headers always resolve; if the
// editor tree IS under the provider, swap to t(`slash.group.${category}`).
const CATEGORY_LABEL: Record<SlashCategory, string> = {
  basic: 'Basic',
  media: 'Media',
  database: 'Database',
  advanced: 'Advanced',
};

export const SlashMenu = forwardRef<
  SlashMenuRef,
  { items: SlashItem[]; command: (item: SlashItem) => void }
>(function SlashMenu({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  const listId = useId();
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when filtered items change
  useEffect(() => {
    setIndex(0);
  }, [items]);

  // Keep the highlighted option in view as Arrow keys move across groups.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [index]);

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

  const groups = groupSlashItems(items);
  const activeId = `${listId}-${index}`;
  let flat = -1; // running flat index across groups

  return (
    <div className="w-64 rounded-md border bg-popover shadow-md">
      <div
        role="listbox"
        aria-label="Slash commands"
        aria-activedescendant={activeId}
        tabIndex={0}
        className="max-h-80 overflow-y-auto py-1"
      >
        {groups.map((group) => (
          <div key={group.category} role="group" aria-label={CATEGORY_LABEL[group.category]}>
            <div
              role="presentation"
              className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {CATEGORY_LABEL[group.category]}
            </div>
            {group.items.map((item) => {
              flat += 1;
              const i = flat;
              return (
                <div key={item.title} role="option" id={`${listId}-${i}`} aria-selected={i === index} tabIndex={-1}>
                  <button
                    ref={i === index ? activeRef : undefined}
                    type="button"
                    tabIndex={-1}
                    onClick={() => command(item)}
                    className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-accent ${
                      i === index ? 'bg-accent' : ''
                    }`}
                  >
                    <div className="font-medium">{item.title}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
```

Notes:
- The `command`/keyboard model still indexes the **flat** `items` prop (unchanged contract with `slash-extension.ts`'s `onKeyDown`/`onUpdate`). Grouping is presentation-only; the flat index is recomputed during render to match the visual order. **Critical:** the flat order the menu renders (`groups.flatMap(...)`) must equal the order the extension's `onKeyDown` indexes. Since both derive from the same `items` prop via the same `groupSlashItems` partition, they agree — but the extension still passes the *ungrouped filtered* `items`. Keep the `index` arithmetic on `items.length`; the visual flat order differs from `items` order only if a category interleaves. To guarantee they match, have the **menu** be the single owner of order: change `slash-extension.ts`'s `onKeyDown` to defer entirely to `component.ref?.onKeyDown` (it already does) and ensure `command` is invoked with the menu's chosen item (it is — Enter calls `command(items[index])`). Because Enter uses `items[index]` (the *prop* order) while the *render* uses grouped order, **the implementer MUST make these consistent**: either (a) pass already-grouped-flattened items into the menu (preferred — see Task 7 Step 3), or (b) have the menu key off a memoized `groupSlashItems(items).flatMap(g => g.items)` for *both* render and `items[index]`. Choose (b) inside this component: compute `const ordered = useMemo(() => groupSlashItems(items).flatMap((g) => g.items), [items]);` and use `ordered` for indexing, length, and `command`, while still rendering by group. This keeps a single source of truth and is the safest.
- `role="presentation"` on headers keeps them out of the option index; `role="group"` + `aria-label` gives SR users category context without becoming focusable.
- `max-h-80 overflow-y-auto` bounds the popup; `scrollIntoView({ block: 'nearest' })` keeps the active row visible during keyboard traversal.

- [ ] **Step 3: Apply the single-source-of-truth fix from the note**

Inside `SlashMenu`, add:

```tsx
  const ordered = useMemo(() => groupSlashItems(items).flatMap((g) => g.items), [items]);
```

and use `ordered` (not `items`) everywhere the flat list is consumed: the `% ordered.length` arithmetic, `ordered[index]` in Enter, the empty-check (`ordered.length === 0`), and render the groups from `groupSlashItems(items)` (same partition, so indices line up). Import `useMemo`.

- [ ] **Step 4: Verify**

```bash
source ~/.zshenv && pnpm lint && pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/slash-menu.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "feat(editor): grouped, scrollable slash menu (keyboard-nav across groups) — Closes #122"
```

---

### Task 8: Tests — grouping helper + full-catalog discoverability + keyboard traversal

**Files:**
- Create: `tests/components/editor/slash-menu-groups.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  groupSlashItems,
  SlashMenu,
  type SlashItem,
  type SlashMenuRef,
} from '@/components/editor/slash-menu';

afterEach(cleanup);

const mk = (title: string, category: SlashItem['category']): SlashItem => ({
  title,
  description: `${title} desc`,
  category,
  command: vi.fn(),
});

const sample: SlashItem[] = [
  mk('Heading 1', 'basic'),
  mk('Image', 'media'),
  mk('Database', 'database'),
  mk('Equation', 'advanced'),
  mk('Quote', 'basic'),
];

describe('groupSlashItems', () => {
  it('partitions into fixed category order, dropping empties', () => {
    const groups = groupSlashItems(sample);
    expect(groups.map((g) => g.category)).toEqual(['basic', 'media', 'database', 'advanced']);
    // flatten preserves a stable permutation of the input
    const flat = groups.flatMap((g) => g.items.map((i) => i.title));
    expect(flat).toEqual(['Heading 1', 'Quote', 'Image', 'Database', 'Equation']);
  });
});

describe('<SlashMenu> grouped rendering + keyboard nav', () => {
  it('renders all items grouped (no 10-item cap) with category headers', () => {
    render(<SlashMenu items={sample} command={vi.fn()} />);
    // every item is discoverable in the DOM
    for (const it of sample) expect(screen.getByText(it.title)).toBeTruthy();
    // group headers present
    expect(screen.getByText('Basic')).toBeTruthy();
    expect(screen.getByText('Media')).toBeTruthy();
  });

  it('ArrowDown then Enter selects the second item in grouped flat order', () => {
    const command = vi.fn();
    const ref = createRef<SlashMenuRef>();
    render(<SlashMenu ref={ref} items={sample} command={command} />);
    // flat grouped order: Heading 1, Quote, Image, Database, Equation
    ref.current?.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    ref.current?.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ title: 'Quote' }));
  });
});
```

The second SlashMenu test is the regression guard for #122: it proves the full list renders (no slice) and that keyboard traversal follows the **grouped flat order** (so the index the user sees matches the item that fires).

- [ ] **Step 2: Run**

```bash
source ~/.zshenv && pnpm vitest run tests/components/editor/slash-menu-groups.test.tsx
```

Expected: PASS. (Note `KeyboardEvent` in jsdom is fine; if `setState` warnings appear, wrap the `onKeyDown` calls in `act(...)` from `@testing-library/react`.)

- [ ] **Step 3: Commit**

```bash
git add tests/components/editor/slash-menu-groups.test.tsx
git commit -m "test(editor): grouped slash menu discoverability + keyboard order — refs #122"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run the gate**

```bash
source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm vitest run tests/components/pages/cover-affordance.test.tsx tests/components/editor/slash-menu-groups.test.tsx tests/api/pages-cover.test.ts && pnpm build
```

Expected: clean lint/types, the new + existing cover tests pass, build succeeds.

- [ ] **Step 2: Manual smoke (optional, if a dev server is available)**

`source ~/.zshenv && pnpm dev`, open a page: confirm (a) "Add cover" opens the picker, picking a color/upload applies a banner that persists across reload; (b) typing `/` shows grouped headers (Basic/Media/Database/Advanced) with the full catalog scrollable, Arrow keys move across groups, Enter inserts the highlighted block, and typeahead (`/data`, `/equ`) still filters.

---

## Self-Review

- **#121 diagnosis is in the plan + commit body:** the surviving `CoverImage` button *was* wired (`onClick={upload}` fires), but it PATCHed the legacy `pages.cover_url` column that the `CoverBanner` renderer ignores (renderer reads the new `pages.cover` jsonb). The working control — `CoverPicker`, writing `pages.cover` via `/api/pages/[pageId]/cover` — was the one removed by round-1 #16. Fix restores `CoverPicker` and deletes `CoverImage`. ✓
- **#122:** slice cap removed; full catalog grouped into Basic/Media/Database/Advanced; scrollable; typeahead still filters across all items; keyboard nav traverses the grouped flat order via a single `ordered` source of truth. ✓
- **Yjs-safety:** no document/schema/node-type changes; cover lives in a server row, slash change is menu presentation only. ✓
- **i18n:** all new user-visible strings added to `messages/{en,es,ar}.json`; cover picker wired to the catalog; slash headers labeled (provider-or-static-map decision documented). ✓
- **WCAG AA + 44px:** cover trigger gets `min-h-11`; slash menu keeps `role="listbox"`/`aria-activedescendant`, headers are `role="presentation"`, groups are `role="group"` with labels, active row scrolls into view. ✓
- **No placeholders left except where the plan explicitly says "read the file first"** (the i18n hook signature, the test provider wrapper, per-item category bucketing) — the implementer must read those files before filling them in. ✓
