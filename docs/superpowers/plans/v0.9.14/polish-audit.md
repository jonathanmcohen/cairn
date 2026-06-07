# v0.9.14 Notion-Polish Audit — 20-dimension verdict table

> **Method.** Static code audit against `release/v0.9.14` (as of Plan U authoring). Evidence is `file:line`. All v0.9.11 PATCH items were verified as shipped in `src/`. v0.9.13 Plan C density work was separately verified. Where a verdict depends on runtime visuals it is marked **VERIFY-LIVE**.

## Verdict tally

| Verdict | Count |
|---|---|
| **SHIP-ALREADY** (in code, no work) | 10 |
| **PATCH-NOW** (small className/CSS token win) | 4 |
| **REFACTOR-DEFER** (structural — out of scope for v0.9.14) | 3 |
| **VERIFY-LIVE** (code correct; runtime confirmation only) | 3 |

## 20-row verdict table

| # | Dimension | Verdict | Evidence | Notes |
|---|---|---|---|---|
| 1 | Typography rhythm | **SHIP-ALREADY** | `globals.css:107-108` `--cairn-prose-base: 16px` / `--cairn-prose-leading: 1.6`; `globals.css:182-196` `.ProseMirror h1/h2/h3` heading scale with `-0.01em` tracking — shipped v0.9.11 | Complete. No work. |
| 2 | Sidebar density | **SHIP-ALREADY** | `globals.css:96-97` `--cairn-sidebar-text: 13px` / `--cairn-sidebar-leading: 18px`; `sidebar.tsx:12` `md:flex`; v0.9.13 Plan C (C1/C2/C3) shipped sticky sidebar shell + 30px compact rows + scrollable tree — confirmed | Complete. No work. Cross-ref Plan C. |
| 3 | Color ramp / status tokens | **PATCH-NOW** | `globals.css:82-85` `--color-success`/`--color-warning` tokens exist. Raw survivors in: `suggestions-drawer.tsx:56,68,88,95` uses raw `bg-red-500/10 text-red-700 bg-green-500/10 text-green-700`; `profile-form.tsx:62,67` `text-green-700 text-red-700`; `version-history.tsx:309,311` raw `bg-green-500/15 text-green-700 bg-red-500/15 text-red-700` | Replace raw green/red with `text-success`/`text-destructive` + `bg-success/10`/`bg-destructive/10`. Lock/offline amber banners use scoped classes — leave (intentionally amber brand, not status). |
| 4 | Spacing grid | **SHIP-ALREADY** | Consistent `px-2 py-1/1.5`, `gap-1/2/3`, `p-3/4/8` throughout; `max-w-3xl` editor column; no ad-hoc values found | SHIP. |
| 5 | Top-toolbar consolidation | **VERIFY-LIVE** | `page.tsx:103,118-119` — PageModeToggles joins the same `flex flex-wrap items-center gap-2` action row with code comment "one coherent control group instead of two competing toolbars." Editor control strip `editor.tsx:596` is a separate `mb-1 flex flex-wrap … justify-end` row stacked below. Whether the two rows read as cluttered requires live inspection. | Verify on redeploy. If confirmed cluttered → REFACTOR-DEFER (fold editor strip into page header). |
| 6 | Badge / status-pill consistency | **REFACTOR-DEFER** | No `ui/badge.tsx` exists. Ad-hoc pill styles in: `status-picker.tsx:46,86`; `bibliography-toggle.tsx:76,77`; `editor.tsx:634`. All use `rounded-full border px-2 py-0.5 text-xs` (or `text-[10px]`). Suggestion toolbar lacks a count badge. | Introduce shared `Badge` primitive (variants: `outline`/`solid`/`status`) and migrate 4 callsites. Structural (new component + 4 file migrations) — REFACTOR-DEFER; not a patch. |
| 7 | Block handles | **SHIP-ALREADY** | `drag-handle.tsx:101,111` — both `+` and grip buttons have `transition-colors duration-150` — confirmed shipped v0.9.11 | Complete. No work. |
| 8 | Page-cover hairline | **PATCH-NOW** | `cover-banner.tsx:27-71` — no `border-b` on any cover variant. `.cairn-cover` in `globals.css:379-386` desaturates in light mode but adds no bottom separator. Title sits below the banner in block flow (C5 confirmed no-op for scrim); a 1px `border-b border-border` would prevent the flush white-on-white butt join when a light/white preset is used. | Add `border-b border-border` to `cairn-cover h-[200px] w-full` in `cover-banner.tsx` for all four cover variants (preset/color/unsplash/upload). Single-class change per variant; a11y-safe (decorative). |
| 9 | Approval banner | **SHIP-ALREADY** | `approval-panel.tsx:116` `cairn-approval-banner my-4 rounded-md border p-4`; `globals.css:390-395` tinted via `--warning / 0.1` with warning-colored left accent border — not a giant red card | SHIP. |
| 10 | Microinteractions | **SHIP-ALREADY** | `button.tsx:8` `active:scale-[0.98] motion-reduce:active:scale-100` — confirmed shipped; `globals.css:275-285` `prefers-reduced-motion` honored; `sheet.tsx:40-43` `data-[state=open]:duration-200 data-[state=closed]:duration-150` | Complete. No work. |
| 11 | Empty states | **SHIP-ALREADY** | `variants.tsx:1-112` — all variants confirmed: `EmptySearch` has `<Search />`; `EmptyTrash` has `<Trash2 />`; `EmptyInbox` has `<Inbox />`; `EmptyBacklinks` has `<Link2 />`; `EmptyRecents` has `<Clock />`; `EmptyFavorites` has `<Star />`; `EmptyNotifications` has `<BellOff />` — all 7 icon-sparse variants from v0.9.11 audit were filled. | Complete. No work. |
| 12 | Database view header | **SHIP-ALREADY** | `view-switcher.tsx` — icon-button cluster, Radix Select Add-view picker, `aria-current` active tab, `bg-accent` active state | SHIP. |
| 13 | Selection toolbar grouping | **SHIP-ALREADY** | `editor-bubble-menu.tsx` `SEP` hairline `h-5 w-px bg-border` dividers, `gap-0.5 p-1` dense | SHIP. |
| 14 | Inline mention chips | **SHIP-ALREADY** | `mention.css:1-22` `--primary/0.1` tinted pill, light/dark AA bump, hover `/0.24` | SHIP. |
| 15 | Search / ⌘K palette | **PATCH-NOW** | `search-palette.tsx` — no `animate-in fade-in-0 zoom-in-95 duration-150` on the Command container (mounts instantly); cmdk arrow-nav, `Skeleton` rows for loading state, debounce, focus trap all confirmed | Add `animate-in fade-in-0 zoom-in-95 duration-150` to the `<Command>` container className. One-line class addition; a11y: `prefers-reduced-motion` is already respected by `tw-animate-css` utilities. |
| 16 | Loading skeletons | **SHIP-ALREADY** | `ui/skeleton.tsx` confirmed; `search-palette.tsx:295` uses `<Skeleton>` rows during search; `notifications/drawer.tsx:190-193` uses avatar + text skeleton rows; `cover-picker.tsx:328` uses `<Skeleton>` | Complete. No work. |
| 17 | Hover affordance | **SHIP-ALREADY** | Block handles shipped `transition-colors` (#7); see-also rows `hover:bg-accent/50`; no structural gaps remain beyond what is captured in #7/#10 | SHIP. |
| 18 | Right-rail drawer animations | **REFACTOR-DEFER** | `comments-toggle.tsx:65` `fixed inset-y-0 right-0 z-30 shadow-lg` (no slide); `backlinks-toggle.tsx:30` same; `version-history.tsx:190` same; `suggestions-drawer.tsx:127` same; `notifications/drawer.tsx:164` same. `ui/sheet.tsx:40-43` has `slide-in-from-right duration-200 ease-out` / `slide-out-to-right duration-150`. | Migrate all five `fixed inset-y-0 right-0` rails to `ui/sheet.tsx` (or add `data-[state=open]:slide-in-from-right data-[state=open]:animate-in data-[state=open]:duration-200 data-[state=closed]:slide-out-to-right data-[state=closed]:animate-out data-[state=closed]:duration-150` to each). Structural (requires open/close state machine + Radix Dialog wrapper for each rail) — REFACTOR-DEFER. |
| 19 | Settings double-sidebar | **REFACTOR-DEFER** | `(app)/layout.tsx:69` always renders `<Sidebar>`; `settings/layout.tsx:14` adds `<SettingsSidebar>` inside `<main>` → `/settings/*` shows two left navs. | Suppress workspace `<Sidebar>` when `pathname.startsWith('/settings')` (check `x-pathname` header already available in layout). Requires layout conditional + test; REFACTOR-DEFER (larger than a token change; risk surface for auth/redirect loops). |
| 20 | Mobile-narrow responsive | **VERIFY-LIVE** | `sidebar.tsx:12` `hidden … md:flex` desktop aside; `sidebar-drawer.tsx` `md:hidden` off-canvas drawer with 44px toggle — code is correct for `< 768px` collapse. Runtime overlay z-index + gesture smoothness can't be statically confirmed. | Verify on redeploy at 375px viewport. Expected SHIP-ALREADY after live confirm. |

## Refactor-defer register

These three are explicitly **out of scope for v0.9.14** — they require structural component changes that are not patch-shaped, carry real risk surface, and the audit confirms the rest of the app is otherwise polished:

| Item | Rationale for deferral |
|---|---|
| **R1 — Shared `Badge` primitive** (#6) | Requires new `ui/badge.tsx` + 4 callsite migrations across different component trees. Risk of breaking existing pill spacing/color in dark mode. Worth a dedicated PR in a later release. |
| **R2 — Right-rail slide-in via `Sheet`** (#18) | Five independent rails each need Radix Dialog wrapping or `data-[state]` open/close state. High change surface, potential focus-trap and z-index conflicts with existing panel controller. |
| **R3 — Settings single-sidebar** (#19) | Hiding `<Sidebar>` in `/settings` requires careful pathname-conditional in a server layout, regression risk for redirect flows and 2FA enrollment gate, and must not break `(app)/layout.tsx`'s auth guards. |
