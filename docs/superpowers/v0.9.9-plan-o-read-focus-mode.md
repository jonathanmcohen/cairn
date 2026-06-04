# v0.9.9 Plan O — Read & Focus Mode

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Make Cairn's existing focus-mode (hide chrome) and reader-mode (read-only prose) toggles *discoverable, escapable, and well-behaved*. The two `<PageModeToggles>` buttons already work (state lives in `<PageModeShell>`, persisted to `localStorage`), but the live v0.9.8 audit found four gaps: (O1) the Eye/Expand icon buttons carry `title`/`aria-label` but no keyboard shortcut and the tooltip never mentions one (#57/#236); (O2) once focus-mode hides the sidebar + topbar + comments rail there is no on-screen way back out (#58/#237); (O3) expand/focus mode hides the sidebar with no re-show toggle or hover hot-edge (#59/#238); and (O4) focus/reader state is global in `localStorage` so it leaks across page navigation instead of resetting per page (#63/#247). This plan wires a registry-backed keyboard shortcut for each toggle, a fixed exit-focus floating control + banner, a left-edge hover hot-edge that temporarily reveals the sidebar, and a per-page reset of the mode state.

**Architecture:**
- **Mode state owner:** `src/components/pages/page-mode-shell.tsx` — a `'use client'` context provider (`usePageMode()` / `usePageModeOptional()`) that holds `{ focus, reader }`, mirrors `focus` onto the `html.cairn-focus-mode` root class, and persists to `localStorage` key `cairn:page-mode`. It wraps the page-detail body in `src/app/(app)/pages/[pageId]/page.tsx`.
- **Toggle buttons:** `src/components/pages/page-mode-toggles.tsx` — the `Maximize2` (focus) + `Eye` (reader) `aria-pressed` icon buttons in the page header action cluster.
- **CSS chrome-hiding:** `src/app/globals.css` `html.cairn-focus-mode [data-cairn-workspace-sidebar|topbar|comments-rail] { display:none !important }`. Hot-edge reveal will override this with a more specific selector keyed off a `data-reveal-sidebar` attribute the shell sets.
- **Sidebar element:** `src/components/sidebar.tsx` carries `data-cairn-workspace-sidebar=""`.
- **Shortcut registry:** `src/lib/shortcuts/registry.ts` (`registerShortcut`, `matchShortcut`, scope `'editor' | 'global'`) + `src/components/shortcuts/app-shortcuts.ts` (`ensureAppShortcuts` registers entries, `setShortcutHandlers` injects `run` callbacks) + `src/components/shortcuts/dispatcher.tsx` (the keydown listener). Shortcut display glyphs come from `src/lib/shortcuts/format.ts` (`prettyKeys`, `shortcutFor`). Page-mode toggles are *not* mounted inside the dispatcher tree, so they will listen for a `window` `CustomEvent` the registry `run` dispatches (the same pattern `editor.insertLink` uses).
- **i18n:** `useT()` from `src/lib/i18n/provider`; catalogs at `messages/{en,es,ar}.json` loaded by `src/lib/i18n/messages.ts`. Existing keys: `pageMode.focus/focusHint/reader/readerHint`.
- **Tests:** Vitest 4 jsdom + Testing Library; existing suites `tests/components/pages/page-mode-shell.test.tsx` and `tests/a11y/page-mode-toggles.test.tsx`. Provider-wrapping `render()` helper pattern as in the shell test.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript 6 strict · Tailwind v4 (`@theme` in globals.css) + shadcn/ui (`Button`) · lucide-react icons · Vitest 4 (jsdom) + Testing Library · Biome v2 (0 errors) · i18n en/es/ar via `useT()`. No new migration in this plan (read/focus state is client-only `localStorage`, no DB column).

---

## O1 — Eye/Expand toggle tooltips with keyboard shortcuts (#57/#236)

Register two registry shortcuts (`page.focus` ⌘⇧. for focus/Expand, `page.reader` ⌘⇧R for reader/Eye) so the keystrokes toggle the modes via a `window` CustomEvent the `<PageModeShell>` listens for, and append the rendered shortcut glyph to each button's `title` tooltip so the keystroke is discoverable. The buttons already have `aria-label` + `title` from #104; we extend the hint text and add the keyboard path.

**Cause:** `page-mode-toggles.tsx:41/53` set `title={t('pageMode.focusHint')}` / `t('pageMode.readerHint')` — static strings, no key combo — and no registry entry exists for either mode, so there is no keyboard affordance at all (`app-shortcuts.ts` has none).

**Files:**
- Modify `src/components/shortcuts/app-shortcuts.ts` (add two `global`-scope entries dispatching `cairn:page-mode:toggle-focus` / `cairn:page-mode:toggle-reader`)
- Modify `src/components/pages/page-mode-shell.tsx` (listen for those events, flip state)
- Modify `src/components/pages/page-mode-toggles.tsx` (append `prettyKeys` to the `title`)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json` (shortcut label keys `shortcut.focusMode`, `shortcut.readerMode`)
- Modify `tests/a11y/page-mode-toggles.test.tsx` (assert tooltip carries a key glyph)
- Create `tests/components/shortcuts/page-mode-shortcuts.test.ts` (registry entries + event dispatch)

**Steps:**

- [ ] Write failing test `tests/components/shortcuts/page-mode-shortcuts.test.ts`: import `resetRegistry`, `getShortcuts`, `matchShortcut` from `@/lib/shortcuts/registry` and `ensureAppShortcuts`, `setShortcutHandlers` from `@/components/shortcuts/app-shortcuts`. In `beforeEach` call `resetRegistry()` and reset the module's `registered` flag via `vi.resetModules()` + dynamic import. Assert that after `ensureAppShortcuts()` the registry contains `page.focus` with `keys: 'Mod+Shift+.'` scope `global`, and `page.reader` with `keys: 'Mod+Shift+R'` scope `global`. Assert `matchShortcut({ key: '.', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }, 'global')?.id === 'page.focus'`. Spy on `window.dispatchEvent` and assert calling that entry's `run()` dispatches a `CustomEvent` of type `cairn:page-mode:toggle-focus`.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/shortcuts/page-mode-shortcuts.test.ts` (entries absent → fail).
- [ ] Implement: in `src/components/shortcuts/app-shortcuts.ts`, after the `editor.linkPage` block, add:
  ```ts
  registerShortcut({
    id: 'page.focus',
    keys: 'Mod+Shift+.',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.focusMode',
    run: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cairn:page-mode:toggle-focus'));
      }
    },
  });

  registerShortcut({
    id: 'page.reader',
    keys: 'Mod+Shift+R',
    scope: 'global',
    kind: 'action',
    labelKey: 'shortcut.readerMode',
    run: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cairn:page-mode:toggle-reader'));
      }
    },
  });
  ```
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/shortcuts/page-mode-shortcuts.test.ts`.
- [ ] Implement event listener in `src/components/pages/page-mode-shell.tsx`: inside `PageModeShell`, add an effect that registers `cairn:page-mode:toggle-focus` / `cairn:page-mode:toggle-reader` listeners flipping the respective flag. Use functional setters so the listener never goes stale:
  ```ts
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onFocus = () => setFocus(!modeRef.current.focus);
    const onReader = () => setReader(!modeRef.current.reader);
    window.addEventListener('cairn:page-mode:toggle-focus', onFocus);
    window.addEventListener('cairn:page-mode:toggle-reader', onReader);
    return () => {
      window.removeEventListener('cairn:page-mode:toggle-focus', onFocus);
      window.removeEventListener('cairn:page-mode:toggle-reader', onReader);
    };
  }, [setFocus, setReader]);
  ```
  where `modeRef` is a `useRef(mode)` kept current via `modeRef.current = mode` on each render (avoids re-subscribing every toggle). `setFocus`/`setReader` are already stable `useCallback`s.
- [ ] Add the i18n keys. In `messages/en.json` add `"shortcut.focusMode": "Toggle focus mode"`, `"shortcut.readerMode": "Toggle reader mode"`. In `messages/es.json` add `"shortcut.focusMode": "Alternar modo concentración"`, `"shortcut.readerMode": "Alternar modo lectura"`. In `messages/ar.json` add `"shortcut.focusMode": "تبديل وضع التركيز"`, `"shortcut.readerMode": "تبديل وضع القراءة"`.
- [ ] Implement tooltip-with-shortcut in `src/components/pages/page-mode-toggles.tsx`: import `prettyKeys`, `shortcutFor` from `@/lib/shortcuts/format`, compute `const focusKeys = shortcutFor('page.focus')` and `readerKeys = shortcutFor('page.reader')`, and build a hint helper:
  ```ts
  const withKeys = (hint: string, keys: string | undefined) =>
    keys ? `${hint} (${prettyKeys(keys)})` : hint;
  ```
  Change the focus button `title` to `withKeys(t('pageMode.focusHint'), focusKeys)` and the reader button `title` to `withKeys(t('pageMode.readerHint'), readerKeys)`. Add `ensureAppShortcuts()` call in a mount effect inside `PageModeToggles` (guarded; it is idempotent) so the registry is populated even on a page where the dispatcher hasn't yet mounted.
- [ ] Write failing assertion in `tests/a11y/page-mode-toggles.test.tsx`: after rendering, assert the focus button's `title` attribute matches `/⌘⇧\.|Ctrl\+Shift\+\./` and the reader button's `title` matches `/⌘⇧R|Ctrl\+Shift\+R/`. (Call `ensureAppShortcuts()` in the test's `beforeEach` after `resetRegistry()` so `shortcutFor` resolves.)
- [ ] Run to fail then pass: `source ~/.zshenv && pnpm vitest run tests/a11y/page-mode-toggles.test.tsx`.
- [ ] Commit: `feat(pages): keyboard shortcuts + shortcut-aware tooltips for focus/reader toggles (#57 #236)`

---

## O2 — Exit-focus floating control + banner when chrome is hidden (#58/#237)

When focus mode hides the sidebar/topbar/comments rail, render a fixed, always-on-top "Exit focus mode" control so the user is never trapped. It shows a one-time banner on entry (auto-dismiss after 4s, or click to leave) and leaves behind a small persistent floating button in the top-right. Pressing `Escape` while in focus mode also exits.

**Cause:** `globals.css:228-232` hides every `data-cairn-*` chrome element with `display:none !important` while `html.cairn-focus-mode` is set, and `<PageModeToggles>` lives *inside* that hidden header cluster — so once focus mode is on, the only off switch is hidden. There is no fixed escape affordance anywhere (#58 audit).

**Files:**
- Create `src/components/pages/exit-focus-control.tsx`
- Modify `src/components/pages/page-mode-shell.tsx` (render `<ExitFocusControl>` when `focus` is true; expose `setFocus`)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json` (`pageMode.exitFocus`, `pageMode.focusBanner`)
- Create `tests/components/pages/exit-focus-control.test.tsx`

**Steps:**

- [ ] Write failing test `tests/components/pages/exit-focus-control.test.tsx` (jsdom): use the provider-wrapping `render()` helper (copy from `page-mode-shell.test.tsx`). Render `<PageModeShell><PageModeToggles /></PageModeShell>`, click the focus button, then assert:
  - a fixed exit button with accessible name `/exit focus mode/i` appears (`screen.getByRole('button', { name: /exit focus mode/i })`);
  - an entry banner with role `status` containing the exit copy is present;
  - clicking the exit button removes `cairn-focus-mode` from `document.documentElement` and sets `aria-pressed=false` on the focus toggle;
  - pressing `Escape` (`fireEvent.keyDown(window, { key: 'Escape' })`) while focused also clears `cairn-focus-mode`;
  - when not in focus mode, `screen.queryByRole('button', { name: /exit focus mode/i })` is null.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/pages/exit-focus-control.test.tsx`.
- [ ] Add i18n keys. `messages/en.json`: `"pageMode.exitFocus": "Exit focus mode"`, `"pageMode.focusBanner": "Focus mode — chrome hidden. Press Escape or this button to exit."`. `messages/es.json`: `"pageMode.exitFocus": "Salir del modo concentración"`, `"pageMode.focusBanner": "Modo concentración: interfaz oculta. Pulsa Escape o este botón para salir."`. `messages/ar.json`: `"pageMode.exitFocus": "الخروج من وضع التركيز"`, `"pageMode.focusBanner": "وضع التركيز — تم إخفاء الواجهة. اضغط Escape أو هذا الزر للخروج."`.
- [ ] Implement `src/components/pages/exit-focus-control.tsx`:
  ```tsx
  'use client';

  import { Minimize2 } from 'lucide-react';
  import { useEffect, useState } from 'react';
  import { Button } from '@/components/ui/button';
  import { useT } from '@/lib/i18n/provider';

  /**
   * v0.9.9 Plan O #58/#237 — escape hatch from focus mode. Focus mode hides the
   * header (and the in-header focus toggle) via `html.cairn-focus-mode`, so we
   * render this fixed control ONLY while focus is on. A one-shot banner appears
   * on entry then auto-dismisses; a small floating button persists. Escape also
   * exits. Rendered by <PageModeShell>, which owns the exit callback.
   */
  export function ExitFocusControl({ onExit }: { onExit: () => void }) {
    const t = useT();
    const [showBanner, setShowBanner] = useState(true);

    // One-shot banner: auto-hide after 4s, leaving the persistent button.
    useEffect(() => {
      const id = window.setTimeout(() => setShowBanner(false), 4000);
      return () => window.clearTimeout(id);
    }, []);

    // Escape exits focus mode outright (matches the single-open-panel Escape UX).
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onExit();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onExit]);

    return (
      <>
        {showBanner && (
          <div
            role="status"
            aria-live="polite"
            className="-translate-x-1/2 fixed top-3 left-1/2 z-[60] flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg"
          >
            <span>{t('pageMode.focusBanner')}</span>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('pageMode.exitFocus')}
          title={t('pageMode.exitFocus')}
          onClick={onExit}
          className="fixed top-3 right-3 z-[60] min-h-[44px] min-w-[44px] shadow-lg"
        >
          <Minimize2 className="h-4 w-4" />
        </Button>
      </>
    );
  }
  ```
- [ ] Wire into `src/components/pages/page-mode-shell.tsx`: import `ExitFocusControl`, and inside the provider render (after `{children}` within the `Ctx.Provider`) add `{mode.focus && <ExitFocusControl onExit={() => setFocus(false)} />}`. Note the fixed control sits *outside* the `cairn-focus-mode` hide rule because it carries none of the `data-cairn-*` attributes, so it stays visible.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/exit-focus-control.test.tsx`.
- [ ] Commit: `feat(pages): fixed exit-focus banner + floating button + Escape exit (#58 #237)`

---

## O3 — Expand-mode hot-edge sidebar reveal + re-show toggle (#59/#238)

While focus mode is on (sidebar hidden), let the user peek the sidebar by hovering the left screen edge, and provide an explicit re-show pin so they can keep it open. The reveal is a temporary CSS override scoped by a `data-reveal-sidebar` attribute the shell sets on the document root; it does not exit focus mode.

**Cause:** `globals.css:228` `display:none !important` on `[data-cairn-workspace-sidebar]` is unconditional under `html.cairn-focus-mode`, with no re-show path (#59 audit, ties #238). The sidebar element is `src/components/sidebar.tsx` (`data-cairn-workspace-sidebar=""`).

**Files:**
- Create `src/components/pages/sidebar-hot-edge.tsx`
- Modify `src/app/globals.css` (hot-edge reveal override + a thin invisible hover strip helper class)
- Modify `src/components/pages/page-mode-shell.tsx` (render `<SidebarHotEdge>` when `focus` is true)
- Modify `messages/en.json`, `messages/es.json`, `messages/ar.json` (`pageMode.revealSidebar`, `pageMode.pinSidebar`)
- Create `tests/components/pages/sidebar-hot-edge.test.tsx`

**Steps:**

- [ ] Write failing test `tests/components/pages/sidebar-hot-edge.test.tsx` (jsdom): render `<PageModeShell><PageModeToggles /></PageModeShell>` plus a stub `<aside data-cairn-workspace-sidebar />` sibling, enter focus mode, then assert:
  - a hover strip element with `data-sidebar-hot-edge` exists in the document;
  - firing `mouseEnter` on it sets `data-reveal-sidebar="true"` on `document.documentElement`;
  - firing `mouseLeave` clears it back to absent/`"false"`;
  - a "pin sidebar" toggle button with name `/pin sidebar/i` exists, and clicking it keeps `data-reveal-sidebar="true"` even after `mouseLeave` (pinned), and its `aria-pressed` flips to `true`;
  - leaving focus mode removes `data-reveal-sidebar` from the root.
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/pages/sidebar-hot-edge.test.tsx`.
- [ ] Add i18n keys. `messages/en.json`: `"pageMode.revealSidebar": "Show sidebar"`, `"pageMode.pinSidebar": "Pin sidebar open"`. `messages/es.json`: `"pageMode.revealSidebar": "Mostrar barra lateral"`, `"pageMode.pinSidebar": "Fijar barra lateral"`. `messages/ar.json`: `"pageMode.revealSidebar": "إظهار الشريط الجانبي"`, `"pageMode.pinSidebar": "تثبيت الشريط الجانبي"`.
- [ ] Implement CSS in `src/app/globals.css`, immediately after the existing `html.cairn-focus-mode` hide block (so the reveal selector is more specific and wins):
  ```css
  /*
   * v0.9.9 Plan O #59/#238 — focus mode hides the sidebar, but a left-edge
   * hover (or the pin toggle) sets `data-reveal-sidebar` on the html root to
   * temporarily un-hide it without leaving focus mode. The reveal selector is
   * more specific than the blanket `display:none` above, so it wins.
   */
  html.cairn-focus-mode[data-reveal-sidebar='true'] [data-cairn-workspace-sidebar] {
    display: block !important;
    position: fixed;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 55;
    box-shadow: 0 0 1.5rem rgb(0 0 0 / 0.25);
  }
  ```
- [ ] Implement `src/components/pages/sidebar-hot-edge.tsx`:
  ```tsx
  'use client';

  import { PanelLeftOpen } from 'lucide-react';
  import { useCallback, useEffect, useState } from 'react';
  import { Button } from '@/components/ui/button';
  import { useT } from '@/lib/i18n/provider';

  function setReveal(on: boolean) {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-reveal-sidebar', on ? 'true' : 'false');
  }

  /**
   * v0.9.9 Plan O #59/#238 — left-edge hover strip + pin toggle that reveals
   * the focus-mode-hidden sidebar without exiting focus mode. Hover reveals
   * transiently; the pin keeps it revealed. Mounted by <PageModeShell> only
   * while focus is on; clears the root attribute on unmount.
   */
  export function SidebarHotEdge() {
    const t = useT();
    const [pinned, setPinned] = useState(false);

    useEffect(() => {
      setReveal(pinned);
      return () => setReveal(false);
    }, [pinned]);

    const onEnter = useCallback(() => setReveal(true), []);
    const onLeave = useCallback(() => {
      if (!pinned) setReveal(false);
    }, [pinned]);

    return (
      <>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          data-sidebar-hot-edge=""
          aria-hidden="true"
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          className="fixed inset-y-0 left-0 z-50 w-2"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-pressed={pinned}
          aria-label={t('pageMode.pinSidebar')}
          title={t('pageMode.revealSidebar')}
          onClick={() => setPinned((p) => !p)}
          className="fixed bottom-3 left-3 z-[60] min-h-[44px] min-w-[44px] shadow-lg"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      </>
    );
  }
  ```
- [ ] Wire into `src/components/pages/page-mode-shell.tsx`: import `SidebarHotEdge`, render `{mode.focus && <SidebarHotEdge />}` next to the `ExitFocusControl` line inside the provider.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/sidebar-hot-edge.test.tsx`.
- [ ] Commit: `feat(pages): hot-edge sidebar reveal + pin toggle in focus mode (#59 #238)`

---

## O4 — Per-page focus/reader reset on navigation (#63/#247)

Reset `{ focus, reader }` to defaults whenever the page changes, so toggling focus/reader on one document does not silently carry into the next one. Keep the per-device `localStorage` persistence for *re-mounts of the same page* (so an accidental refresh keeps your view), but treat a navigation to a different `pageId` as a fresh start.

**Cause:** `page-mode-shell.tsx:20/62-75` persists mode in a single global `localStorage` key `cairn:page-mode` with no page scoping, and `page.tsx:78` mounts `<PageModeShell>` without a `pageId`, so the App Router reuses the client subtree across `/pages/[pageId]` navigations and the mode bleeds across pages (#247 audit; Plan P confirms this lives here, not in Plan P).

**Files:**
- Modify `src/components/pages/page-mode-shell.tsx` (accept `pageId` prop; reset modes when it changes)
- Modify `src/app/(app)/pages/[pageId]/page.tsx` (pass `pageId={page.id}`)
- Modify `tests/components/pages/page-mode-shell.test.tsx` (add per-page reset case)

**Steps:**

- [ ] Write failing test in `tests/components/pages/page-mode-shell.test.tsx`: add a case "resets focus + reader when pageId changes". Render `<PageModeShell pageId="a"><PageModeToggles /></PageModeShell>`, click the focus + reader buttons (both `aria-pressed=true`, root has `cairn-focus-mode`), then re-render with `pageId="b"` (use the `rerender` from the custom `render` — extend the helper to return rerender, or render via `rtlRender` directly with the provider wrapper). Assert `cairn-focus-mode` is removed from the root, the shell root no longer has `data-reader="true"`, and both toggles read `aria-pressed=false`. Also keep a guard case: re-rendering with the *same* `pageId="a"` does NOT reset (state survives a same-page re-render).
- [ ] Run to fail: `source ~/.zshenv && pnpm vitest run tests/components/pages/page-mode-shell.test.tsx`.
- [ ] Implement in `src/components/pages/page-mode-shell.tsx`:
  - Change `type Props = { children: ReactNode }` to `type Props = { children: ReactNode; pageId?: string }` and destructure `{ children, pageId }`.
  - Add a reset effect keyed on `pageId` that fires only on an actual change (skip the initial mount so the localStorage-hydrate effect still runs):
    ```ts
    const prevPageIdRef = useRef<string | undefined>(pageId);
    useEffect(() => {
      // Per-page reset (#63/#247): a navigation to a different page starts in
      // the default (no focus / no reader) view. The initial mount is skipped
      // so the localStorage hydrate effect still applies for same-page reloads.
      if (prevPageIdRef.current === pageId) return;
      prevPageIdRef.current = pageId;
      setMode(DEFAULTS);
      writePrefs(DEFAULTS);
    }, [pageId]);
    ```
  - Import `useRef` from `react`.
  - Update the doc-comment block to note the `pageId`-keyed reset.
- [ ] Pass the prop in `src/app/(app)/pages/[pageId]/page.tsx`: change `<PageModeShell>` (line 78) to `<PageModeShell pageId={page.id}>`.
- [ ] Run to pass: `source ~/.zshenv && pnpm vitest run tests/components/pages/page-mode-shell.test.tsx`.
- [ ] Commit: `fix(pages): reset focus/reader mode per page on navigation (#63 #247)`

---

## O5 — Group gate (HOLD for GO)

Single PR onto `patches/v0.9.9`. Run the full gate and HOLD for the user's merge GO. Do NOT push from a subagent; the controller pushes.

**Steps:**

- [ ] Lint (0 errors): `source ~/.zshenv && pnpm lint` — Biome v2 must report zero errors. Accept Biome's import-order / `import type` auto-fixes (`biome check --write`) and re-run.
- [ ] Typecheck: `source ~/.zshenv && pnpm typecheck` (`tsc --noEmit`, TS6 strict) — 0 errors. Confirm the new `Props.pageId?: string`, the `modeRef`/`prevPageIdRef` refs, and the CustomEvent listeners type-check.
- [ ] i18n none-new check: confirm every key added by this plan (`shortcut.focusMode`, `shortcut.readerMode`, `pageMode.exitFocus`, `pageMode.focusBanner`, `pageMode.revealSidebar`, `pageMode.pinSidebar`) exists in all three of `messages/{en,es,ar}.json` and that no `useT()` call references a key absent from `en.json`. Run the repo's i18n parity check (the Biome i18n rule / catalog-parity script) and confirm "none new / no missing": `source ~/.zshenv && pnpm lint` covers the Biome i18n rule; verify all three catalogs have identical key sets for the new keys.
- [ ] FULL test suite: `source ~/.zshenv && pnpm vitest run` (Testcontainers Postgres needs Docker/Colima up — `colima start` if down). All suites green, including `tests/components/pages/page-mode-shell.test.tsx`, `tests/a11y/page-mode-toggles.test.tsx`, `tests/components/shortcuts/page-mode-shortcuts.test.ts`, `tests/components/pages/exit-focus-control.test.tsx`, `tests/components/pages/sidebar-hot-edge.test.tsx`.
- [ ] Build: `source ~/.zshenv && pnpm build` — clean Next 16 standalone build, no type or route errors.
- [ ] e2e UI-acceptance gate (editor group — route-reachability + per-feature deployed-image check, GitHub-hosted runners only): on the deployed image, navigate to a `/pages/[pageId]` route and verify (1) the route is reachable and renders the header toggles; (2) **O1** focus + reader buttons expose a shortcut glyph in their `title` and ⌘⇧. / ⌘⇧R toggle them; (3) **O2** entering focus mode hides sidebar/topbar/comments rail AND shows the fixed exit button + banner, and both the exit button and `Escape` leave focus mode; (4) **O3** hovering the left edge reveals the hidden sidebar and the pin keeps it open; (5) **O4** toggling focus on page A then navigating to page B starts B unfocused. No self-hosted runners.
- [ ] Open a single PR onto `patches/v0.9.9` titled `Plan O — Read & Focus Mode (#57 #58 #59 #63 #236 #237 #238 #247)` summarizing O1–O4 and linking the issues with `Closes #57 #58 #59 #63 #236 #237 #238 #247`. **HOLD — do not merge; await user GO.**
