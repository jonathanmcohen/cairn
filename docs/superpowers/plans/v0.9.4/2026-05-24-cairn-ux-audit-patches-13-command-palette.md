# P13 — Command Palette Shortcut Hints & Placeholder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the ⌘K command palette (`src/components/search-palette.tsx`) present keyboard-shortcut hints correctly and consistently: (1) render platform-aware glyphs instead of the literal `Mod+Shift+F` string, (2) show a hint on *every* action that has a registered binding (not just one), and (3) widen the input placeholder so it reflects that the palette searches both pages and actions.

**Architecture:** The palette already reads its action catalog from `buildPaletteActions()` in `src/lib/palette/actions.ts`, where each entry optionally carries a free-text `shortcutKey` (e.g. the literal `'Mod+Shift+F'`). Separately, the v0.6 P15 shortcut registry (`src/lib/shortcuts/registry.ts`) is the real source of truth for bindings — each `ShortcutEntry` has an `id` and a canonical `keys` string (e.g. `'Mod+Shift+F'`), registered in `src/components/shortcuts/app-shortcuts.ts`. The shortcuts sheet (`src/components/shortcuts/sheet.tsx`) already owns a platform-aware formatter, `prettyKeys()`, that maps `Mod`/`Shift`/`Alt` to `⌘`/`⇧`/`⌥` on macOS and `Ctrl`/`Shift`/`Alt` elsewhere, and is SSR-safe (it guards `typeof navigator === 'undefined'` via its `isMac()` helper).

The right fix is to stop duplicating shortcut strings in two places. We:
1. Extract `prettyKeys` + `isMac` into a shared, dependency-free module `src/lib/shortcuts/format.ts` (no React import — usable from both the sheet and the palette), keep `sheet.tsx` re-exporting/consuming it (no behavior change there), and add a tiny `shortcutFor(id)` lookup that returns a registered entry's `keys` by `id`.
2. In the palette, derive each action row's hint from the registry by the action's `id` (`shortcutFor(a.id)`), formatted through `prettyKeys()` — so the literal `shortcutKey` text in `actions.ts` is no longer rendered, every action whose `id` matches a registered binding shows a hint, and the rendering is platform-aware automatically. The now-unused `shortcutKey` literals are removed from `actions.ts` to kill the second source of truth.
3. Broaden `palette.searchPlaceholder` from `"Search pages…"` to `"Search pages and actions…"` across all three message catalogs (en/es/ar — they are keyset-identical and a parity test enforces it).

**Tech Stack:** React 19, `cmdk`, flat-key JSON i18n catalogs in `messages/{en,es,ar}.json` resolved via `useT()` (`src/lib/i18n/provider.tsx`), `prettyKeys`/registry helpers in `src/lib/shortcuts/` + `src/components/shortcuts/`.

**Covers:** GH #54 (literal `Mod+Shift+F` → platform-aware label), #55 (only one action shows a hint → all registered actions show hints), #56 (placeholder understates scope).

**Anchored identifiers (verified in-tree before writing this plan):**
- `prettyKeys(keys: string)` and `isMac()` live in `src/components/shortcuts/sheet.tsx` (L13–32). `isMac` already guards `typeof navigator === 'undefined'`.
- Registry API in `src/lib/shortcuts/registry.ts`: `getShortcuts(scope?)`, `ShortcutEntry { id, keys, scope, kind, labelKey, run }`, `normalizeKeys()`.
- Bindings registered in `src/components/shortcuts/app-shortcuts.ts`: `page.new`→`Mod+N`, `theme.toggle`→`Mod+Shift+L`, `workspace.switch`→`Mod+Shift+O`, `nav.favorites`→`Mod+Shift+F`, `shortcuts.sheet`→`Mod+/`, `app.quickCapture`→`Mod+Shift+N`.
- Palette action ids that have matching registry bindings: `nav.favorites`, `page.new`, `theme.toggle`, `workspace.switch` (and `search.open`→`Mod+K`, which has *no* registry entry — see Task 3 note). The palette renders `a.shortcutKey` inside a `<kbd>` at L188–190 (Recent group) and L211–214 (Actions group).
- Placeholder key: `palette.searchPlaceholder` = `"Search pages…"` in all of `messages/{en,es,ar}.json`. Keysets across the three catalogs are identical; `tests/lib/i18n/es-bundle.test.ts` enforces parity.

---

### Task 1: Extract a shared, SSR-safe shortcut-format module + `shortcutFor` lookup

**Files:**
- Create: `src/lib/shortcuts/format.ts`
- Modify: `src/components/shortcuts/sheet.tsx` (consume the shared `prettyKeys`, drop the local copy)
- Test: `tests/lib/shortcuts/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prettyKeys, shortcutFor } from '@/lib/shortcuts/format';
import { registerShortcut, resetRegistry } from '@/lib/shortcuts/registry';

afterEach(() => {
  resetRegistry();
  vi.unstubAllGlobals();
});

function stubPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform });
}

describe('prettyKeys', () => {
  it('renders macOS glyphs with no separator', () => {
    stubPlatform('MacIntel');
    expect(prettyKeys('Mod+Shift+F')).toBe('⌘⇧F');
  });

  it('renders win/linux labels joined by +', () => {
    stubPlatform('Win32');
    expect(prettyKeys('Mod+Shift+F')).toBe('Ctrl+Shift+F');
  });
});

describe('shortcutFor', () => {
  it('returns the registered keys for a known id, undefined otherwise', () => {
    registerShortcut({
      id: 'nav.favorites',
      keys: 'Mod+Shift+F',
      scope: 'global',
      kind: 'action',
      labelKey: 'shortcut.openFavorites',
      run: () => {},
    });
    expect(shortcutFor('nav.favorites')).toBe('Mod+Shift+F');
    expect(shortcutFor('does.not.exist')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/shortcuts/format.test.ts`
Expected: FAIL — module `@/lib/shortcuts/format` not found.

- [ ] **Step 3: Implement the shared module**

Create `src/lib/shortcuts/format.ts`. Move `isMac` + `prettyKeys` verbatim from `sheet.tsx` (they are already SSR-safe), and add `shortcutFor` which reads the registry by id. Keep it React-free so it can be imported from any client component without pulling in JSX.

```ts
import { getShortcuts } from './registry';

/**
 * SSR-safe platform check. Guards `navigator` so it returns false during
 * server render (the palette/sheet are client-only, but the import graph is
 * shared and must not throw on the server).
 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  // navigator.platform is deprecated but still the most reliable mac signal in
  // browsers; fall back to userAgent for engines that have emptied platform.
  const platform = navigator.platform || '';
  if (platform) return /Mac|iPhone|iPad|iPod/i.test(platform);
  const ua = navigator.userAgent || '';
  return /Mac|iPhone|iPad|iPod/i.test(ua);
}

/**
 * Render a registry `keys` string (e.g. "Mod+Shift+F") for display.
 * macOS: glyphs with no separator (⌘⇧F). Other platforms: Ctrl+Shift+F.
 */
export function prettyKeys(keys: string): string {
  const mac = isMac();
  const parts = keys
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const rendered = parts.map((part) => {
    const lower = part.toLowerCase();
    if (lower === 'mod') return mac ? '⌘' : 'Ctrl';
    if (lower === 'shift') return mac ? '⇧' : 'Shift';
    if (lower === 'alt') return mac ? '⌥' : 'Alt';
    return part.toUpperCase();
  });
  return mac ? rendered.join('') : rendered.join('+');
}

/** The registered `keys` for a shortcut id, or undefined if none is bound. */
export function shortcutFor(id: string): string | undefined {
  return getShortcuts().find((s) => s.id === id)?.keys;
}
```

> Note: this matches the existing `isMac`/`prettyKeys` behavior exactly, plus a `userAgent` fallback (the audit issue #54 mentions userAgent detection; modern Chromium still populates `navigator.platform`, so platform is the primary signal and userAgent is the fallback).

- [ ] **Step 4: Point `sheet.tsx` at the shared module (no behavior change)**

In `src/components/shortcuts/sheet.tsx`, delete the local `isMac` (L13–16) and `prettyKeys` (L18–32) definitions and import the shared one:

```tsx
import { prettyKeys } from '@/lib/shortcuts/format';
```

Leave the rest of `sheet.tsx` untouched — it already calls `prettyKeys(s.keys)` at the `<kbd>` (L82–84). If `prettyKeys` was previously exported from `sheet.tsx` and imported elsewhere, grep first: `source ~/.zshenv && grep -rn "from '@/components/shortcuts/sheet'" src` — re-point any such import to `@/lib/shortcuts/format`. (As of writing, `prettyKeys` is only consumed inside `sheet.tsx`.)

- [ ] **Step 5: Run the test + the shortcut-sheet tests, confirm green**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/shortcuts/format.test.ts tests/components/shortcuts`
Expected: PASS (the sheet's existing tests still pass against the re-exported `prettyKeys`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/shortcuts/format.ts src/components/shortcuts/sheet.tsx tests/lib/shortcuts/format.test.ts
git commit -m "refactor(shortcuts): extract SSR-safe prettyKeys + shortcutFor lookup"
```

> This task has no `Closes` trailer — it is the enabling refactor. Issues #54/#55/#56 are closed by Tasks 2 and 3.

---

### Task 2: Render platform-aware hints from the registry on every action (#54, #55)

**Files:**
- Modify: `src/components/search-palette.tsx` (the two `<kbd>` blocks: Recent group ~L188–190, Actions group ~L211–214)
- Modify: `src/lib/palette/actions.ts` (drop the now-redundant `shortcutKey` literals + the field on the type)
- Test: `tests/components/search-palette-shortcuts.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stub macOS so we assert on the glyph form.
vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: vi.fn() } });

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

import { SearchPalette } from '@/components/search-palette';

afterEach(cleanup);

async function openPalette() {
  render(<SearchPalette currentUserId="u1" />);
  // The palette is hidden until ⌘K; dispatch it.
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  // Let the effects (ensureAppShortcuts + buildPaletteActions) settle.
  await screen.findByText('palette.actions');
}

describe('SearchPalette shortcut hints', () => {
  it('renders the favorites action hint as a platform-aware glyph, not the literal Mod+Shift+F', async () => {
    await openPalette();
    // #54: no literal "Mod+Shift+F" anywhere.
    expect(screen.queryByText('Mod+Shift+F')).toBeNull();
    // …rendered as the macOS glyph form instead.
    expect(screen.getByText('⌘⇧F')).toBeTruthy();
  });

  it('shows hints for MULTIPLE registered actions (not just one)', async () => {
    await openPalette();
    // #55: page.new (Mod+N), theme.toggle (Mod+Shift+L), workspace.switch (Mod+Shift+O)
    // all have registry bindings and must each render a hint.
    expect(screen.getByText('⌘N')).toBeTruthy();
    expect(screen.getByText('⌘⇧L')).toBeTruthy();
    expect(screen.getByText('⌘⇧O')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-palette-shortcuts.test.tsx`
Expected: FAIL — currently only `nav.favorites` renders (and it renders the literal `Mod+Shift+F`, so `getByText('⌘⇧F')` fails and `queryByText('Mod+Shift+F')` is non-null).

> If `await screen.findByText('palette.actions')` times out, the `useEffect` that builds actions depends on `ensureAppShortcuts()` having registered bindings — that runs in the same effect, so it should be fine. If the test environment never opens the palette, confirm the ⌘K `keydown` listener (search-palette.tsx L103–112) is attached before dispatch (it is, on mount).

- [ ] **Step 3: Render hints from the registry**

In `src/components/search-palette.tsx`, add the import:

```tsx
import { prettyKeys, shortcutFor } from '@/lib/shortcuts/format';
```

Replace **both** `<kbd>` blocks (Recent group and Actions group) — they currently read `a.shortcutKey`:

```tsx
                      {a.shortcutKey ? (
                        <kbd className="text-xs text-muted-foreground">{a.shortcutKey}</kbd>
                      ) : null}
```

with a registry-derived, platform-aware hint:

```tsx
                      {(() => {
                        const keys = shortcutFor(a.id);
                        return keys ? (
                          <kbd className="text-xs text-muted-foreground">{prettyKeys(keys)}</kbd>
                        ) : null;
                      })()}
```

Apply the identical replacement at both call sites (Recent ~L188–190 and Actions ~L211–214). The lookup is keyed on `a.id`, so every action whose id matches a registered binding gets a consistent hint (#55), rendered platform-aware (#54).

- [ ] **Step 4: Remove the dead `shortcutKey` source of truth from `actions.ts`**

In `src/lib/palette/actions.ts`:
- Delete the `shortcutKey?: string;` field (and its doc comment, L33–34) from the `PaletteAction` type.
- Delete every `shortcutKey: '…'` line from the action objects (`nav.favorites` L70, `page.new` L106, `search.open` L112, `theme.toggle` L122, `workspace.switch` L131).

> `search.open` had `shortcutKey: 'Mod+K'` but there is **no** registry entry for it (⌘K is handled by the inline `keydown` listener in `search-palette.tsx`, not the registry). After this change `search.open` shows no hint in the palette. That is acceptable and consistent — the palette is already open, so a "⌘K" hint on its own "Search" row was noise. If product wants it shown, the correct fix is to register `search.open`→`Mod+K` in `app-shortcuts.ts`; do NOT re-introduce a literal `shortcutKey`. Note this in the PR description.

Verify nothing else reads `shortcutKey`: `source ~/.zshenv && grep -rn "shortcutKey" src tests` should return only the test you are about to keep (none in `src`).

- [ ] **Step 5: Run the test, confirm green**

Run: `source ~/.zshenv && pnpm vitest run tests/components/search-palette-shortcuts.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify lint/types**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. (Biome may reorder the new import — accept it.)

- [ ] **Step 7: Commit**

```bash
git add src/components/search-palette.tsx src/lib/palette/actions.ts tests/components/search-palette-shortcuts.test.tsx
git commit -m "fix(palette): platform-aware shortcut hints on every registered action — Closes #54 Closes #55"
```

---

### Task 3: Broaden the palette placeholder to mention actions (#56)

**Files:**
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json` (key `palette.searchPlaceholder`)
- Test: `tests/lib/i18n/es-bundle.test.ts` (must keep passing — parity gate)

- [ ] **Step 1: Update the three catalogs**

The palette already renders `placeholder={t('palette.searchPlaceholder')}` (search-palette.tsx L165) — the placeholder is i18n-routed, so **no JSX change is needed and the i18n-audit gate stays clean** (we are editing the catalog value, not introducing a raw string literal). Change the value in all three catalogs (keysets must stay identical):

- `messages/en.json`: `"palette.searchPlaceholder": "Search pages and actions…"`
- `messages/es.json`: `"palette.searchPlaceholder": "Buscar páginas y acciones…"`
- `messages/ar.json`: `"palette.searchPlaceholder": "ابحث في الصفحات والإجراءات…"`

Preserve the existing ellipsis character (`…`, U+2026 — the same glyph the current `"Search pages…"` uses), not three dots. Confirm with: `source ~/.zshenv && grep -n "searchPlaceholder" messages/*.json`.

- [ ] **Step 2: Verify catalog parity + i18n gate**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/i18n tests/scripts/i18n-audit.test.ts`
Expected: PASS. The es-bundle parity test confirms en/es/ar keysets still match; the i18n-audit test confirms no new raw-string findings (there are none — the change is catalog-only).

- [ ] **Step 3: Commit**

```bash
git add messages/en.json messages/es.json messages/ar.json
git commit -m "fix(palette): broaden search placeholder to include actions — Closes #56"
```

---

### Task 4: Full gate + build

**Files:** none (verification only)

- [ ] **Step 1: Run the full verification gate**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm vitest run tests/lib/shortcuts tests/components/shortcuts tests/components/search-palette-shortcuts.test.tsx tests/lib/i18n tests/scripts/i18n-audit.test.ts && pnpm build`
Expected: lint/types clean; all targeted tests pass; build succeeds (UI change → build gate per CLAUDE.md).

> If `pnpm build` is too slow for the loop, the lint+typecheck+targeted-tests subset is the minimum gate; run `pnpm build` once before the PR.

---

## Self-Review

- Spec coverage: #54 (literal → `prettyKeys` glyph/label, Task 2), #55 (registry-driven hint on every bound action id, Task 2), #56 (placeholder broadened across en/es/ar, Task 3). ✓
- Single source of truth: shortcut strings now live only in the registry; `actions.ts` `shortcutKey` literals removed; `prettyKeys`/`isMac` de-duplicated into `src/lib/shortcuts/format.ts`. ✓
- SSR-safe platform detection: `isMac()` guards `typeof navigator === 'undefined'`, prefers `navigator.platform`, falls back to `userAgent`. ✓
- i18n gate: no new raw string literals (placeholder was already `t()`-routed); catalog keyset parity preserved (es-bundle test). ✓
- Commit hygiene: one commit per task; `Closes #54 #55` on Task 2, `Closes #56` on Task 3; enabling refactor in Task 1 carries no trailer. ✓
- Known intentional behavior change: `search.open` loses its (registry-unbacked) `Mod+K` hint — documented in Task 2 Step 4 with the correct follow-up (register it) rather than re-adding a literal. ✓
