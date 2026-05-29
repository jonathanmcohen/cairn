# P23 — Page Action Panels & Title-Row Affordances (Round 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the title-row affordance cluster on the page-detail view — the Comments drawer, Version history, Lock, and Export panels that all hang off the action bar in `src/app/(app)/pages/[pageId]/page.tsx`, plus two suggestion-toolbar affordances in the editor strip. This covers low-contrast / borderless controls, missing icons, bare empty states, a custom lock duration, a non-interactive suggestions badge, missing button icons+tooltips, and two structural fixes: making the three right-rail panels **mutually exclusive with shared Escape dismissal**, and clamping the export dropdown inside the viewport on narrow screens.

**Architecture:** The action bar in `page.tsx` currently mounts four independent panel components, each owning its own `open` boolean (`CommentsToggle`, `VersionHistory`, `LockToggle` popover, `PageExportMenu` `<details>`). The cross-modal fix (#93) introduces a single client-side **page-panels controller** that hoists "which panel is open" into one shared piece of state, so opening one closes the others and a single Escape handler dismisses the open one. Because `page.tsx` is an RSC, the controller is a new `'use client'` wrapper that receives the panel children's props and renders the trigger row; the existing panel components become controlled (open/onOpenChange props) instead of self-stateful. The export dropdown migrates to a `radix-ui` `DropdownMenu` (already in the dep) for built-in collision handling + viewport clamping (#94) and free focus/Escape semantics. Suggestion-toolbar fixes (#98, #101) are presentation/handler-only edits to `suggestion-toolbar.tsx` + a small `editor.tsx` callback for the "jump to first open suggestion" behavior.

All four panel components currently render **hardcoded English** (none consume `useT()`). Every new or relabeled string lands in `messages/{en,es,ar}.json` under a new `pageActions.*` namespace and is read via `useT()` (client hook from `@/lib/i18n/provider`), satisfying the i18n gate (`pnpm i18n:check`).

**Tech Stack:** React 19 + Next 16 App Router (RSC + `'use client'` islands), `radix-ui` 1.4.x (`DropdownMenu`, `Tooltip` exports confirmed present), TipTap 3 editor surface, Tailwind v4 (CSS-first `@theme` in `src/app/globals.css`), `lucide-react` icons, `cn()` from `src/lib/utils.ts`, i18n via `@/lib/i18n/provider` (`useT`), Biome v2, Vitest v4.

**Covers:** GH #85, #86, #87 (comments drawer), #88, #89 (version history), #90 (lock), #91, #92 (export), #93 (cross-modal mutual-exclusion + Escape), #94 (mobile export overflow), #98, #101 (suggestion toolbar).

---

## Cross-plan coordination (READ FIRST)

`src/components/editor/suggestion-toolbar.tsx` and `src/components/editor/editor.tsx` are **also touched by P13 (`-14-editor-blocks.md`) Task 8 (#39)**. P13 Task 8 is a *diagnose-and-re-fix* of the round-1 tab-strip separators + active states + the `N open` muted chip styling (the `bg-muted` pill at the bottom of `suggestion-toolbar.tsx`). This plan (#98/#101) changes **different concerns in the same file**:

- **#39 (P13):** the *outer strip layout* in `editor.tsx` (`h-4 w-px bg-border` separators, status pill, Outline `aria-pressed`) and the *visual styling* of the `Suggesting` toggle + the `N open` chip in `suggestion-toolbar.tsx`.
- **#98 / #101 (this plan):** makes the `N open` chip a **`<button>`** that focuses the first open suggestion, and adds **icons + tooltips + accessible labels** to the `Mark insert` / `Mark delete` buttons.

**To avoid conflict:**
1. Sequence-wise, **land P13 Task 8 before this plan's Task 6** if both are in flight (the index orders P13 before P23). If P13 Task 8 is not yet landed, this plan's Task 6 still applies cleanly because it edits distinct JSX nodes — but the implementer **must re-read the file at Step 1** and preserve any separator/active-state markup P13 added (do not revert the `bg-muted` → keep it as the button's resting style; do not remove separators in `editor.tsx`).
2. This plan's Task 6 **must not touch** the outer `editor.tsx` strip separators or the Outline/status pill — those belong to #39. The only `editor.tsx` change here is adding one `onJumpToFirstOpen` callback passed into `SuggestionToolbar`.
3. Note the shared file in the commit body so reviewers cross-check: `# touches suggestion-toolbar.tsx — also edited by P13 #39 (styling); this PR changes interactivity only`.

---

### Task 1: Comments composer border + submit-button contrast + empty state (#85, #86, #87)

**Files:**
- Modify: `src/components/comments/comment-composer.tsx` (composer border)
- Modify: `src/components/comments/comment-panel.tsx` (submit button, empty state)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json` (new `pageActions.comments.*` keys)
- Test: `tests/components/comments/comment-panel.test.tsx` (create if absent)

**Diagnosis note (#85):** `comment-composer.tsx` *already* wraps `<EditorContent>` in a `border-input` border. The audit reads it as "no visible border" because `--input` is a very low-contrast token against `--background` (light: `240 5.9% 90%` border vs near-white bg; dark: `240 3.7% 15.9%` vs near-black). The fix is **not** to add a border (one exists) but to raise its contrast and make the focus state unambiguous — bump to `border` + a clearer focus ring, and add a visually-distinct surface.

- [ ] **Step 1: Write/extend the failing test**

Create `tests/components/comments/comment-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';
import { CommentPanel } from '@/components/comments/comment-panel';

afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  return <I18nProvider locale="en" messages={enMessages}>{ui}</I18nProvider>;
}

describe('<CommentPanel>', () => {
  it('renders an icon + copy empty state when there are no comments', () => {
    render(
      wrap(
        <CommentPanel
          pageId="p1"
          canComment
          currentUserId="u1"
          currentRole="editor"
          open
          onClose={() => {}}
        />,
      ),
    );
    // Empty-state copy (not the bare "No comments yet.")
    expect(screen.getByText(/no comments yet/i)).toBeTruthy();
    // The submit button is a primary, enabled-looking control (not ghost/disabled-by-default styling)
    const submit = screen.getByRole('button', { name: /comment/i });
    expect(submit.className).not.toContain('variant-ghost');
  });
});
```

Run: `source ~/.zshenv && pnpm vitest run tests/components/comments/comment-panel.test.tsx`
Expected: FAIL (the empty-state copy key / icon not yet present; assertion mismatch).

- [ ] **Step 2: Add i18n strings**

Add to each of `messages/en.json`, `messages/es.json`, `messages/ar.json` (translate values per locale; keys identical). English values:

```json
"pageActions.comments.title": "Comments",
"pageActions.comments.placeholder": "Add a comment…",
"pageActions.comments.submit": "Comment",
"pageActions.comments.submitting": "Adding…",
"pageActions.comments.empty.title": "No comments yet",
"pageActions.comments.empty.body": "Start a discussion — comments are visible to everyone with access to this page.",
"pageActions.comments.close": "Close comments"
```

For `es.json` and `ar.json` provide proper translations (mirror the tone of existing entries; e.g. ES `"pageActions.comments.submit": "Comentar"`). Run `pnpm i18n:check` later in Step 5 to confirm parity.

- [ ] **Step 3: Fix the composer border (#85)**

In `comment-composer.tsx`, replace the wrapper `className` (currently `border-input … focus-within:ring-1`) with a higher-contrast border + clearer focus + a min touch target:

```tsx
    <div className="w-full rounded-md border border-border bg-background px-2 py-1.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
      <EditorContent editor={editor} />
    </div>
```

Wire the placeholder through i18n: the composer accepts a `placeholder` prop already — pass `t('pageActions.comments.placeholder')` from the panel (Step 4) rather than hardcoding. Keep the composer itself prop-driven (no `useT` inside the editor-extension file to avoid SSR-extension churn).

- [ ] **Step 4: Fix submit button + empty state (#86, #87) in `comment-panel.tsx`**

Add `import { useT } from '@/lib/i18n/provider';` and `import { MessageSquarePlus } from 'lucide-react';`, then `const t = useT();` at the top of the component.

(a) **Submit button (#86):** it is already `<Button size="sm">` (default variant = primary), but it *reads* disabled because `disabled={submitting || draft.trim().length === 0}` makes it `opacity-50` while empty — which is correct UX, but the audit wants the resting (non-empty) state to clearly read as primary/AA. Ensure it uses the default (primary) variant explicitly and a ≥44px height when it is the sole CTA, and label it via i18n:

```tsx
          <Button
            type="button"
            size="default"
            className="min-h-11 w-full"
            disabled={submitting || draft.trim().length === 0}
            onClick={() => void addComment()}
          >
            {submitting ? t('pageActions.comments.submitting') : t('pageActions.comments.submit')}
          </Button>
```

Verify in `src/components/ui/button.tsx` that the `default` variant maps to `bg-primary text-primary-foreground` (it does) — these tokens are AA against each other in both themes. Do **not** introduce a custom color.

(b) **Empty state (#87):** replace the bare `<p>No comments yet.</p>` block with an icon + title + body:

```tsx
        {unresolved.length === 0 && resolved.length === 0 && !error && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessageSquarePlus aria-hidden="true" className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t('pageActions.comments.empty.title')}</p>
            <p className="text-muted-foreground text-xs">{t('pageActions.comments.empty.body')}</p>
          </div>
        )}
```

Also swap the panel heading + close-button label + composer placeholder to the new i18n keys:
- `<h2>` → `{t('pageActions.comments.title')}`
- close button `title="Close"` → `aria-label={t('pageActions.comments.close')}`
- `<CommentComposer … placeholder={t('pageActions.comments.placeholder')} />`

- [ ] **Step 5: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/comments/comment-panel.test.tsx && pnpm i18n:check && pnpm lint && pnpm typecheck`
Expected: PASS; i18n parity clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/comments/comment-composer.tsx src/components/comments/comment-panel.tsx messages/en.json messages/es.json messages/ar.json tests/components/comments/comment-panel.test.tsx
git commit -m "fix(comments): visible composer border + primary submit (AA) + empty state — Closes #85 Closes #86 Closes #87"
```

---

### Task 2: Version history — "Save snapshot now" + auto-save explanation + empty-state icon (#88, #89)

**Files:**
- Create: `src/app/api/pages/[pageId]/versions/snapshot/route.ts` (POST — manual snapshot)
- Modify: `src/components/pages/version-history.tsx`
- Modify: `messages/{en,es,ar}.json`
- Test: `tests/api/pages/versions-snapshot.test.ts` (route), extend any existing version-history component test

**Snapshot API discovery:** versions are created by `snapshotIfChanged(db, { pageId, content, authorId })` in `src/lib/pages/versions.ts`, currently invoked from the page PATCH route (`src/app/api/pages/[pageId]/route.ts` ~L52) — debounced by `SNAPSHOT_DEBOUNCE_MS` (60s) and deduped by canonical JSON. There is **no manual snapshot endpoint**; the versions route (`versions/route.ts`) only has `GET`. The "Save snapshot now" button needs a POST that forces a snapshot of the live page content **bypassing the debounce** (a deliberate user action should always capture, subject only to the content-dedupe).

- [ ] **Step 1: Write the failing route test**

Create `tests/api/pages/versions-snapshot.test.ts` modeled on the existing version-route test (find it: `tests/api/pages/versions*.test.ts`; copy its auth-mock + Testcontainers setup). Assert: POST `/api/pages/[pageId]/versions/snapshot` as an editor returns 201 with the inserted version (or 200 + `{ skipped: true }` when content is unchanged from latest), 403 for a viewer, 404 cross-workspace.

Run: `source ~/.zshenv && pnpm vitest run tests/api/pages/versions-snapshot.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 2: Add a `force` path to the snapshot lib**

In `src/lib/pages/versions.ts`, add an optional `force` flag to `snapshotIfChanged` (or a thin `snapshotNow` wrapper) that **skips only the time-debounce** but keeps the content-dedupe (don't write a duplicate version):

```ts
export async function snapshotIfChanged(
  db: PostgresJsDatabase<typeof schema>,
  input: SnapshotInput,
  opts: { force?: boolean } = {},
): Promise<schema.PageVersion | null> {
  return db.transaction(async (tx) => {
    const [latest] = await tx /* …unchanged select… */;
    if (latest) {
      const age = Date.now() - latest.createdAt.getTime();
      if (!opts.force && age < SNAPSHOT_DEBOUNCE_MS) return null; // debounce only when not forced
      if (canonicalJson(latest.content) === canonicalJson(input.content)) return null; // unchanged
    }
    /* …insert + prune unchanged… */
  });
}
```

The PATCH caller passes no `opts`, so its behavior is unchanged. Add/extend a unit test for the `force` branch in the existing versions lib test.

- [ ] **Step 3: Implement the POST route**

`src/app/api/pages/[pageId]/versions/snapshot/route.ts`, modeled on `versions/route.ts`'s error handling and `requirePageAccess(pageId, 'editor')`. Load the live page content (read the page row), call `snapshotIfChanged(getDb(), { pageId, content: page.content, authorId: ctx.userId }, { force: true })`. Return `201` + the row when inserted, `200` + `{ skipped: true }` when null. Record an audit row if the surrounding pattern does (grep the PATCH route).

- [ ] **Step 4: Wire the UI (#88) + empty-state icon (#89) in `version-history.tsx`**

Add `import { useT } from '@/lib/i18n/provider';` + `const t = useT();`, and `import { Camera, History, RotateCcw, X } from 'lucide-react';` (add `Camera`).

(a) **Auto-save explanation + Save snapshot now (#88):** at the top of the scroll area (above the version list), add a short explainer + button (editor-only):

```tsx
              {canEdit && (
                <div className="mb-3 rounded-md border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs">
                    {t('pageActions.versions.autosaveHint')}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 min-h-9"
                    disabled={saving}
                    onClick={() => void saveSnapshotNow()}
                  >
                    <Camera aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
                    {saving ? t('pageActions.versions.saving') : t('pageActions.versions.saveNow')}
                  </Button>
                </div>
              )}
```

Add a `const [saving, setSaving] = useState(false);` and a `saveSnapshotNow()` that POSTs to the new route, then `await refetch()`, with a `toast.success(t('pageActions.versions.saved'))` / `toast.error(...)`. Note the component does **not** hold the live editor content — the route reads it server-side from the page row, so the button needs no content payload (the editor autosaves to the page on change; a manual snapshot captures the persisted state). Add a one-line comment saying so.

(b) **Empty-state icon (#89):** replace `<p>No saved versions yet.</p>` with an icon + copy block (mirror Task 1's empty-state shape, using `History` as the glyph and `t('pageActions.versions.empty.title')` / `.body`).

- [ ] **Step 5: Add i18n strings**

```json
"pageActions.versions.title": "Version history",
"pageActions.versions.close": "Close version history",
"pageActions.versions.autosaveHint": "Versions are saved automatically as you edit (about once a minute). Save a snapshot now to capture the current state.",
"pageActions.versions.saveNow": "Save snapshot now",
"pageActions.versions.saving": "Saving…",
"pageActions.versions.saved": "Snapshot saved",
"pageActions.versions.empty.title": "No saved versions yet",
"pageActions.versions.empty.body": "Edits are snapshotted automatically. Once you start editing, versions will appear here."
```

(plus ES/AR translations). Swap the existing hardcoded heading + close label to the keys.

- [ ] **Step 6: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/api/pages/versions-snapshot.test.ts && pnpm vitest run tests/lib/pages/versions.test.ts && pnpm i18n:check && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS; build clean. (Adjust the lib test path to the real one — grep `tests` for `versions`.)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/pages/[pageId]/versions/snapshot/route.ts src/lib/pages/versions.ts src/components/pages/version-history.tsx messages/en.json messages/es.json messages/ar.json tests/api/pages/versions-snapshot.test.ts tests/lib/pages/versions.test.ts
git commit -m "feat(versions): manual 'Save snapshot now' + auto-save hint + empty-state icon — Closes #88 Closes #89"
```

---

### Task 3: Lock toggle — icons on menu items + custom duration (#90)

**Files:**
- Modify: `src/components/pages/lock-toggle.tsx`
- Modify: `messages/{en,es,ar}.json`
- Test: `tests/components/pages/lock-toggle.test.tsx` (create/extend)

- [ ] **Step 1: Write/extend the failing test**

Render `<LockToggle pageId="p1" />` inside `<I18nProvider>`, open the menu (click the trigger), assert: each `menuitem` has an icon (svg child), and there is a custom-duration `menuitem` that reveals a number input + unit when chosen.

Run: `source ~/.zshenv && pnpm vitest run tests/components/pages/lock-toggle.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Add icons + custom duration**

Add `import { Clock, Hourglass, Infinity as InfinityIcon, Lock } from 'lucide-react';` and `import { useT } from '@/lib/i18n/provider';`. Each existing `menuitem` button gets a leading icon (`InfinityIcon` for indefinite, `Clock` for 1h, `Clock`/`Hourglass` for 24h) inside `<span className="inline-flex items-center gap-2">…`. Ensure each item is `min-h-11` (touch target) and keeps `role="menuitem"`.

Add a fourth item "Custom…" that, when clicked, swaps the menu body to a tiny inline form (do not close the menu): a `<Select>` (reuse `@/components/ui/select` — already built in P01) for the unit (hours/days) + a number `<Input>` for the amount + a "Lock" confirm button. On confirm, compute `hours` (days × 24) and call the existing `lockFor(hours)`. Keep the click-outside + Escape effect intact (it already closes on Escape — preserve it; the custom sub-form's Escape should fall through to closing the menu, which is acceptable accessible behavior).

Label everything via i18n (Step 3). Keep `aria-label` on the trigger as `t('pageActions.lock.trigger')`.

- [ ] **Step 3: Add i18n strings**

```json
"pageActions.lock.trigger": "Lock page",
"pageActions.lock.menuLabel": "Lock page menu",
"pageActions.lock.indefinite": "Lock indefinitely",
"pageActions.lock.oneHour": "Lock for 1 hour",
"pageActions.lock.oneDay": "Lock for 24 hours",
"pageActions.lock.custom": "Custom…",
"pageActions.lock.customAmount": "Duration",
"pageActions.lock.unitHours": "Hours",
"pageActions.lock.unitDays": "Days",
"pageActions.lock.confirm": "Lock"
```

(plus ES/AR). Replace the three hardcoded button labels.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/pages/lock-toggle.test.tsx && pnpm i18n:check && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/pages/lock-toggle.tsx messages/en.json messages/es.json messages/ar.json tests/components/pages/lock-toggle.test.tsx
git commit -m "fix(lock): menu-item icons + custom-duration option — Closes #90"
```

---

### Task 4: Export menu — radix DropdownMenu (viewport clamp) + icons + "PDF" relabel (#91, #92, #94)

**Files:**
- Modify: `src/components/pages/export-menu.tsx`
- Modify: `messages/{en,es,ar}.json`
- Test: `tests/components/pages/export-menu.test.tsx` (create/extend)

This task **combines #91 (icons), #92 (relabel), and #94 (mobile overflow)** because the cleanest fix for #94 is migrating the native `<details>` to a `radix-ui` `DropdownMenu`, which brings collision-aware positioning for free — and once it's a DropdownMenu, the icons + relabel land in the same rewrite. (#93's Escape/mutual-exclusion is handled by the controller in Task 5; a DropdownMenu's own Escape closes itself, and the controller treats "menu open" as the single open panel.)

- [ ] **Step 1: Write the failing test**

Render `<PageExportMenu pageId="p1" />` in `<I18nProvider>`, open the menu, assert: three items present with icons; the PDF item label is exactly "PDF" (not "PDF (via browser print)"); the anchors still point at `/api/pages/p1/export?format=md|json|pdf` with correct `download`/`target` attributes.

Run: `source ~/.zshenv && pnpm vitest run tests/components/pages/export-menu.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Rewrite on radix DropdownMenu**

```tsx
'use client';

import { Download, FileCode, FileJson, FileText } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

export function PageExportMenu({
  pageId,
  open,
  onOpenChange,
}: {
  pageId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const href = (format: string) => `/api/pages/${pageId}/export?format=${format}`;
  const itemCls =
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground';
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <Button variant="outline" size="sm">
          <Download aria-hidden="true" className="mr-1 h-4 w-4" />
          {t('pageActions.export.trigger')}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 min-w-[10rem] max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <DropdownMenu.Item asChild>
            <a href={href('md')} download className={itemCls}>
              <FileText aria-hidden="true" className="h-4 w-4" />
              {t('pageActions.export.markdown')}
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <a href={href('json')} download className={itemCls}>
              <FileJson aria-hidden="true" className="h-4 w-4" />
              {t('pageActions.export.json')}
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <a href={href('pdf')} target="_blank" rel="noopener noreferrer" className={itemCls}>
              <FileCode aria-hidden="true" className="h-4 w-4" />
              {t('pageActions.export.pdf')}
            </a>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
```

`collisionPadding={8}` + `max-w-[calc(100vw-1rem)]` + radix's collision detection clamp the menu inside a ≤390px viewport (#94). The `open`/`onOpenChange` props make it controllable by the Task 5 controller (when omitted it self-manages, so the component stays usable standalone / in tests).

- [ ] **Step 3: Add i18n strings**

```json
"pageActions.export.trigger": "Export",
"pageActions.export.markdown": "Markdown (.md)",
"pageActions.export.json": "JSON",
"pageActions.export.pdf": "PDF"
```

(plus ES/AR — note "PDF" stays "PDF" in all locales). The old `"PDF (via browser print)"` string is dropped (#92); keep the explanatory note in the file's top comment so the browser-print mechanism stays documented.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/pages/export-menu.test.tsx && pnpm i18n:check && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS. Optionally screenshot at 390px to confirm no right-edge overflow (manual / a11y CI viewport).

- [ ] **Step 5: Commit**

```bash
git add src/components/pages/export-menu.tsx messages/en.json messages/es.json messages/ar.json tests/components/pages/export-menu.test.tsx
git commit -m "fix(export): radix dropdown (viewport clamp) + item icons + 'PDF' relabel — Closes #91 Closes #92 Closes #94"
```

---

### Task 5: Shared single-panel controller — mutual exclusion + Escape (#93)

**Files:**
- Create: `src/components/pages/page-action-panels.tsx` (the `'use client'` controller)
- Modify: `src/components/comments/comments-toggle.tsx` → become controlled (or fold into the controller)
- Modify: `src/components/pages/version-history.tsx` → accept `open`/`onOpenChange`
- Modify: `src/components/pages/lock-toggle.tsx` → accept `open`/`onOpenChange`
- Modify: `src/app/(app)/pages/[pageId]/page.tsx` → render the controller in place of the four loose triggers
- Test: `tests/components/pages/page-action-panels.test.tsx`

**Chosen approach — single hoisted `openPanel` enum in one client wrapper.** Rather than a global store or context, introduce one client component, `<PageActionPanels>`, that owns:

```ts
type ActivePanel = 'comments' | 'versions' | 'export' | 'lock' | null;
const [active, setActive] = useState<ActivePanel>(null);
```

It renders the trigger row (the comments/version/export/lock triggers) and passes each child `open={active === '<id>'}` + `onOpenChange={(o) => setActive(o ? '<id>' : null)}`. Because all four share one state variable, **opening any one closes the others** (mutual exclusion is structural, not coordinated by side-effects). A single `useEffect` registers one `keydown` listener that closes the active panel on Escape:

```tsx
useEffect(() => {
  if (active == null) return;
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setActive(null);
    }
  }
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, [active]);
```

The two drawers (comments, versions) are `fixed inset-y-0 right-0` rails; lock is a popover; export is a radix DropdownMenu. Radix DropdownMenu already closes itself on Escape and on outside-click — to keep the controller authoritative, pass it `open`/`onOpenChange` so its internal Escape also flows through `setActive(null)`; the controller's own Escape listener is then a no-op-safe second path (idempotent). For the non-radix panels (drawers/popover) the controller's Escape is the dismissal path.

This keeps each panel component's internal mechanics (fetch, render) intact — only their open-state ownership moves up. Props are additive and optional, so the panels remain independently testable.

- [ ] **Step 1: Write the failing test**

Render `<PageActionPanels>` with the four child props, then:
- Open comments → comments drawer visible; open versions → comments drawer gone, versions visible (mutual exclusion).
- With a panel open, fire `keydown` Escape on `document` → no panel visible.

Run: `source ~/.zshenv && pnpm vitest run tests/components/pages/page-action-panels.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 2: Make the panels controllable**

For each of `comments-toggle.tsx`, `version-history.tsx`, `lock-toggle.tsx`: accept optional `open?: boolean` and `onOpenChange?: (open: boolean) => void`. When provided, use them instead of the internal `useState`; when absent, fall back to internal state (so existing standalone usage + tests keep working). Concretely:

```ts
const [internalOpen, setInternalOpen] = useState(false);
const open = controlledOpen ?? internalOpen;
const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
  const value = typeof next === 'function' ? next(open) : next;
  onOpenChange ? onOpenChange(value) : setInternalOpen(value);
};
```

`comments-toggle.tsx` currently passes `pageId/canComment/currentUserId/currentRole` to `CommentPanel` — keep that; only its open-state ownership changes. `lock-toggle.tsx` keeps its click-outside + Escape effect (the controller's Escape is additive; both calling `setActive(null)` is harmless).

- [ ] **Step 3: Create `page-action-panels.tsx`**

A `'use client'` component taking the union of props the four triggers need (pageId, canComment, currentUserId, currentRole, canEditVersions, canLock, showLock). It owns `active` + the Escape effect, renders the trigger row in the same visual order as today (Comments, Version history, Export, Lock), and threads `open`/`onOpenChange` into each. The separator `<span className="h-6 w-px …">` that today sits before `CommentsToggle` in `page.tsx` moves inside the controller's render so the action bar grouping is preserved.

- [ ] **Step 4: Rewire `page.tsx`**

In `src/app/(app)/pages/[pageId]/page.tsx`, replace the block from the `<span … self-center bg-border>` separator through `{canEdit && <LockToggle …>}` (lines ~80–89) with a single `<PageActionPanels …>` passing the props. Leave `PageModeToggles`, `EncryptPageAction`, and `PageMenu` exactly where they are (they are not part of this cluster). Import the new component.

- [ ] **Step 5: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/pages/page-action-panels.test.tsx && pnpm vitest run tests/components/pages tests/components/comments && pnpm i18n:check && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS; build clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/pages/page-action-panels.tsx src/components/comments/comments-toggle.tsx src/components/pages/version-history.tsx src/components/pages/lock-toggle.tsx 'src/app/(app)/pages/[pageId]/page.tsx' tests/components/pages/page-action-panels.test.tsx
git commit -m "fix(page-actions): single-open-panel controller + shared Escape dismissal — Closes #93"
```

---

### Task 6: Suggestion toolbar — interactive "N open" badge + Mark insert/delete icons & tooltips (#98, #101)

> **COORDINATION:** This edits `src/components/editor/suggestion-toolbar.tsx` + a tiny `editor.tsx` callback — files also touched by **P13 #39** (styling/separators). Re-read both files at Step 1; preserve P13's separator/active-state markup. Change **interactivity only** here. See "Cross-plan coordination" at the top.

**Files:**
- Modify: `src/components/editor/suggestion-toolbar.tsx`
- Modify: `src/components/editor/editor.tsx` (add `onJumpToFirstOpen` callback + pass-through)
- Modify: `messages/{en,es,ar}.json`
- Test: `tests/components/editor/suggestion-toolbar.test.tsx` (create/extend)

**#98 behavior:** there is no separate "suggestions list" panel — open suggestions are inline `suggestionInsert`/`suggestionDelete` marks in the document, counted by `openCount` (fetched from `GET /api/pages/[pageId]/suggestions`). So "clicking opens/focuses the suggestions list" means: clicking the badge **scrolls to and focuses the first open suggestion mark in the document** (and, if the Outline/suggestions surface exists, opens it). Implement a `jumpToFirstOpenSuggestion()` in `editor.tsx` that finds the first element matching `[data-suggestion-id]` (or the mark's rendered class) in the editor DOM, calls `scrollIntoView`, and sets the ProseMirror selection there so keyboard focus follows — pass it to the toolbar as `onJumpToFirstOpen`.

- [ ] **Step 1: Re-read both files; write the failing test**

Read `suggestion-toolbar.tsx` and `editor.tsx` (current state, post-P13 if landed). Create `tests/components/editor/suggestion-toolbar.test.tsx`: render with `openCount={3}` and a spy `onJumpToFirstOpen`; assert the `N open` element is a `<button>` (role button) with an accessible name, and clicking it calls the spy. Render with `active` and assert `Mark insert`/`Mark delete` buttons have accessible labels (aria-label) and an icon child.

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/suggestion-toolbar.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Make the badge a button (#98)**

Add `onJumpToFirstOpen: () => void` to the `SuggestionToolbar` props. Change the `openCount > 0` chip from `<span>` to a `<button type="button">` that keeps the muted-pill styling P13 set (`rounded-full bg-muted px-2 py-0.5 …`) but adds `hover:bg-muted/80 focus-visible:ring-1 focus-visible:ring-ring` + `aria-label={t('pageActions.suggest.openCountLabel', { count: openCount })}` and `onClick={onJumpToFirstOpen}`. Use the i18n count plural for the label. Keep the visible text `{openCount} {t('pageActions.suggest.open')}` (or a single pluralized key).

- [ ] **Step 3: Add icons + tooltips + labels to Mark insert/delete (#101)**

Import `import { Plus, Minus } from 'lucide-react';` and the radix `Tooltip` (`import { Tooltip } from 'radix-ui';`). Wrap each Mark button in a `Tooltip.Root`/`Trigger`/`Content` (a single shared `Tooltip.Provider` can live at the toolbar root). Give each button `aria-label={t('pageActions.suggest.markInsert')}` / `markDelete` and a leading icon (`Plus` for insert, `Minus` for delete). Keep the existing `disabled={!editor || editor.state.selection.empty}` logic and the `text-xs hover:bg-accent` styling. Keep a visible text label too (icon + text) for the audit's "icons" requirement while remaining accessible — or, if space-constrained, icon-only with the tooltip + aria-label providing the name (both are AA-acceptable; prefer icon + text to match the rest of the strip). Ensure each is `min-h-9` minimum (the strip is dense; 36px is the established control height here — note the strip controls are intentionally compact, AA contrast still holds).

- [ ] **Step 4: Add the `editor.tsx` jump callback**

In `editor.tsx`, add `jumpToFirstOpenSuggestion` (memoized) that queries the editor DOM for the first open-suggestion mark and scrolls+selects it, then pass `onJumpToFirstOpen={jumpToFirstOpenSuggestion}` into `<SuggestionToolbar>`. **Do not** alter the surrounding strip separators / status pill / Outline button (P13 #39 territory).

- [ ] **Step 5: Add i18n strings**

```json
"pageActions.suggest.open": "open",
"pageActions.suggest.openCountLabel.one": "{count} open suggestion — jump to it",
"pageActions.suggest.openCountLabel.other": "{count} open suggestions — jump to the first",
"pageActions.suggest.markInsert": "Mark selection as inserted",
"pageActions.suggest.markDelete": "Mark selection as deleted"
```

(plus ES/AR). The `createT` helper supports `.one`/`.other` plural keys via `Intl.PluralRules` when `params.count` is a number — pass `{ count: openCount }`.

- [ ] **Step 6: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/editor/suggestion-toolbar.test.tsx && pnpm i18n:check && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS; build clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/suggestion-toolbar.tsx src/components/editor/editor.tsx messages/en.json messages/es.json messages/ar.json tests/components/editor/suggestion-toolbar.test.tsx
git commit -m "fix(editor): interactive open-suggestions badge + Mark insert/delete icons+tooltips — Closes #98 Closes #101

# touches suggestion-toolbar.tsx + editor.tsx — also edited by P13 #39 (strip styling); this PR changes interactivity only"
```

---

## Self-Review

- **Spec coverage:** #85, #86, #87 (Task 1) · #88, #89 (Task 2) · #90 (Task 3) · #91, #92, #94 (Task 4) · #93 (Task 5) · #98, #101 (Task 6). All twelve issues mapped. ✓
- **i18n gate:** every new/relabeled string lands in `messages/{en,es,ar}.json` under `pageActions.*` and is read via `useT()`; `pnpm i18n:check` runs in every task's verify step. The panels previously used hardcoded English — this is the first time they're internationalized, called out in each task. ✓
- **WCAG AA + 44px:** comments submit uses primary `bg-primary/text-primary-foreground` (AA both themes) at `min-h-11`; lock menu items `min-h-11`; export trigger/items `min-h-11`; suggestion-strip controls stay at the established compact 36px (the strip is intentionally dense — AA contrast preserved, noted as a deliberate exception). ✓
- **Escape handling accessible:** Task 5's single `keydown` listener dismisses the active panel; radix DropdownMenu (export) + radix Tooltip (suggest) bring their own AA-correct Escape/focus semantics; the controller's Escape is idempotent with radix's. ✓
- **Reuse:** radix `DropdownMenu`/`Tooltip` (already in `radix-ui` dep — exports verified), `Button`/`Select` primitives, `useT`, `cn()`. CopyButton not needed here (no copy affordance in this cluster) — noted so reviewers don't expect it. ✓
- **Cross-plan conflict (#39 vs #98/#101):** explicitly coordinated up top + in Task 6's banner + commit trailer; this plan changes interactivity, P13 changes strip styling — disjoint JSX concerns in the shared files. ✓
- **No unresolved placeholders:** each task says "re-read the file first / use the real state-variable names"; the snapshot route reads live content server-side (no client content payload), called out explicitly. ✓
