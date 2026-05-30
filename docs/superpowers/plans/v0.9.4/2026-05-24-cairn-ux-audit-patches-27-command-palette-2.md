# P27 — Command Palette Deepening (round 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the ⌘K command palette (`src/components/search-palette.tsx`) usable end-to-end: auto-focus the input on open (#109), rank matching Pages above Actions when there's a query (#110), highlight matched substrings in titles and snippets (#111), clarify the "Save this search" CTA and wire it to a real saved-searches surface with rename/delete (#112), render the remaining literal `Mod+…` hint sites as platform-aware glyphs (#113), and make a single Escape reliably dismiss the palette (#114).

**Architecture:** The palette is a cmdk `Command` rendered inside a hand-rolled fixed overlay (NOT cmdk's `Command.Dialog`); it gates render on a local `open` boolean (`if (!open) return null;`). It runs its own `keydown` listener for the ⌘K toggle (L103–112) but has **no** keyboard handling for focus or Escape — there is no `Command.Input` `autoFocus`, no `onKeyDown`, and no `Command.Dialog`/`onOpenChange`. Search results come from `/api/search?q=` (`SearchResult[]` with `title`, `snippet`, `breadcrumb`); the snippet already arrives as `ts_headline` markup with default `<b>…</b>` around matches and is injected via `dangerouslySetInnerHTML`, but the `<b>` is unstyled (no bold/color tokens) and the **title is plain text with no highlighting at all**. Render order in `Command.List` is fixed by JSX source order: Recent → Actions → Saved → results, so when the user types a query the page results always sit *below* every action (#110). The "Save this search" button (L267–277) is an ambiguous text-only CTA wired to `saveCurrent()` (a `window.prompt`-driven POST to `/api/search/saved`); a real per-user saved-searches sidebar section already exists at `src/components/sidebar/saved-searches.tsx` (delete-only; rename is marked "deferred polish") and the `PATCH /api/search/saved/[savedSearchId]` route already supports rename server-side.

The fixes:
1. **#109 focus-on-open:** add `autoFocus` to `Command.Input`. cmdk's `Command.Input` forwards `autoFocus` to the underlying `<input>`; because the palette mounts the input only when `open` flips true (the whole tree is gated by `if (!open) return null;`), the input mounts fresh on each open and `autoFocus` fires reliably. Add a defensive `useEffect` ref-focus as belt-and-suspenders for the case where the node is reused.
2. **#110 Pages-first ordering:** when `query.trim()` is non-empty, render a **Pages** group (the `/api/search` results) as the *first* group in `Command.List`, and suppress the Recent group (recents are a zero-query affordance). Actions still render (cmdk filters them by the typed query via the value strings) but **below** Pages. With no query, keep today's order (Recent → Actions → Saved).
3. **#111 highlighting:** add a small, dependency-free, XSS-safe `highlightMatch(text, query)` helper in `src/lib/palette/highlight.tsx` that splits `text` on case-insensitive query-token matches and returns React nodes with matched spans wrapped in `<mark>` (themed via tokens, not raw colors). Apply it to result **titles**. For **snippets**, keep the server `ts_headline` markup but style the injected `<b>` (scoped CSS via a wrapper class) so matches are visibly emphasized; do not double-highlight.
4. **#112 saved-searches clarity + surface:** relabel the CTA to an explicit, i18n-routed "Save this search to the sidebar" (with a bookmark icon), and after saving, toast a confirmation that points to the sidebar section. Upgrade the sidebar `SavedSearches` section to support **inline rename** (PATCH) in addition to delete (already present), with accessible controls. Replace the bare `window.prompt` name flow's UX copy via i18n.
5. **#113 literal `Mod+…`:** this is the **same root cause as #54 (P13/P12 `-13-command-palette.md`)**. P13 extracts a shared, SSR-safe `prettyKeys`/`shortcutFor` formatter into `src/lib/shortcuts/format.ts` and rewires the palette's two `<kbd>` action-hint sites to render registry-derived glyphs. **Do NOT re-implement the formatter here.** This plan only sweeps the *remaining* `Mod+…` literals that P13 does not touch (e.g. any hard-coded hint in the saved-searches surface, the empty-state, or a `Mod+K` reopen hint) and routes them through P13's `prettyKeys`. **Hard dependency: P13 must land first.**
6. **#114 single-Escape dismiss:** the palette has no Escape handler, so Escape only closes when the browser/cmdk happens to bubble it — unreliable, and inner key handling can swallow it. Add an explicit `onKeyDown` on the `Command` root (or `Command.Input`) that closes on `Escape` (`e.key === 'Escape'`), calling `e.preventDefault()`/`e.stopPropagation()` once so a single press always closes and never leaks to the page. Verify cmdk's own list-navigation `onKeyDown` does not `preventDefault` Escape (it doesn't — cmdk only intercepts arrows/Enter/Home/End), so a root-level handler is sufficient and non-conflicting.

**Tech Stack:** React 19, `cmdk`, Tailwind v4 (`@theme` tokens in `src/app/globals.css`, `cn()` from `src/lib/utils.ts`), flat-key JSON i18n catalogs in `messages/{en,es,ar}.json` resolved via `useT()` (`src/lib/i18n/provider.tsx`), saved-search API at `src/app/api/search/saved/`, shortcut formatter from `src/lib/shortcuts/format.ts` (introduced by P13).

**Covers:** GH #109 (no auto-focus), #110 (pages rank below actions), #111 (no match highlighting), #112 (unclear "Save this search" CTA + no rename), #113 (literal `Mod+…` hints — shares root cause with #54/P13), #114 (Escape unreliable).

**Depends on:** **P13 (`-13-command-palette.md`)** — Tasks 1+2 there create `src/lib/shortcuts/format.ts` (`prettyKeys`/`shortcutFor`) and remove the `actions.ts` `shortcutKey` literals. Task 5 below imports `prettyKeys` from that module and assumes the two action-hint `<kbd>` sites are already registry-driven. Do not start Task 5 until P13 is merged into this branch.

**Anchored identifiers (verified in-tree before writing this plan):**
- `src/components/search-palette.tsx`: `Command` root at L158–161 (`shouldFilter={false}`); `Command.Input` L162–167 (placeholder `t('palette.searchPlaceholder')`, **no** `autoFocus`/`onKeyDown`); `Command.List` L168; Recent group L169–195; Actions group L196–219; Saved group L220–233 (heading is the **raw string** `"Saved searches"`); loading/empty L234–240; results map L241–265 (title at L248 plain `{r.title}`; snippet at L257–263 via `dangerouslySetInnerHTML`); "Save this search" footer L267–277 (raw string `"Save this search"`); `saveCurrent()` L90–101 (uses `window.prompt('Name this saved search:', q)` — raw string); ⌘K toggle listener L103–112; `onSelect` closes via `setOpen(false)` L142–146. No `Command.Dialog`, no `onOpenChange`, no Escape handler anywhere.
- `src/lib/pages/search.ts` L92–97: snippet is `ts_headline('english', …)` with **default** `StartSel=<b>`/`StopSel=</b>` (no custom delimiters set), so matches arrive wrapped in `<b>`. The palette's `dangerouslySetInnerHTML` comment (search-palette.tsx L260) documents this as the accepted trust boundary.
- `src/components/sidebar/saved-searches.tsx`: per-user section; `remove(id, name)` does `confirm()` + `DELETE /api/search/saved/{id}` (L38–42); rename explicitly "deferred polish" (L16); raw strings `"Saved searches"` (L50), `Delete saved search "${name}"?` (L39), `aria-label={`Delete saved search ${s.name}`}` (L67).
- `PATCH /api/search/saved/[savedSearchId]` (`src/app/api/search/saved/[savedSearchId]/route.ts`) already accepts `{ name?, query?, filters? }` and is owner-scoped — rename needs **no** backend change.
- i18n: `palette.searchPlaceholder`/`palette.actions`/`palette.recent` exist in all three catalogs (en/es/ar L12–14) and are keyset-identical (`tests/lib/i18n/es-bundle.test.ts` parity gate). `palette.saved.*` keys do **not** exist yet.

---

### Task 1: Auto-focus the palette input on open (#109)

**Files:**
- Modify: `src/components/search-palette.tsx` (`Command.Input` ~L162–167)
- Test: `tests/components/search-palette-focus.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: vi.fn() } });
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

import { SearchPalette } from '@/components/search-palette';

afterEach(cleanup);

describe('SearchPalette focus', () => {
  it('focuses the search input when the palette opens', async () => {
    render(<SearchPalette currentUserId="u1" />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    const input = await screen.findByPlaceholderText('palette.searchPlaceholder');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-palette-focus.test.tsx`
Expected: FAIL — input mounts but is not the active element (no autoFocus today).

- [ ] **Step 3: Add `autoFocus` + a defensive ref-focus effect**

In `src/components/search-palette.tsx`, add a ref and focus effect, and pass `autoFocus` to `Command.Input`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
// …
  const inputRef = useRef<HTMLInputElement>(null);

  // #109: focus the input whenever the palette opens. autoFocus on
  // Command.Input handles the common (fresh-mount) path; this effect covers
  // the case where cmdk reuses the node across opens.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
```

Update the input:

```tsx
        <Command.Input
          ref={inputRef}
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={t('palette.searchPlaceholder')}
          className="w-full bg-transparent px-4 py-3 text-sm outline-hidden placeholder:text-muted-foreground"
        />
```

> `requestAnimationFrame` (not a bare `.focus()`) avoids racing the overlay's layout/portal insertion. cmdk forwards both `ref` and `autoFocus` to the inner `<input>`.

- [ ] **Step 4: Run the test, confirm green**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-palette-focus.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/search-palette.tsx tests/components/search-palette-focus.test.tsx
git commit -m "fix(palette): auto-focus the input on open — Closes #109"
```

---

### Task 2: Make single-Escape reliably dismiss the palette (#114)

**Files:**
- Modify: `src/components/search-palette.tsx` (add `onKeyDown` to `Command` root ~L158–161)
- Test: `tests/components/search-palette-escape.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: vi.fn() } });
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

import { SearchPalette } from '@/components/search-palette';

afterEach(cleanup);

describe('SearchPalette escape', () => {
  it('closes on a single Escape press', async () => {
    render(<SearchPalette currentUserId="u1" />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    const input = await screen.findByPlaceholderText('palette.searchPlaceholder');
    fireEvent.keyDown(input, { key: 'Escape' });
    // Palette unmounts (it returns null when closed): placeholder gone.
    expect(screen.queryByPlaceholderText('palette.searchPlaceholder')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-palette-escape.test.tsx`
Expected: FAIL — no Escape handler, palette stays mounted after one press.

- [ ] **Step 3: Add an Escape handler at the `Command` root**

In `src/components/search-palette.tsx`, add an `onKeyDown` to the `Command` root that closes on a single Escape and stops it leaking:

```tsx
      <Command
        className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
        shouldFilter={false}
        onKeyDown={(e) => {
          // #114: a single Escape always closes the palette. Stop here so the
          // key never bubbles to page-level handlers and can't be swallowed by
          // cmdk's list-nav handler (which ignores Escape) requiring a 2nd press.
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setQuery('');
          }
        }}
      >
```

> cmdk's internal `onKeyDown` only intercepts ArrowUp/Down/Home/End/Enter (never Escape), so a root-level handler does not conflict. Resetting `query` matches the existing `onSelect`/`saveCurrent` close behavior (a reopened palette starts empty).

- [ ] **Step 4: Run the test, confirm green**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-palette-escape.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/search-palette.tsx tests/components/search-palette-escape.test.tsx
git commit -m "fix(palette): single Escape reliably closes the palette — Closes #114"
```

---

### Task 3: Rank Pages above Actions when there is a query (#110)

**Files:**
- Modify: `src/components/search-palette.tsx` (reorder groups in `Command.List` ~L168–265)
- Test: `tests/components/search-palette-order.test.tsx`

- [ ] **Step 1: Write the failing test**

Stub `/api/search` so a known page result is present, type a query, and assert the **Pages** group heading renders before the **Actions** group heading in DOM order.

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: vi.fn() } });
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

import { SearchPalette } from '@/components/search-palette';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/search?q=')) {
        return {
          ok: true,
          json: async () => ({
            results: [{ id: 'p1', title: 'Roadmap notes', snippet: null, breadcrumb: [] }],
          }),
        } as Response;
      }
      // saved-searches GET
      return { ok: true, json: async () => ({ savedSearches: [] }) } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SearchPalette ordering', () => {
  it('renders the Pages group before the Actions group when querying', async () => {
    render(<SearchPalette currentUserId="u1" />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    const input = await screen.findByPlaceholderText('palette.searchPlaceholder');
    fireEvent.change(input, { target: { value: 'road' } });

    const pages = await screen.findByText('palette.pages');
    const actions = await screen.findByText('palette.actions');
    // Pages heading must come first in document order.
    expect(pages.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
```

> Add the `palette.pages` key in Task 6 (i18n). If running this test before Task 6, temporarily assert on the literal heading text; the canonical version asserts on the routed key.

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-palette-order.test.tsx`
Expected: FAIL — today results render after Actions (and there is no Pages group heading).

- [ ] **Step 3: Reorder the list — Pages first when querying**

In `src/components/search-palette.tsx`, restructure `Command.List` so a `query.trim()` introduces a **Pages** group placed *first*, and the Recent group is suppressed while querying. Derive a `hasQuery` boolean once:

```tsx
  const hasQuery = query.trim().length > 0;
```

Then in `Command.List`:
- Wrap the existing `recentIds.length > 0 && (…)` Recent group with `!hasQuery && recentIds.length > 0 && (…)` so recents only show on the empty palette.
- Move the results map (L241–265) into a `Command.Group heading={t('palette.pages')}` and render it **first** (before the Actions group), gated on `hasQuery && results.length > 0`.
- Leave the Actions group (L196–219) where it is — it now renders *after* Pages. cmdk filters action rows by their `value` strings against the typed query (`shouldFilter={false}` means the palette currently does no filtering; do not change that — Actions remain visible and the user can still arrow to them, but Pages lead).
- Keep loading/empty states and the Saved group as-is (Saved stays after Actions).

The Pages group:

```tsx
          {hasQuery && results.length > 0 && (
            <Command.Group heading={t('palette.pages')}>
              {results.map((r) => (
                <Command.Item
                  key={r.id}
                  value={r.id}
                  onSelect={() => onSelect(r.id)}
                  className="cursor-pointer px-4 py-2 text-sm aria-selected:bg-accent"
                >
                  {/* title + breadcrumb + snippet — see Task 4 for highlighting */}
                </Command.Item>
              ))}
            </Command.Group>
          )}
```

> Net effect: with a query, the user sees `Pages` → `Actions` → (`Saved`). With no query, `Recent` → `Actions` → `Saved` (unchanged). Move the loading/empty markers to render alongside the Pages group region so "Searching…"/empty-state still appear in the right place.

- [ ] **Step 4: Run the test, confirm green**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-palette-order.test.tsx`
Expected: PASS (after Task 6 adds `palette.pages`; if running standalone first, temporarily assert literal text per the Step 1 note).

- [ ] **Step 5: Commit**

```bash
git add src/components/search-palette.tsx tests/components/search-palette-order.test.tsx
git commit -m "fix(palette): rank matching pages above actions when querying — Closes #110"
```

---

### Task 4: Highlight matched substrings in titles + snippets (#111)

**Files:**
- Create: `src/lib/palette/highlight.tsx`
- Modify: `src/components/search-palette.tsx` (result title + snippet rendering)
- Modify: `src/app/globals.css` (style the injected `<b>` inside `.palette-snippet`, if a token-based `<mark>`/`<b>` style isn't already present)
- Test: `tests/lib/palette/highlight.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { highlightMatch } from '@/lib/palette/highlight';

afterEach(cleanup);

describe('highlightMatch', () => {
  it('wraps each case-insensitive match in a <mark>', () => {
    render(<span>{highlightMatch('Roadmap roadwork', 'road')}</span>);
    const marks = screen.getAllByText(/road/i, { selector: 'mark' });
    expect(marks).toHaveLength(2);
  });

  it('returns the text unchanged when query is empty', () => {
    render(<span data-testid="t">{highlightMatch('Plain title', '')}</span>);
    expect(screen.getByTestId('t').querySelector('mark')).toBeNull();
    expect(screen.getByTestId('t').textContent).toBe('Plain title');
  });

  it('does not treat query as a regex (escapes special chars)', () => {
    render(<span data-testid="t">{highlightMatch('a.b.c', '.')}</span>);
    // Only the literal dots match, not every char.
    expect(screen.getByTestId('t').querySelectorAll('mark')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/palette/highlight.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the highlighter (XSS-safe, no regex injection)**

Create `src/lib/palette/highlight.tsx`:

```tsx
import * as React from 'react';

/** Escape regex metacharacters so the query is matched literally. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split `text` on case-insensitive occurrences of `query` and wrap each match
 * in a themed <mark>. Returns plain React nodes (no dangerouslySetInnerHTML),
 * so user/query input is never interpreted as HTML.
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const re = new RegExp(`(${escapeRegExp(q)})`, 'gi');
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part) && part.toLowerCase() === q.toLowerCase() ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split output is positional and stable per render
      <mark key={i} className="rounded-[2px] bg-transparent font-semibold text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
```

> Matching strategy note: `String.split` with a capturing group yields alternating non-match/match segments; comparing `part.toLowerCase() === q.toLowerCase()` reliably identifies the captured matches (avoids `re.test` lastIndex state pitfalls — if the reviewer prefers, use `String.matchAll` to build segments). The `<mark>` uses theme tokens only (`text-foreground` + `font-semibold`, transparent bg) so it reads correctly in light/dark and meets WCAG AA contrast against `bg-popover`; it does **not** rely on the browser default yellow `<mark>` background (which fails dark-mode contrast).

- [ ] **Step 4: Apply highlighting to result titles + snippets**

In `src/components/search-palette.tsx`, import the helper and use it for the title:

```tsx
import { highlightMatch } from '@/lib/palette/highlight';
// …
                  <div className="font-medium">{highlightMatch(r.title, query)}</div>
```

For the **snippet**, the server `ts_headline` already wraps matches in `<b>`; keep the `dangerouslySetInnerHTML` (it's the documented sanitized trust boundary, search-palette.tsx L260) but add a wrapper class so the `<b>` is visibly emphasized:

```tsx
                {r.snippet && (
                  <div
                    className="palette-snippet mt-1 text-xs text-muted-foreground"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: ts_headline returns sanitized <b> markup; accepted trust boundary
                    dangerouslySetInnerHTML={{ __html: r.snippet }}
                  />
                )}
```

In `src/app/globals.css`, add a scoped rule so the injected `<b>` uses theme tokens (grep first — if a global `b`/`mark` emphasis already covers this, skip):

```css
.palette-snippet b {
  font-weight: 600;
  color: var(--color-foreground);
}
```

> Do not run `highlightMatch` over the snippet text — that would double-process the `<b>` markup. Titles use the React highlighter (no HTML); snippets use the server markup styled via CSS. Both end up visibly emphasized using the same token.

- [ ] **Step 5: Run the tests, confirm green**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/palette/highlight.test.tsx tests/components/search-palette-order.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify lint/types**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean (Biome may reorder the import; accept it).

- [ ] **Step 7: Commit**

```bash
git add src/lib/palette/highlight.tsx src/components/search-palette.tsx src/app/globals.css tests/lib/palette/highlight.test.tsx
git commit -m "fix(palette): highlight matched substrings in titles and snippets — Closes #111"
```

---

### Task 5: Sweep remaining literal `Mod+…` hints through P13's formatter (#113)

> **BLOCKED ON P13.** Do not start until `-13-command-palette.md` is merged into this branch (it creates `src/lib/shortcuts/format.ts` with `prettyKeys`/`shortcutFor` and makes the two action-hint `<kbd>` sites registry-driven). This task only covers the **remaining** `Mod+…` literals P13 does not touch.

**Files:**
- Modify: `src/components/search-palette.tsx` and/or `src/components/sidebar/saved-searches.tsx` (whichever still render a literal `Mod+…`)
- Test: extend `tests/components/search-palette-shortcuts.test.tsx` (P13's file) or a new `*-mod-sweep.test.tsx`

- [ ] **Step 1: Confirm P13 landed + inventory the remaining literals**

```bash
source ~/.zshenv && cd /Users/jon/projects/cairn
test -f src/lib/shortcuts/format.ts && echo "P13 present" || echo "STOP: P13 not merged"
grep -rn "Mod+" src/components/search-palette.tsx src/components/sidebar/saved-searches.tsx
grep -rn "Mod+" src/components/ src/app | grep -iv test | grep -iv "registry\|app-shortcuts\|format.ts"
```

> P13 removes the `actions.ts` `shortcutKey` literals and the palette's two `<kbd>` blocks now call `prettyKeys(shortcutFor(a.id))`. Anything the grep still surfaces (e.g. a hard-coded "Mod+K" reopen hint, a saved-searches keyboard hint, or an empty-state "press Mod+K" line) is the residue this task fixes. If the grep returns nothing outside the registry/format/app-shortcuts files, there is **no residual literal** — record that in the PR, close #113 as "resolved by #54/P13", and skip to the commit with an empty/no-op note.

- [ ] **Step 2: Route each remaining literal through `prettyKeys`**

For every residual site, import and apply the **shared** formatter — do NOT re-implement platform detection:

```tsx
import { prettyKeys } from '@/lib/shortcuts/format';
// render: <kbd className="text-xs text-muted-foreground">{prettyKeys('Mod+K')}</kbd>
```

If the literal corresponds to a registered binding id, prefer `prettyKeys(shortcutFor(id) ?? 'Mod+…')`. For ⌘K specifically (the palette-reopen hint) there is **no** registry entry (it's the inline `keydown` listener), so pass the literal `'Mod+K'` to `prettyKeys` directly — this is acceptable and matches P13's documented `search.open` note; do not invent a registry entry here.

- [ ] **Step 3: Add/extend a platform-aware assertion**

Add a test (jsdom, `vi.stubGlobal('navigator', { platform: 'MacIntel' })`) asserting the residual site renders the glyph form (e.g. `screen.getByText('⌘K')`) and that no literal `Mod+` text remains: `expect(container.textContent).not.toContain('Mod+')`.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-palette-shortcuts.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(palette): route remaining Mod+ hints through shared prettyKeys — Closes #113 (refs #54)"
```

---

### Task 6: Clarify the "Save this search" CTA + add i18n strings (#112, part 1)

**Files:**
- Modify: `src/components/search-palette.tsx` (CTA footer L267–277; Saved group heading L221; `saveCurrent()` confirmation)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json` (new `palette.*` + `savedSearches.*` keys)
- Test: `tests/lib/i18n/es-bundle.test.ts` (parity — keep passing); `tests/components/search-palette-saved.test.tsx`

- [ ] **Step 1: Add the i18n keys to all three catalogs (keysets must stay identical)**

Add these keys (insert near the existing `palette.*` block, alphabetical with the surrounding keys; preserve the `…` ellipsis glyph U+2026):

`messages/en.json`:
```json
  "palette.pages": "Pages",
  "palette.saveSearch": "Save this search to the sidebar",
  "palette.saveSearch.namePrompt": "Name this saved search",
  "palette.saveSearch.saved": "Saved. Find it under \"Saved searches\" in the sidebar.",
  "palette.saved.heading": "Saved searches",
```

`messages/es.json`:
```json
  "palette.pages": "Páginas",
  "palette.saveSearch": "Guardar esta búsqueda en la barra lateral",
  "palette.saveSearch.namePrompt": "Nombra esta búsqueda guardada",
  "palette.saveSearch.saved": "Guardada. Encuéntrala en «Búsquedas guardadas» en la barra lateral.",
  "palette.saved.heading": "Búsquedas guardadas",
```

`messages/ar.json`:
```json
  "palette.pages": "الصفحات",
  "palette.saveSearch": "احفظ هذا البحث في الشريط الجانبي",
  "palette.saveSearch.namePrompt": "سمِّ هذا البحث المحفوظ",
  "palette.saveSearch.saved": "تم الحفظ. ستجده ضمن «عمليات البحث المحفوظة» في الشريط الجانبي.",
  "palette.saved.heading": "عمليات البحث المحفوظة",
```

> Match each catalog's existing key ordering convention (the parity test only checks the keyset, not order, but keep it tidy). Confirm with `source ~/.zshenv && grep -n "palette.saveSearch\|palette.pages\|palette.saved.heading" messages/*.json` — each must appear in all three.

- [ ] **Step 2: Rewire the CTA, Saved heading, and save flow to the keys**

In `src/components/search-palette.tsx`:
- Replace the Saved group heading `heading="Saved searches"` (L221) with `heading={t('palette.saved.heading')}`.
- Replace the footer button text `Save this search` (L274) with `{t('palette.saveSearch')}` and add a leading `Bookmark` icon (`lucide-react`) so the CTA reads as a save affordance. Ensure the button keeps a ≥44px touch target: `className="flex min-h-11 items-center gap-2 px-2 text-xs text-muted-foreground hover:text-foreground"` (and add an `aria-label={t('palette.saveSearch')}`).
- In `saveCurrent()` (L90–101): replace `window.prompt('Name this saved search:', q)` with `window.prompt(t('palette.saveSearch.namePrompt'), q)` and, on success (`r.ok`), call `toast(t('palette.saveSearch.saved'))` so the user learns where it went. `toast` is already imported (sonner) and `t` is in scope.

> The CTA now says exactly where the search goes ("to the sidebar"), and the success toast points to the sidebar section — closing the "unclear CTA" gap (#112). The footer only renders when `query.trim().length > 0` (unchanged).

- [ ] **Step 3: Write/extend the test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: vi.fn() } });
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

import { SearchPalette } from '@/components/search-palette';

afterEach(cleanup);

describe('SearchPalette save CTA', () => {
  it('shows the clarified save-to-sidebar CTA once a query is typed', async () => {
    render(<SearchPalette currentUserId="u1" />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    const input = await screen.findByPlaceholderText('palette.searchPlaceholder');
    fireEvent.change(input, { target: { value: 'budget' } });
    expect(screen.getByText('palette.saveSearch')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Verify parity + gate**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/i18n tests/scripts/i18n-audit.test.ts tests/components/search-palette-saved.test.tsx`
Expected: PASS — es-bundle parity holds (all new keys present in en/es/ar); i18n-audit finds no new raw-string literals in the touched JSX (the CTA/heading are now `t()`-routed).

- [ ] **Step 5: Commit**

```bash
git add src/components/search-palette.tsx messages/en.json messages/es.json messages/ar.json tests/components/search-palette-saved.test.tsx
git commit -m "fix(palette): clarify Save-this-search CTA + i18n + saved-to-sidebar toast — refs #112"
```

---

### Task 7: Add inline rename to the saved-searches sidebar surface (#112, part 2)

**Files:**
- Modify: `src/components/sidebar/saved-searches.tsx` (add rename via the existing `PATCH /api/search/saved/{id}`)
- Modify: `messages/{en,es,ar}.json` (rename-control labels)
- Test: `tests/components/sidebar/saved-searches.test.tsx`

- [ ] **Step 1: Add the i18n labels to all three catalogs**

`en`: `"savedSearches.rename": "Rename"`, `"savedSearches.renameLabel": "Rename saved search {name}"`, `"savedSearches.deleteLabel": "Delete saved search {name}"`, `"savedSearches.confirmDelete": "Delete saved search \"{name}\"?"`, `"savedSearches.heading": "Saved searches"`, `"savedSearches.save": "Save"`, `"savedSearches.cancel": "Cancel"`.
`es`: `"savedSearches.rename": "Renombrar"`, `"savedSearches.renameLabel": "Renombrar búsqueda guardada {name}"`, `"savedSearches.deleteLabel": "Eliminar búsqueda guardada {name}"`, `"savedSearches.confirmDelete": "¿Eliminar la búsqueda guardada «{name}»?"`, `"savedSearches.heading": "Búsquedas guardadas"`, `"savedSearches.save": "Guardar"`, `"savedSearches.cancel": "Cancelar"`.
`ar`: `"savedSearches.rename": "إعادة تسمية"`, `"savedSearches.renameLabel": "إعادة تسمية البحث المحفوظ {name}"`, `"savedSearches.deleteLabel": "حذف البحث المحفوظ {name}"`, `"savedSearches.confirmDelete": "حذف البحث المحفوظ «{name}»؟"`, `"savedSearches.heading": "عمليات البحث المحفوظة"`, `"savedSearches.save": "حفظ"`, `"savedSearches.cancel": "إلغاء"`.

> `SavedSearches` is `'use client'` and currently uses raw strings; route them through `useT()` (`import { useT } from '@/lib/i18n/provider'`). For `{name}` interpolation use the catalog's existing pattern — check how other components interpolate (`grep -rn "{name}\|replace(" src/lib/i18n src/components | head`); if `t()` supports a params arg use it, else do a `.replace('{name}', name)` consistent with current usage in the file's siblings.

- [ ] **Step 2: Implement inline rename**

In `src/components/sidebar/saved-searches.tsx`:
- Track an `editingId: string | null` and a `draftName` in state.
- Render a small **Rename** icon button (`Pencil` from `lucide-react`) next to the existing delete `×`; clicking it enters edit mode (swap the `<a>` label for an `<input>` bound to `draftName`, plus Save/Cancel controls or Enter-to-save / Escape-to-cancel).
- On save: `PATCH /api/search/saved/{id}` with `{ name: draftName.trim() }`; on `r.ok`, update local `items` (`setItems(xs => xs.map(x => x.id === id ? { ...x, name: draftName.trim() } : x))`) and exit edit mode. Ignore empty names.
- Accessibility: every control has an `aria-label` from the i18n keys (`savedSearches.renameLabel`/`deleteLabel` with `{name}`), the inline input has an associated label or `aria-label={t('savedSearches.rename')}`, and all buttons/inputs are ≥44px touch targets (`min-h-11` / adequate padding) per WCAG AA. Keep the section's existing `aria-label` on `<section>` but route it via `t('savedSearches.heading')`.
- Replace the existing `confirm()` string and delete `aria-label` with the new i18n keys.

- [ ] **Step 3: Write the test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

import { SavedSearches } from '@/components/sidebar/saved-searches';

const patch = vi.fn();
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patch(url, init);
        return { ok: true, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        json: async () => ({ savedSearches: [{ id: 's1', name: 'Old', query: 'q', filters: {} }] }),
      } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SavedSearches rename', () => {
  it('renames via PATCH and updates the row', async () => {
    render(<SavedSearches />);
    const renameBtn = await screen.findByLabelText('savedSearches.renameLabel');
    fireEvent.click(renameBtn);
    const input = screen.getByDisplayValue('Old');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/search/saved/s1', expect.anything()));
    expect(await screen.findByText('New name')).toBeTruthy();
  });
});
```

> If `useT()` does not interpolate `{name}`, the `findByLabelText('savedSearches.renameLabel')` matcher will hit the unrendered template key (the mock returns the key verbatim) — adjust the matcher to whatever the component actually renders, but keep the rename→PATCH→row-update assertion intact.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/sidebar/saved-searches.test.tsx tests/lib/i18n tests/scripts/i18n-audit.test.ts && pnpm lint && pnpm typecheck`
Expected: PASS — parity holds, no new raw strings, rename works.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/saved-searches.tsx messages/en.json messages/es.json messages/ar.json tests/components/sidebar/saved-searches.test.tsx
git commit -m "fix(sidebar): inline rename for saved searches + i18n labels — Closes #112"
```

---

### Task 8: Full gate + build

**Files:** none (verification only)

- [ ] **Step 1: Run the full verification gate**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm vitest run tests/lib/palette tests/components/search-palette-focus.test.tsx tests/components/search-palette-escape.test.tsx tests/components/search-palette-order.test.tsx tests/components/search-palette-saved.test.tsx tests/components/sidebar/saved-searches.test.tsx tests/lib/i18n tests/scripts/i18n-audit.test.ts && pnpm build`
Expected: lint/types clean; all targeted tests pass; build succeeds (UI change → build gate per CLAUDE.md).

> If P13's `tests/components/search-palette-shortcuts.test.tsx` exists in-branch, include it in the run to confirm Task 5 didn't regress the action-hint glyphs.

---

## Self-Review

- Spec coverage: #109 (autoFocus + rAF ref-focus, Task 1), #114 (root `onKeyDown` single-Escape, Task 2), #110 (Pages group rendered first when querying; Recent suppressed, Task 3), #111 (React `highlightMatch` on titles + token-styled `ts_headline` `<b>` on snippets, Task 4), #113 (residual `Mod+…` literals routed through P13's shared `prettyKeys`/`shortcutFor`, Task 5), #112 (clarified save-to-sidebar CTA + toast + inline rename via existing PATCH, Tasks 6–7). ✓
- **P13 dependency for #113 is explicit and blocking** — Task 5 verifies `src/lib/shortcuts/format.ts` exists before proceeding and does NOT re-implement platform detection (reuses P13's SSR-safe `prettyKeys`). ✓
- i18n parity: all new strings (`palette.pages`, `palette.saveSearch*`, `palette.saved.heading`, `savedSearches.*`) added to en/es/ar with identical keysets; CTA/headings/prompts/aria-labels are `t()`-routed so the i18n-audit gate stays clean; `…` ellipsis glyph preserved. ✓
- WCAG AA + 44px: `<mark>`/snippet `<b>` use theme tokens (not browser-default yellow) for dark-mode contrast; the Save CTA and the rename/delete sidebar controls carry `min-h-11` touch targets and `aria-label`s. ✓
- SSR-safe platform detection: delegated entirely to P13's `isMac()`/`prettyKeys` (guards `typeof navigator === 'undefined'`); this plan adds no new platform check. ✓
- XSS safety: title highlighting uses React nodes (no `dangerouslySetInnerHTML`); the query is regex-escaped before use; snippet HTML stays within the existing documented `ts_headline` trust boundary. ✓
- No backend change needed for rename — `PATCH /api/search/saved/[savedSearchId]` already accepts `{ name }` and is owner-scoped. ✓
- Commit hygiene: one commit per task; `Closes #109/#114/#110/#111/#112`, `Closes #113 (refs #54)`; Task 8 is verification-only. ✓
