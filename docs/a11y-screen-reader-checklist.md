# Cairn — Manual Screen-Reader & Keyboard A11y Checklist

The `@axe-core/playwright` gate (`pnpm test:a11y`, also wired as the CI `a11y`
job) covers static WCAG 2.1 AA rule violations: ARIA misuse, missing labels,
landmark structure, color contrast, name/role/value. It cannot evaluate
**dynamic** behavior — reading order, live-region timing, keyboard-driven
focus journeys, or screen-reader announcement quality. This checklist is the
human-in-the-loop pass that complements the automated gate.

Run this checklist before any release that touches the editor, sidebar,
database views, dialog/popovers, or sign-in surfaces.

## Setup

- **Browsers:** latest Chrome + latest Firefox.
- **Screen readers:**
  - macOS: VoiceOver (`Cmd+F5`) with Safari and Chrome.
  - Windows: NVDA (free) with Firefox and Chrome.
- **Theme matrix:** repeat each section in **light** and **dark** mode (toggle
  in the sidebar's "Toggle theme" button).
- **Zoom:** also walk the checklist at 200% browser zoom and at 400% (WCAG
  1.4.10 reflow) — nothing should clip, scroll horizontally on a 1280px
  viewport, or require horizontal scrolling at the smaller widths.

---

## 1. Landmarks & navigation

- [ ] On every authenticated screen, the SR rotor / landmark list shows exactly
      one `<main>` (named "Main" implicitly or via `aria-label`), one
      `<nav>` for "Pages", and one `<aside>` / `<complementary>` for the
      sidebar.
- [ ] The first focus target on Tab from the URL bar is the "Skip to main
      content" link, and activating it moves SR focus into `<main>`.
- [ ] Sidebar nav items announce their accessible name (page emoji is
      decorative and not read; the page title is read as the link's name).
- [ ] On mobile (below the `md` breakpoint), the off-canvas drawer announces
      itself as a dialog, traps focus while open, and restores focus to the
      hamburger trigger on Esc / backdrop click.

## 2. Keyboard journey

- [ ] Every interactive control (button, link, input, select, listbox option,
      table cell editor) is reachable with Tab/Shift+Tab in a sensible order.
- [ ] Every interactive control shows a **visible focus ring** (the global
      `:focus-visible` rule in `globals.css` should guarantee a 2px ring;
      verify per-component overrides — buttons, links, inputs, table cells
      — don't suppress it).
- [ ] No keyboard trap: from any focused element, Esc / Tab eventually
      returns focus to the document body.
- [ ] Manual keyboard walk results from P14 Task 3 (deferred-follow-up items):
  - [x] **Slash menu (`/`)**: open with `/`, arrow up/down navigates the
        listbox, Enter inserts, Esc closes and returns focus to the editor.
  - [x] **Mention popup (`@`)**: open with `@<query>`, arrow up/down picks a
        member, Enter inserts, Esc closes.
  - [x] **Page-link popup (`[[`)**: open with `[[<query>`, arrow up/down picks
        a page, Enter inserts, Esc closes.
  - [x] **Page mention (`@@`)**: same listbox behavior as `[[`.
  - [x] **Page-actions dialog (Page menu)**: opens as `role="dialog"` with an
        accessible name, traps focus, Esc closes + restores focus to the
        trigger button (also covered by `tests/a11y/dialog.spec.ts`).
  - [x] **Database table**: Tab/Shift+Tab cycles through cell editors and
        view controls; row "+/-" toggles are keyboard-operable.
  - [ ] **DEFERRED (post-v0.6.0):** arrow-key cell-grid navigation inside
        the table view (currently you need Tab to step cell-by-cell). The
        table is keyboard-usable today, but cell-grid arrow nav is the
        Notion-parity follow-up.

## 3. Menus, dialogs, popovers

- [ ] Each popup / popover used by the editor (slash menu, mention picker,
      page-link picker, comment thread, share dialog) is exposed via the
      correct ARIA pattern (listbox/option for the menus, dialog for the
      modal share/page-actions surface).
- [ ] Each dialog has an accessible name (a heading inside or `aria-label`).
- [ ] Each dialog returns focus to the trigger on close (Esc + click-outside).
- [ ] Open-state is announced to the SR (e.g. "Page actions, dialog,
      pressed" or "Slash menu expanded").

## 4. Database views

- [ ] The default table view announces itself as a `<table>` with rowgroups
      and column headers (`<th scope="col">`). Cell editors announce the
      column name (the cell's `aria-label`, set from `property.name`).
- [ ] The view switcher buttons announce their type ("Table", "Gallery",
      "Calendar", …) and active state.
- [ ] Kanban / gallery / calendar / timeline / list views render their items
      as keyboard-focusable controls with accessible names.
- [ ] Sort, filter, group, and calc-footer controls are reachable by Tab and
      announce their function.

## 5. Live regions

- [ ] Save status (`Saving…` / `Saved` / `Error`) is announced via the polite
      `aria-live` region in the shell — listen during a quick edit cycle.
- [ ] Collab connection state (`Live` / `Reconnecting…` / `Offline`) is
      announced when it transitions; errors should escalate to assertive.
- [ ] PWA offline indicator changes state announce ("You are offline" /
      "Back online") without spamming on flapping connections.
- [ ] Toasts / notifications announce once and don't steal focus.

## 6. Forms (sign-in, signup, settings, page header)

- [ ] Every form input has a visible label OR an `aria-label`. SR users
      hear the label before the input value on focus.
- [ ] Required fields have `aria-required="true"` and an `*` is decorative
      (`aria-hidden`).
- [ ] Validation errors are announced (either inline near the field with
      `aria-describedby`, or via an `aria-live="assertive"` region).
- [ ] Sign-in and signup forms pass NVDA / VoiceOver field-by-field reading
      without "edit text" / "edit text" with no name.

## 7. RTL & i18n smoke

- [ ] Set `<html dir="rtl">` via DevTools on the editor, sidebar, and a
      database view. Layout flips cleanly (sidebar on the right, page header
      gutters mirror, lists keep their bullets on the right). Editor caret
      and selection behave correctly for Hebrew/Arabic test strings.
- [ ] Number formatting (database cells, dates in calendar view) survives
      `navigator.language = 'ar'` / `'he'`.

## 8. Reduced motion & forced colors

- [ ] At `prefers-reduced-motion: reduce`, the `tw-animate-css` animations
      (comment-anchor flash, dialog open, etc.) are suppressed.
- [ ] At Windows "Forced Colors" / High Contrast, the app remains usable —
      no `color`-only state cues, focus ring still visible, buttons keep
      their borders.

---

## Reporting

File any failures as issues with the `a11y` label. Include the SR + browser
combination, the screen / interaction, and the expected vs. observed
behavior. Block release on any "critical" or "serious" axe-equivalent
finding; record "minor" findings and triage into the next milestone.
