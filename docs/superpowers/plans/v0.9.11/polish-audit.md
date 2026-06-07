# v0.9.11 Notion-Polish Audit — code/token-based

> **Constraint.** This is a *static code/token* audit only (no source changes). The live app cannot be screenshotted: it is LAN-only and the deployed image predates v0.9.10. Where a verdict depends on runtime visuals that code alone can't confirm, it is marked **VERIFY-LIVE** — re-check after `ghcr.io/jonathanmcohen/cairn:v0.9.10` is deployed. Evidence is `file:line` against `main` (= v0.9.10). Rubric applied (ui-ux-pro-max): **44px touch-target floor is hard** — density comes from font/leading, never from shrinking interactive heights; micro-interactions 150–300ms ease-out enter / faster exit; semantic tokens not raw hex; one primary CTA per surface; hairline borders; skeletons for >300ms loads; respect `prefers-reduced-motion`; single accent per surface.

## Verdict tally

| Verdict | Count |
|---|---|
| **SHIP** (already polished) | 6 |
| **PATCH** (token / class) | 9 |
| **REFACTOR** (component change) | 3 |
| **VERIFY-LIVE** | 2 |

## 20-dimension audit

| # | Dimension | Verdict | Evidence (file:line) | Concrete fix |
|---|---|---|---|---|
| 1 | Typography rhythm | **PATCH** | `globals.css:157-159` font stack = `ui-sans-serif, system-ui,…` (no Inter); `editor.tsx:102` `prose prose-sm sm:prose-base`; `page-title-input.tsx:53` title `text-3xl font-semibold`; **no** `prose-headings`/`--tw-prose` override in `globals.css` or `blocks.css` (defaults only) | Body/editor rely on Tailwind-typography defaults — acceptable but loose. Tokenize editor measure + heading scale: add `--cairn-prose-base: 16px / 1.6` and tighten H-scale (H1 1.875rem/600, H2 1.5rem/600, H3 1.25rem/600, all `tracking-[-0.01em]`). Title `text-3xl`→keep but add `tracking-tight`. Font stack is fine (system-ui is the Notion-ish default); do **not** add Inter unless bundled. |
| 2 | Sidebar density | **PATCH** (cross-ref scope #130-revised) | `virtualized-page-tree.tsx:28` `ROW_HEIGHT_PX=30` + `:309` icons `h-4`; `sidebar-footer-nav.tsx:20-21` `NAV_ITEM_CLASS` `min-h-11 … text-sm`; `sidebar.tsx:26` width `var(--cairn-sidebar-w,16rem)` | Already specced in scope §130-revised. Tree row + icon already compact (SHIP-tier). Apply text 14→13 / lh 20→18 / `letter-spacing:0.1px` to page-title spans + utility-link spans (`text-sm`→`text-[13px] leading-[18px]`), keep `min-h-11` (a11y floor). Width 16rem→14rem. **No interactive height reduction.** |
| 3 | Color & contrast | **PATCH** | `globals.css:12-37` neutral ramp = a handful of HSL singletons (no numbered 50–900 ramp); accent blues are **multiple raw hex**: suggest pill uses `bg-primary` (token, good) `suggestion-toolbar.tsx:57`; status pill dots `editor.tsx:86-91` raw `bg-amber-500/emerald-500`; accept/reject `suggestion-toolbar.tsx:123,130` raw `text-green-700/red-700`; cover-banner presets raw CSS; mention.css uses `--primary` (good) | Single-accent discipline mostly holds (suggest/bib/submit all ride `--primary`). Replace raw status colors with tokens: `bg-amber-500`→`bg-warning`, `bg-emerald-500`→`bg-success`, `text-green-700/red-700`→`text-success/text-destructive`. Borders are already `hsl(var(--border))` hairlines (good). Add a `--color-success`/`--color-warning` already exist (`:82-85`) — just reference them. |
| 4 | Spacing grid | **SHIP** | Paddings consistently `px-2 py-1/1.5`, `gap-1/2/3`, `p-3/4/8` across sidebar, editor strip, empty-state; editor column `page-detail-shell.tsx:26` `max-w-3xl` (~768px) | On a 4/8 grid throughout; no ad-hoc values found. Editor measure 768px is ~Notion 708/Linear range — fine. Optional: tighten to `max-w-[720px]` if a narrower measure is wanted, but current is acceptable → SHIP. |
| 5 | Top-toolbar consolidation | **VERIFY-LIVE** | Page header is ONE flex row `page.tsx:103` (icon/title/status/backlinks/mode/actions/menu); editor adds a second strip `editor.tsx:596` (suggest/presence/status/outline). DB views are one row `view-switcher.tsx:153-154` | Header is already a single wrapping row (good). The editor *control strip* + the page *action bar* are two visually separate bars stacked vertically on a page — this is the "two toolbar rows" smell. Whether they read as cluttered depends on live spacing → VERIFY-LIVE; if confirmed, fold the editor status/outline group into the page action bar (REFACTOR, defer). |
| 6 | Status/badge consistency | **REFACTOR** | No `ui/badge.tsx` exists. Ad-hoc pills: status `status-picker.tsx:46,86` `rounded-full border px-2 py-0.5 text-xs`; suggest `suggestion-toolbar.tsx:57` `rounded-full bg-primary`; open-count `:149` `rounded-full border`; bib count `bibliography-toggle.tsx:76` `rounded-full … text-[10px]`; editor status pill `editor.tsx:634` `rounded-full border px-2 py-0.5 text-xs` | ≥5 near-identical-but-divergent pill styles. Introduce a shared `Badge` primitive (variants: `outline`/`solid`/`status`) and migrate all five callsites. Removes drift, enforces single radius/size. |
| 7 | Block handles | **PATCH** | `drag-handle.tsx:90-114` handles are hover-tracked via `mousemove` (only render on hover — good) but buttons have **no transition** (`hover:bg-accent` with no `transition-colors`); `:101,111` | Add `transition-colors duration-150` to the `+` and grip buttons so the hover tint eases in. Hover-only behavior already correct. |
| 8 | Page covers | **PATCH** | `cover-banner.tsx:27-71` flat color / gradient / image, **no** legibility overlay; title sits *below* the banner (`page.tsx:101→103`) not over it, so overlay is not strictly needed; `globals.css:333-338` light-mode desaturate exists | Title is not overlaid on the cover, so the gradient-scrim requirement is moot for legibility. Optional polish: add a subtle bottom inner-shadow / 1px `border-b` under the banner so it doesn't butt flush into white. Low priority PATCH. |
| 9 | Approval banner | **SHIP** | `approval-panel.tsx:115-116` `cairn-approval-banner my-4 rounded-md border p-4`; `globals.css:343-346` tints via `--warning/0.1` + warning border (not a giant red card) | Already a slim, token-tinted banner with a warning left accent — not the "giant red card" anti-pattern. SHIP. |
| 10 | Microinteractions | **PATCH** | `tw-animate-css` imported `globals.css:2`; buttons `ui/button.tsx:8` `transition-colors` (no `active:` press scale); reduced-motion honored `globals.css:275-285`; sheet has slide+fade `ui/sheet.tsx:40-43` | No press feedback. Add `active:scale-[0.98]` (+ `motion-reduce:active:scale-100`) to `buttonVariants` base. Enter timings: sheet uses `animate-in` defaults — pin to `duration-200 ease-out` enter / `duration-150` exit for the 150–300ms target. |
| 11 | Empty states | **PATCH** | `empty-state.tsx:33-52` one card: icon + headline + guidance + **one** CTA (no secondary); `variants.tsx` — `EmptyPageTree/Favorites/FlashcardsDue` have icon+CTA, but `EmptySearch/Trash/Inbox/Backlinks/Recents` lack an icon; `EmptyFlashcardsDue:72` CTA→`/` (the #116 bug) | Coverage is good (8+ variants). Add icons to the 4 icon-less variants for consistency. Optional secondary-CTA slot in `EmptyStateProps` (one primary + one secondary per rubric). The `/`-CTA fix is already in scope as #116. |
| 12 | Database view header | **SHIP** | `view-switcher.tsx:153-228` consistent icon-buttons (`h-4 w-4 opacity-70`), Radix `Select` "+" Add-view picker with disabled+tooltip reasons `:201-219`, active tab `aria-current` + `bg-accent` | Coherent icon-button cluster + view picker already shipped (v0.9.9 #263/#264). Filter/sort live in sibling config components; header itself is clean. SHIP. |
| 13 | Selection toolbar | **SHIP** | `editor-bubble-menu.tsx:34` `SEP` hairline `h-5 w-px bg-border` dividers group bold/color/heading/align/script/comment/link; `:108` `gap-0.5 … p-1` dense | Already grouped with dividers + dense spacing. SHIP. (Color control itself is the separate #127 swatch task.) |
| 14 | Inline mention chips | **SHIP** | `mention.css:1-22` tinted pill `--primary/0.1`, light-mode AA bump `/0.14` `:13-16`, dark `/0.18`, hover `/0.24` | Token-driven, light/dark contrast tuned (#224 J2c). No avatar, but a tinted pill is acceptable. SHIP. |
| 15 | Search palette | **SHIP** | `search-palette.tsx` cmdk arrow-nav (`:222` keydown), `aria-selected:bg-accent` hover highlight `:269`, debounced `:178`, focus mgmt + trap `:77,82-86` | Arrow-nav + hover highlight present. Only gap: **no fade-in** on the palette container (mounts instantly). Minor — could add `animate-in fade-in-0 zoom-in-95 duration-150` → small PATCH, folded into #10. SHIP-leaning. |
| 16 | Loading states | **PATCH** | Spinners everywhere (`grep animate-spin` → two-factor, page-row-actions, automation, cover-picker, notifications drawer); **no** skeletons (only `audio-view.tsx` matched "skeleton" loosely) | Rubric: skeletons for >300ms loads. Search results (`search-palette.tsx:291` "Searching…" text), notifications drawer, see-also panel should use skeleton rows, not bare text/spinners. Add a `ui/skeleton.tsx` (`animate-pulse rounded bg-muted motion-reduce:animate-none`) and use it in the 3 list-load surfaces. |
| 17 | Hover affordance | **PATCH** | Most surfaces have `hover:bg-accent`; gaps: drag-handle buttons lack transition (#7); see-also rows `see-also-panel.tsx:95` have `hover:bg-accent/50` (good); status pill `status-picker.tsx:46` (read-only badge) has none (correct — not interactive) | Mostly covered. The only true gaps are transition-timing (folded into #7/#10). No new structural work. |
| 18 | Right-rail drawers | **REFACTOR** | comments `comments-toggle.tsx:65` `fixed inset-y-0 right-0 … shadow-lg` **no transition**; outline `outline-panel.tsx:34` same; version-history `version-history.tsx:190` same; suggestions-drawer uses Radix `Dialog.Content` `suggestions-drawer.tsx:42` but **no** `data-[state]:slide-*` classes. Only `ui/sheet.tsx` animates, and the rails don't use it | All four rails pop in instantly (no slide). Migrate the rails to `ui/sheet.tsx` (which already has `slide-in-from-right` + `transition`), OR add `data-[state=open]:slide-in-from-right duration-200 ease-out` to each. Most consistent fix = route all four through the shared Sheet primitive (REFACTOR). |
| 19 | Settings nesting | **REFACTOR** | `app/(app)/layout.tsx:69` always renders main `<Sidebar>`; `settings/layout.tsx:13-15` adds a *second* `SettingsSidebar` (`w-48`, `sidebar.tsx:232`) inside `<main>` → on `/settings` there are TWO left navs | Confirmed double-sidebar clutter. Collapse/hide the main workspace `<Sidebar>` when the route is under `/settings` (e.g. conditional in `(app)/layout.tsx` on pathname, or a parallel `settings` route group without the workspace aside). REFACTOR — defer; larger than a token change. |
| 20 | Mobile-narrow responsive | **VERIFY-LIVE** | `sidebar.tsx:11-12` desktop aside `hidden … md:flex` (collapses < md = 768px); `sidebar-drawer.tsx:11,29,48,56` off-canvas drawer `md:hidden` + 44px toggle | Auto-collapse < 768px is correctly wired in code (desktop aside hides, off-canvas drawer takes over). Runtime smoothness/overlay z-index can't be confirmed statically → VERIFY-LIVE; expected SHIP after redeploy. |

## Token deltas (`globals.css` `@theme` / `:root` additions)

```css
/* #2 sidebar density (scope §130-revised) */
--cairn-sidebar-text: 13px;       /* from effective 14px */
--cairn-sidebar-leading: 18px;    /* from 20px */
/* apply: letter-spacing: 0.1px on sidebar body links */

/* #1 editor typography rhythm */
--cairn-prose-base: 16px;
--cairn-prose-leading: 1.6;
/* prose heading scale (apply via prose-h* utilities or a scoped block):
   h1 1.875rem/600, h2 1.5rem/600, h3 1.25rem/600, tracking -0.01em */

/* #3 — no NEW tokens needed: --color-success / --color-warning already exist
   (globals.css:82-85). Just swap raw bg-amber-500/emerald-500 + text-green/red
   for the existing semantic tokens. */

/* #10 micro-interaction timing (used in buttonVariants + sheet) */
/* enter 200ms ease-out, exit 150ms; press: active:scale-[0.98] */
```

Width change (component-level, not a `@theme` token): `sidebar.tsx:26` fallback `16rem → 14rem`.

## Refactor list (structural — component changes)

1. **#6 Shared `Badge` primitive** — new `src/components/ui/badge.tsx` with `outline`/`solid`/`status` variants; migrate 5 ad-hoc pills (status-picker ×2, suggestion-toolbar, bibliography-toggle, editor status pill).
2. **#18 Right-rail slide-in** — route comments / outline / version-history / suggestions rails through `ui/sheet.tsx` (or add `data-[state=open]:slide-in-from-right duration-200 ease-out` to each `fixed inset-y-0 right-0` wrapper).
3. **#19 Collapse main sidebar in `/settings`** — hide the workspace `<Sidebar>` (or use a settings route group) so `/settings` shows a single left nav.
4. *(deferred / VERIFY-LIVE-gated)* **#5 Toolbar consolidation** — only if live confirms the editor strip + page action bar read as two competing toolbars; fold the editor status/outline group into the page action bar.

## Fixes grouped by effort

**Trivial token/class (ship in v0.9.11 — PATCH):**
- #2 sidebar text 14→13 / lh 20→18 / +0.1px tracking (already specced), width 16rem→14rem
- #3 raw status colors → `success`/`warning`/`destructive` tokens
- #7 drag-handle `transition-colors duration-150`
- #10 `active:scale-[0.98]` on buttons + pin sheet enter/exit timings + #15 palette fade-in
- #1 editor prose heading scale + base measure tokens (CSS only)
- #8 cover bottom hairline (optional)
- #11 add icons to 4 icon-less empty-state variants

**Small new primitive (medium — PATCH-able if scoped):**
- #16 `ui/skeleton.tsx` + use in search results / notifications / see-also

**Structural (REFACTOR — defer to a larger pass):**
- #6 Badge primitive + 5 migrations
- #18 rail slide-in via Sheet
- #19 settings single-sidebar

**No work (SHIP):** #4 spacing, #9 approval banner, #12 DB header, #13 selection toolbar, #14 mentions.
**Re-check after deploy (VERIFY-LIVE):** #5 toolbar rows, #20 mobile collapse.
