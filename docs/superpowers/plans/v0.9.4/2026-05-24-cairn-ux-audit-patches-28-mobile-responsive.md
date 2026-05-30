# P28 — Mobile-Responsive Top-Bar Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop the top-bar locale switcher ("Language · English") from eating excessive horizontal width on narrow phones (≤390px). Collapse it to an icon-only globe control below the `sm` breakpoint while keeping the full label at `sm` and wider — preserving the accessible name and a ≥44px touch target throughout.

**Architecture:** `src/components/locale-switcher.tsx` is already a themed `ui/select` trigger (migrated in v0.9.3 #21 / P01). It renders a visible `<span>{t('locale.label')}</span>` label next to a `SelectTrigger` whose `<SelectValue />` shows the active locale's full name. On a 390px viewport this row consumes ~150px of the right-aligned top bar (`data-cairn-workspace-topbar` in `src/app/(app)/layout.tsx`, sharing the row with `NotificationBell` and `OfflineIndicator`). The fix is purely presentational + responsive Tailwind: hide the standalone label text below `sm`, hide the long `SelectValue` text below `sm`, and surface a `Globe` icon (from `lucide-react`) inside the trigger that is visible only below `sm`. The trigger keeps an explicit `aria-label` so the control is named identically at every breakpoint — screen-reader users never lose the "Language" label even when it is visually hidden. No new component, no state change, no behavior change to locale selection.

**Breakpoint convention:** This codebase uses Tailwind's default breakpoints and a mobile-first `md:`-driven shell (`md:flex-row`, sidebar `md:flex` / drawer `md:hidden` in `src/components/sidebar*.tsx`). The audit threshold for #95 is ≤390px, so the collapse must engage on narrow phones and reverse at `sm` (640px) — the first breakpoint comfortably above 390px. Use `sm:` (NOT `md:`) so small-tablet / large-phone landscape still gets the full label.

**Tech Stack:** React 19, `radix-ui` Select primitive (`src/components/ui/select.tsx`), `lucide-react` (`Globe`), Tailwind v4 (`@theme` in `src/app/globals.css`, no config file), `cn()` from `src/lib/utils.ts`, flat-dotted i18n catalogs in `messages/{en,es,ar}.json` via `useT()` from `src/lib/i18n/provider`.

**Covers:** GH #95 (audit: locale switcher excessive width ≤390px). **Cross-references** GH #94 (export dropdown overflow ≤390px), handled in **P23** (`-23-page-action-panels.md`) — see the shared-note section below for the reusable popup-positioning utility and other top-bar/overflow risks.

**Constraints (WCAG / i18n):**
- Accessible name MUST survive the collapse — the icon-only trigger keeps `aria-label={t('locale.label')}` (WCAG 2.4.6 / 4.1.2). The `Globe` icon is `aria-hidden`.
- Touch target ≥44×44px at all breakpoints (WCAG 2.5.5) — the existing trigger already sets `min-h-11`; the icon-only state must also be at least 44px wide (`min-w-11`).
- New user-facing strings go through i18n (all three catalogs: en, es, ar). The only net-new string here is an optional SR-only "Language" affordance; reuse the existing `locale.label` key rather than inventing a duplicate where possible.
- Color contrast of the globe icon must meet WCAG AA against the top-bar background (reuse the existing `text-muted-foreground` / token colors already used by the trigger — do not introduce new colors).

**Verify gate:** `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test`; for this UI change also `pnpm build`. Commit per task (Conventional Commits, `Closes #95`).

---

### Task 1: Responsive collapse of the locale switcher (#95)

**Files:**
- Modify: `src/components/locale-switcher.tsx`
- Test: `tests/components/locale-switcher-es.test.tsx` (exists — keep passing; add narrow-mode assertions)

- [ ] **Step 1: Extend the existing test to lock in the responsive contract**

Read `tests/components/locale-switcher-es.test.tsx` first (it currently asserts the trigger has role `combobox`, accessible name `/language/i` / `Idioma`, and shows the active locale label text). jsdom does not evaluate media queries, so we cannot assert "hidden at 390px" directly — instead assert the structural guarantees that make the collapse correct and accessible:

Add these assertions/cases to the existing `describe('<LocaleSwitcher>')` block:

```tsx
import { Globe } from 'lucide-react';

it('keeps an accessible Language name on the trigger regardless of viewport', () => {
  render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <LocaleSwitcher />
    </I18nProvider>,
  );
  // aria-label is always present (it is the accessible name when the visible
  // label/text is hidden below `sm`). This must NOT depend on the breakpoint.
  const trigger = screen.getByRole('combobox', { name: /language/i });
  expect(trigger.getAttribute('aria-label')).toMatch(/language/i);
});

it('renders a decorative globe icon that is hidden from assistive tech', () => {
  const { container } = render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <LocaleSwitcher />
    </I18nProvider>,
  );
  // The collapsed (narrow) affordance is a Globe icon; it must be aria-hidden
  // so SR users hear only the single "Language" accessible name.
  const svg = container.querySelector('svg[aria-hidden="true"].lucide-globe');
  expect(svg).toBeTruthy();
});

it('marks the standalone label as responsive-hidden (sr-safe) below sm', () => {
  render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <LocaleSwitcher />
    </I18nProvider>,
  );
  // The visible "Language" span is present in the DOM but carries the
  // hidden-below-sm utility, so wide viewports still show it.
  const label = screen.getByText(/^Language$/);
  expect(label.className).toContain('hidden');
  expect(label.className).toContain('sm:inline');
});
```

Note for the implementer: the `.lucide-globe` class is emitted by `lucide-react` icons (each icon adds `lucide lucide-<name>`); verify the exact class by importing `Globe` and rendering once if the selector misses. If lucide's class naming differs in the installed version, switch the selector to `container.querySelector('svg[aria-hidden="true"]')` scoped to the trigger.

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/locale-switcher-es.test.tsx`
Expected: FAIL — current component has no `Globe` icon and no `hidden sm:inline` on the label span.

- [ ] **Step 3: Implement the responsive collapse**

Edit `src/components/locale-switcher.tsx`. Add the `Globe` import and rework the returned JSX so that (a) the standalone label collapses below `sm`, (b) the `SelectValue` text collapses below `sm`, (c) a `Globe` icon shows below `sm`, and (d) the trigger keeps its `aria-label` and a ≥44px target in both states.

```tsx
'use client';

import { Globe } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LOCALE_COOKIE, LOCALES, type Locale } from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/provider';

export function LocaleSwitcher() {
  const t = useT();
  const locale = useLocale();

  function setLocale(next: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {/* Standalone label: visible at sm+, hidden on narrow phones (#95). */}
      <span className="hidden text-muted-foreground sm:inline">{t('locale.label')}</span>
      <Select value={locale} onValueChange={(next) => setLocale(next as Locale)}>
        {/*
          Trigger keeps the accessible name at every breakpoint via aria-label,
          so SR users always hear "Language" even when the visible label/value
          text is collapsed. min-h-11 + min-w-11 guarantees a >=44px target in
          the icon-only state (WCAG 2.5.5). w-auto at sm+ so the full locale
          name can size the trigger naturally.
        */}
        <SelectTrigger
          aria-label={t('locale.label')}
          className="min-h-11 min-w-11 w-auto justify-center gap-1 px-2 sm:min-w-28 sm:justify-between sm:px-3"
        >
          {/* Globe affordance: only on narrow phones; decorative (aria-hidden). */}
          <Globe aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
          {/* Active-locale name: hidden on narrow phones, shown at sm+. */}
          <SelectValue className="hidden sm:block" />
        </SelectTrigger>
        <SelectContent>
          {LOCALES.map((loc) => (
            <SelectItem key={loc} value={loc}>
              {t(`locale.${loc}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

Implementer checks against the real `ui/select`:
- Confirm `SelectValue` (a thin wrapper over `radix-ui`'s `Select.Value`) forwards `className`. Read `src/components/ui/select.tsx` — in P01 `SelectValue` is exported as the bare `SelectPrimitive.Value`. Radix's `Select.Value` forwards `className` to its rendered `<span>`, so `className="hidden sm:block"` is valid. If the installed version does NOT forward it, wrap the value instead: replace `<SelectValue className="hidden sm:block" />` with `<span className="hidden sm:block"><SelectValue /></span>` (the trigger's `aria-label` still provides the name, so an empty visible value on narrow screens is fine).
- Confirm the trigger's base class (P01) is `flex h-9 min-h-9 ... justify-between gap-2 px-3`. The `className` passed here is merged via `cn()` and appended after the base, so `justify-center`/`min-w-11`/`px-2` win at narrow widths and the `sm:` variants restore the wide layout. If `cn()` ordering does not let `px-2` override the base `px-3` (tailwind-merge should resolve this — same utility family), verify with a quick `pnpm build` + manual class inspection; tailwind-merge v3 in this repo dedupes conflicting `px-*`.
- Keep the outer `gap-2` so the label↔trigger spacing matches the rest of the top bar.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/locale-switcher-es.test.tsx`
Expected: PASS. The existing two cases (en trigger labelled "Language" showing "English"; es trigger labelled "Idioma" showing "Español") must still pass — the visible-value text is present in the DOM at all times (only CSS-hidden below `sm`, which jsdom ignores), so `trigger.textContent` assertions remain valid.

- [ ] **Step 5: Verify lint/types/build**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. Biome may reorder the new `Globe` import (alphabetical, before the `@/` aliases) — accept its fix.

- [ ] **Step 6: Manual responsive check (recommended, not gating)**

`source ~/.zshenv && pnpm dev`, open any `/(app)` page, and use devtools responsive mode at 390px and 414px:
- ≤390px (below `sm`): top bar shows the globe-only switcher (≥44px), no "Language" text, no long locale name. The bell + offline indicator fit without horizontal scroll.
- ≥640px (`sm`+): "Language English" returns in full.
- Tab to the control: focus ring visible; screen reader announces "Language, combobox" in both states.

- [ ] **Step 7: Commit**

```bash
git add src/components/locale-switcher.tsx tests/components/locale-switcher-es.test.tsx
git commit -m "fix(i18n): collapse locale switcher to globe icon on narrow screens — Closes #95"
```

---

### Task 2: i18n — confirm no orphaned/duplicate strings (all three catalogs)

**Files:**
- Inspect: `messages/en.json`, `messages/es.json`, `messages/ar.json`

- [ ] **Step 1: Confirm the existing `locale.label` key is reused (no net-new string)**

This patch deliberately reuses `locale.label` ("Language" / "Idioma" / "اللغة") for both the visible `sm:` label and the always-present `aria-label`. No new key is required. Grep to confirm the key still exists and is identical-shaped across catalogs:

```bash
source ~/.zshenv && grep -n '"locale.label"' messages/en.json messages/es.json messages/ar.json
```

Expected: present in all three (`en: "Language"`, `es: "Idioma"`, `ar: "اللغة"`).

- [ ] **Step 2: If a distinct SR string is preferred, add it to all three catalogs (optional)**

Only if review decides the icon-only control should announce something more specific than the bare label (e.g. "Change language") — add the SAME new flat key to **all three** catalogs (en/es/ar) and switch the trigger's `aria-label` to it. Do NOT add an English key to `en.json` only; the repo's i18n discipline (P31) requires parity across catalogs. Skip this step otherwise — reuse is the default.

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. (If P31's i18n parity Biome rule / catalog-key check exists, it must pass — no missing keys across en/es/ar.)

- [ ] **Step 4: Commit (only if Step 2 added a string)**

```bash
git add messages/en.json messages/es.json messages/ar.json src/components/locale-switcher.tsx
git commit -m "i18n(locale-switcher): add change-language SR label across catalogs — refs #95"
```

---

## Shared note — mobile popup positioning (cross-ref #94 / P23)

**Context.** Audit #94 (export dropdown overflows the viewport at ≤390px) is owned by **P23** (`-23-page-action-panels.md`), not this plan. P23 is expected to introduce a popup-positioning / viewport-clamp utility (e.g. collision-aware placement + a max-width/right-edge clamp so menu content never spills past the 390px viewport). This section records the cross-cutting guidance so #95 and #94 stay consistent and the utility is reused rather than re-implemented per popup.

**Guidance for whoever lands P23's utility:**
- Make the viewport-clamp helper **shared** (a small util or a wrapper around the `radix-ui` Popper/`Content` `collisionPadding` + `avoidCollisions` props), not inlined into the export dropdown. The locale switcher's `SelectContent` (this plan) opens a popper too — if a menu ever grows wide, it should clamp via the same mechanism.
- The locale switcher in this plan does **not** need the clamp today: its `SelectContent` is a short list of 3 short locale names and `radix-ui`'s `Select` already portals + collision-avoids by default (P01 sets `position="popper"`). Listed here only so a future wider locale list reuses P23's helper instead of a one-off fix.

**Other top-bar / overflow risks worth a mobile (≤390px) pass** (right-aligned `data-cairn-workspace-topbar` row in `src/app/(app)/layout.tsx` packs `NotificationBell` + `LocaleSwitcher` + `OfflineIndicator`):
- **NotificationBell** (`src/components/notifications/bell.tsx`): the 44×44 bell itself is fine, but it opens a `NotificationDrawer` (`./drawer`). Confirm the drawer is full-width / edge-anchored at ≤390px and does not overflow horizontally — same clamp concern as #94's dropdown. If it's a side drawer it likely already spans the viewport; verify, don't assume.
- **LocaleSwitcher** (this plan, #95): resolved here by collapsing to the globe icon below `sm`.
- **OfflineIndicator** (`src/components/pwa/offline-indicator`): check it shrinks to an icon/dot rather than a text pill on narrow screens; if it renders a word ("Offline") it adds to the same horizontal-pressure problem #95 addresses. Flag for a follow-up if it does — out of scope for this plan.
- **Top-bar row wrapping:** the row is `flex items-center justify-end gap-4`. With three controls collapsed to icons it should fit 390px comfortably; if a future control is added, consider `flex-wrap` or moving secondary controls into an overflow menu rather than letting the row push the page horizontally.

These are noted, not fixed here — this plan stays scoped to #95.

---

## Self-Review

- Spec coverage: #95 (locale switcher collapses to globe icon ≤390px, full label at `sm`+) implemented + tested. ✓
- Accessible name preserved at every breakpoint via always-present `aria-label`; globe icon is `aria-hidden`. ✓
- ≥44px touch target in both states (`min-h-11 min-w-11`). ✓
- New strings i18n: none required (reuses `locale.label`); optional SR string path requires all-three-catalog parity. ✓
- Cross-reference to #94 / P23 captured as a shared "mobile popup positioning" note + top-bar overflow inventory (NotificationBell, OfflineIndicator), explicitly out-of-scope-but-flagged. ✓
- jsdom can't test media queries — tests assert the structural/a11y invariants (aria-label, aria-hidden globe, `hidden sm:inline` label) that make the CSS collapse correct, plus existing label-text cases still pass. ✓
- Implementer is told to verify the real `ui/select` `SelectValue` className forwarding and `cn()`/tailwind-merge `px-*` override before trusting the snippet. ✓
