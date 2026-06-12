# Plan S — sidebar polish (S1–S17, full sidebar overhaul)

> **HOLD until GO.**

Seventeen seeded items, audited against repo evidence before planning. **3 closed
at audit time** (shipped or premise-wrong — table below). **14 open items** land
here. One PR per item off `release/v0.10.2`
(branch `release/v0.10.2-item-<id>-<slug>`).

**i18n rule for every item that adds or changes UI text:** strings go in
`messages/en.json` + `messages/es.json` + `messages/ar.json` — no hardcoded JSX
strings (CI bans them). Items S1, S2, S7, S9, S10, S11, S14 (and S15 if the
hint variant is chosen) all add or change user-visible strings.

## Closed by re-audit — no work (3)

| Id | Verdict |
|----|---------|
| S16 | **SHIPPED — premise error.** Expanding a page with many children CANNOT push the lower utility cluster below the fold: the tree never grows the layout. The two-pane scroll already exists — upper sections group capped at `max-h-[45%] shrink-0 overflow-y-auto` (`sidebar-content.tsx:68-74`), PagesSection `flex min-h-0 flex-1` with the VirtualizedPageTree as "the SOLE scroll container" (`pages-section.tsx:22`, `virtualized-page-tree.tsx:107-109,186`), and SidebarFooterNav sits OUTSIDE both scroll containers as the last flex child (`sidebar-content.tsx:77`) — the utility cluster IS pinned today. Aside is `h-screen md:sticky md:top-0` (`sidebar.tsx:11-12`). |
| S12 | **SHIPPED — premise corrections.** The "device icon" next to Sign out is the ThemeToggle (`sidebar-footer-nav.tsx:120`), which cycles light → system → dark and shows Monitor only in 'system' mode (`theme-toggle.tsx:8,26,28-30`). It is NOT unlabeled: aria-label = current mode + native `title` tooltip 'Switch theme' (`theme-toggle.tsx:9-13,24-25`, `en.json:1097-1100`). It is a `<button>`, not a link — there is nothing to relabel "Devices" or remove; the seed misidentified the theme toggle as a device link. |
| S13 | **SHIPPED — one markup correction.** The version chip already is the proposed pill: `<button>` (not an anchor) with `underline underline-offset-2` rendering `v{version}` from `appVersion()` (`version.ts:7-20`, `package.json:3`), unread dot `data-testid="whats-new-badge"` (`bg-primary`, sr-only twin, `sidebar-footer-nav.tsx:135-140`, `en.json:238`) computed per browser profile via localStorage `'cairn:whats-new-seen'` vs running version (`storage.ts:15-24`). Click opens the in-app WhatsNewPanel (`sidebar-footer-nav.tsx:126-142`) — this IS the "release notes side drawer"; the GitHub release link lives in the panel footer (`panel.tsx:19-23,58`). Dot clears on any dismissal (`sidebar-footer-nav.tsx:47-53`, `storage.ts:26-33`). Reconciled: no second drawer gets built. |

## Order

S17 (reorder) lands **last** — it depends on S10 (the `?` help menu it slots into
the footer) and on the per-section work (S3 dividers, S9 badges) so the slot
spec is written once against the final markup. S2 before S8 (both touch the
26px row contract and `item-H3-sidebar-density-px.spec.ts`). Everything else is
independent.

---

## S1 — collapse + resize (Cmd+\ toggle, 56px rail, 56–400 bounds)

**Audit verdict: PARTIAL.** Resize already exists; collapse toggle does not.
Width is an inline style `width: var(--cairn-sidebar-w, 15rem)`
(`src/components/sidebar.tsx:29`); `SidebarResizeHandle` is a drag + keyboard
(Arrow/Home/End, 16px step) edge handle with `MIN_WIDTH=200, MAX_WIDTH=480,
DEFAULT_WIDTH=240` (`sidebar-resize-handle.tsx:6-16`), persisting per device to
localStorage `'cairn:sidebar-width'` (`sidebar.tsx:33`,
`sidebar-resize-handle.tsx:38-54`). The only hide mechanism is v0.9.x focus
mode: `cairn-focus-mode` root class (`page-mode-shell.tsx:175-181`)
`display:none`s the sidebar via `globals.css:328-347`, with the hover-reveal
hot edge mounting ONLY in focus mode on page-detail routes
(`sidebar-hot-edge.tsx:19-58`, `page-mode-shell.tsx:248-249`). **NO Cmd+\\/Mod+\\
binding exists anywhere** (`app-shortcuts.ts:30-205` and the registry are the
only registerShortcut sites; no backslash key). No standalone collapse state,
no 56px rail.

**Premise corrections:** proposal's min 56 / max 400 do NOT match actual
200/480; default 240 and per-device persistence already match (already
shipped — do not rebuild).

**Gap to build:** (1) `Mod+\` global shortcut in `app-shortcuts.ts` toggling a
persistent collapsed state on ALL routes; (2) a 56px icon-only rail collapsed
visual (vs focus mode's binary `display:none`); (3) clamp bounds
`MIN_WIDTH 200→56`, `MAX_WIDTH 480→400` in `sidebar-resize-handle.tsx`, plus
`aria-valuemin`/`max` and the unit test that pins them. Reuse the existing
`--cairn-sidebar-w` CSS var + localStorage persistence — do NOT rebuild the
drag handle.

**Files:** `src/components/shortcuts/app-shortcuts.ts`,
`src/components/sidebar-resize-handle.tsx`, `src/components/sidebar.tsx`,
`src/app/globals.css`, `messages/{en,es,ar}.json`,
`tests/components/sidebar-resize-handle.test.tsx`.

**Spec:** `tests/e2e/item-S1-sidebar-collapse-resize.spec.ts`.

**Coverage check:** drives the real keyboard event (`Mod+\`) in the browser and
asserts the aside's **computed pixel width** (rail = 56px, restored = prior
width), not class names — a class-only assertion could false-green against a
collapsed class that CSS never applies. RED on main: no backslash binding
exists, so the toggle keypress is a no-op and the width assertion fails.

**Failure modes verified:**

- `Mod+\` on a NON-page-detail route (e.g. `/inbox`) collapses to a 56px rail —
  the focus-mode-only gap is the bug being closed.
- Toggle again restores the **previous custom width** (resize to 320 first),
  not the 240 default.
- Collapsed state survives reload (per-device persistence).
- Drag below 56 clamps at 56; drag/`End` above 400 clamps at 400;
  `aria-valuemin/max` report 56/400.
- Focus mode entered + exited while collapsed does not desync the collapse
  state (the two hide mechanisms stay independent).
- Updated unit test still pins `DEFAULT_WIDTH=240` (unchanged contract).

## S2 — density preference (compact vs comfortable, Account → Theme)

**Audit verdict: GAP.** No density preference exists anywhere.
**Premise errors — actual measured values:** tree row height is **26px, not
36px** (`ROW_HEIGHT_PX = 26`, `density-tokens.ts:9`, comment 'Compact dense row
(#208)'; fed to the virtualizer at `virtualized-page-tree.tsx:165-175` and
applied per-row at `:191-198`). Row font is **13px/18px leading, not 12px**
(`--cairn-sidebar-text: 13px` / `--cairn-sidebar-leading: 18px`,
`globals.css:90-101`, consumed at `virtualized-page-tree.tsx:268`). Settings →
Account → Theme offers ONLY Accent, Font family, Page width
(`theme-form.tsx:82-165`); `ThemePrefsSchema` has only
accent/fontFamily/pageWidth (`presets.ts:36-45`) and `user_theme_prefs` has no
density column (`user-theme-prefs.ts:9-18`).

**Premise correction (blocks the proposed numbers):** "comfortable/current" is
actually **13px font / 26px rows** — already compact-leaning per #208 — so the
proposed compact "10px/28px" would be **larger rows with smaller text than
today**. Per scope, comfortable = the audit's actual values (13px/26px).
**GO-gate decision:** corrected compact values — suggested 12px font / 22px
rows (proportional shrink); confirm at GO.

**Gap to build:** the whole preference — a Sidebar density toggle in
`theme-form.tsx` alongside Accent/Font/Page width; persistence (density column
on `user_theme_prefs` + migration + `/api/settings/theme` PATCH, or
localStorage per-device — scope says per-device, so **localStorage**, matching
S1's sidebar-width precedent, no migration); wiring that swaps `ROW_HEIGHT_PX`
and the `--cairn-sidebar-text`/`--cairn-sidebar-leading` tokens. Update the
density guard tests that pin the 26px contract
(`tests/components/sidebar-density-tokens.test.ts`,
`tests/e2e/item-H3-sidebar-density-px.spec.ts`,
`tests/components/sidebar-compact-rows.test.tsx`).

**Files:** `src/app/(app)/settings/account/theme/theme-form.tsx`,
`src/lib/themes/presets.ts`, `src/components/sidebar/density-tokens.ts`,
`src/app/globals.css`, `src/components/sidebar/virtualized-page-tree.tsx`,
`messages/{en,es,ar}.json`, `tests/e2e/item-H3-sidebar-density-px.spec.ts`
(`src/db/schema/user-theme-prefs.ts` + `drizzle/migrations/` only if GO flips
persistence to server-side).

**Spec:** `tests/e2e/item-S2-sidebar-density.spec.ts`.

**Coverage check:** toggles the setting through the real Settings → Account →
Theme UI, then measures **runtime row pixel height** in the sidebar tree (the
H3 lesson: px guards must measure rendered rows, not token constants), reloads,
and re-measures. Can't false-green: a setting that writes state but never
reaches the virtualizer's `estimateSize` or the CSS tokens fails the px
assertion. RED on main: no density control exists in the form.

**Failure modes verified:**

- Compact selected → rendered row height changes 26px → compact value, and the
  virtualizer's spacing matches (no overlapping/gapped rows after toggle).
- Comfortable re-selected → exactly 13px font / 26px rows (the corrected
  baseline, asserted numerically).
- Preference survives reload on the same device.
- `item-H3-sidebar-density-px.spec.ts` updated to assert per-density contracts
  — it must NOT keep pinning an unconditional 26px (that would go red) and must
  NOT be deleted (that would unguard the contract).

## S3 — 1px dividers between conceptual groups

**Audit verdict: PARTIAL.** Zero 1px dividers exist between the nav's
conceptual groups — separation is margin only: search pill `mb-1`
(`search-hint-button.tsx:27`), Pinned `mb-3` (`pinned-section.tsx:48`),
Favorites `mb-1.5` (`sidebar-favorites.tsx:108`), Recents `mb-1.5`
(`sidebar-recents.tsx:15`), Saved searches `mb-2` (`saved-searches.tsx:85`),
and no border between the 45%-capped upper scroll group
(`sidebar-content.tsx:67-76`) and PagesSection. The only existing 1px dividers
are structural: header `border-b` (`sidebar-content.tsx:45`), footer `border-t`
(`sidebar-footer-nav.tsx:55`), sign-out `border-t`
(`sidebar-footer-nav.tsx:106`) — already shipped, do not rebuild.

**Gap to build:** dividers between the in-nav groups (search pill / Pinned /
Favorites / Recents / Saved searches / Pages) — none exist. Conditional-render
wrinkle: Pinned/Favorites/Recents/SavedSearches each return null when empty, so
dividers must not stack when adjacent groups vanish — favor `border-t` on each
section with `first:border-t-0`, or `divide-y` on the container.

**Files:** `src/components/sidebar-content.tsx`,
`src/components/sidebar/pinned-section.tsx`,
`src/components/sidebar-favorites.tsx`, `src/components/sidebar-recents.tsx`,
`src/components/sidebar/saved-searches.tsx`.

**Spec:** `tests/e2e/item-S3-sidebar-group-dividers.spec.ts`.

**Coverage check:** seeds a workspace with ALL groups populated and asserts a
computed 1px border between each adjacent pair, then re-runs with
Pinned/Favorites/Recents empty and asserts no doubled/stranded dividers.
Computed-style assertions in the real browser — a `divide-y` that Tailwind
never emits (e.g. wrong container) would fail; a class-name grep would not
catch that. RED on main: no inter-group borders exist.

**Failure modes verified:**

- All six groups populated → exactly one 1px divider at each group boundary,
  including upper-group ↔ PAGES.
- Pinned + Favorites + Recents all empty → no double divider between search
  pill and Saved searches (the null-return stacking bug).
- Single populated group → no orphan divider above the first visible group.
- Existing structural dividers (header/footer/sign-out) unchanged.

## S4 — section headers → 10px tracked uppercase at 60% opacity

**Audit verdict: PARTIAL.** **Premise error:** "12px regular weight" is wrong
for 3 of 5 headers, and all headers are ALREADY tracked uppercase. Measured:
PAGES = `text-[11px] uppercase tracking-wide text-muted-foreground`
(`pages-section.tsx:27-32`); SAVED SEARCHES = same 11px
(`saved-searches.tsx:88-90`); Favorites = `text-xs` 12px
(`sidebar-favorites.tsx:111`); Recents = `text-xs` 12px
(`sidebar-recents.tsx:18`); Pinned = `text-xs font-semibold` 12px **SEMIBOLD**
(`pinned-section.tsx:49`). Dimming is via the `muted-foreground` token at full
opacity — no opacity utility anywhere. `globals.css:90-97` documents 'Section
labels stay at 12px (text-xs)' — already stale for the two 11px headers.

**Gap to build:** uppercase + tracking is shipped — do not rebuild. Delta:
(1) unify the 11px/12px mix to `text-[10px]` on all five headers; (2) add 60%
opacity (`text-muted-foreground/60` or `opacity-60`); (3) GO-gate decision:
does Pinned keep its outlier `font-semibold`; (4) fix the stale 12px comment at
`globals.css:93` and tokenize the header size next to `--cairn-sidebar-text`.

**Files:** `src/components/sidebar/pages-section.tsx`,
`src/components/sidebar/saved-searches.tsx`,
`src/components/sidebar-favorites.tsx`, `src/components/sidebar-recents.tsx`,
`src/components/sidebar/pinned-section.tsx`, `src/app/globals.css`.

**Spec:** `tests/e2e/item-S4-sidebar-section-headers.spec.ts`.

**Coverage check:** asserts computed `font-size: 10px` and effective 60%
opacity (computed color alpha or opacity) on ALL five headers in the rendered
sidebar — catches the 11px/12px stragglers a single-header check would miss.
RED on main: headers measure 11px/12px at full opacity.

**Failure modes verified:**

- Each of the five headers (Pinned, Favorites, Recents, Saved searches, Pages)
  measures 10px — no header left behind on the old mixed sizes.
- Opacity/alpha is 0.6 at rest on every header.
- `text-transform: uppercase` + letter-spacing still present (no regression of
  the shipped treatment).
- Pinned's weight matches the GO decision (asserted explicitly either way).

## S5 — PAGES header action icons: 30% at rest, 100% on section hover

**Audit verdict: GAP.** Both PAGES section-header action icons are always
visible at full opacity: the collapse/expand-all toggle (`h-6 w-6`, no opacity
utility, `pages-section.tsx:34-48`) and NewPageButton (`h-11 w-11`, no opacity
utility, `new-page-button.tsx:36-46`). The header container
(`pages-section.tsx:23-50`) has no `group` class — no section-hover reveal
mechanism exists. The hover-reveal pattern
(`opacity-0 focus:opacity-100 group-hover:opacity-100`) exists today only on
ROW-level actions — Favorites drag handle (`sidebar-favorites.tsx:163`) and
remove button (`sidebar-favorites.tsx:182`). PAGES is the only section with
header action buttons.

**Gap to build:** entire proposal — add `group` (or `group/pages`) to the
section/header container, then `opacity-30` + `group-hover:opacity-100` +
`focus-visible:opacity-100` on the collapse-all Button and NewPageButton.
NewPageButton is reused outside the sidebar header (takes `parentId`), so the
dimming class is passed in from pages-section via a className prop merge — not
hard-coded in NewPageButton.

**Files:** `src/components/sidebar/pages-section.tsx`,
`src/components/new-page-button.tsx`.

**Spec:** `tests/e2e/item-S5-pages-header-icon-reveal.spec.ts`.

**Coverage check:** hover-gated UI cannot be verified by static DOM greps (the
B2/#117 lesson in `docs/operations.md`): the spec hovers the real section and
measures computed opacity before/during hover, and tabs to the buttons for the
keyboard path. RED on main: opacity is 1 at rest.

**Failure modes verified:**

- At rest both icons measure opacity 0.3; hovering anywhere in the PAGES
  section raises both to 1.0.
- Keyboard `Tab` onto each button → opacity 1.0 without mouse (a hover-only
  reveal that strands keyboard users fails here).
- Buttons remain DOM-mounted and clickable at rest (dimmed, not `display:none`
  — add-subpage still works without hovering first).
- NewPageButton rendered at its OTHER call sites is NOT dimmed (className is
  injected by pages-section only).

## S6 — workspace switcher chip: real image when icon set; accent letter when unset

**Audit verdict: PARTIAL.** The trigger chip and dropdown row badges render a
5×5 (`h-5 w-5` = 20px, matching the proposed 20×20) span wrapping
`<InlineIcon value={icon} fallback={initial(name)} />`
(`workspace-switcher.tsx:62-68`, rows `:96-101`). InlineIcon branches
(`page-icon-inline.tsx:34-42`): empty → letter initial; `emoji::` → **renders
the actual emoji**; `file::<uuid>` → a generic lucide ImageIcon placeholder,
never the uploaded image (signed-URL resolution is server-only,
`page-icon-inline.tsx:15-18`). The icon picker DOES support upload
(`icon-picker.tsx:36-44`, wired at `settings-form.tsx:90`). The letter fallback
is `bg-muted text-muted-foreground` — **no accent-color letter chip exists**
(`workspace-switcher.tsx:62-68,96-101`).

**Premise correction:** emoji icons DO render distinctly — the
"identical fallback" problem is real only for **file-backed (uploaded) icons**,
which all render the same generic ImageIcon glyph.

**Gap to build:** (1) resolve `file::` workspace icons to signed image URLs
server-side (in `sidebar-content.tsx` / `lib/workspaces/list.ts`, following the
PageIconRender RSC pattern referenced at `page-icon-inline.tsx:18`) and render
the actual image in trigger + row chips; (2) restyle the letter fallback from
`bg-muted/text-muted-foreground` to the accent-colored treatment. Emoji path
and the 20px chip size need no work.

**Files:** `src/components/workspace-switcher.tsx`,
`src/components/sidebar-content.tsx`, `src/lib/workspaces/list.ts`.

**Spec:** `tests/e2e/item-S6-workspace-switcher-chip.spec.ts`.

**Coverage check:** uploads a real file icon via workspace settings, then
asserts the switcher trigger contains an `<img>` whose `src` is a signed
`/api/files` URL that actually loads (response 200) — a spec that only checks
"some icon node exists" would false-green on the current ImageIcon placeholder.
RED on main: the chip renders the lucide placeholder, no `<img>`. Through the
proxy (signed-URL reads are gated there — the F1 lesson).

**Failure modes verified:**

- File-backed icon → trigger chip AND dropdown row chip render the uploaded
  image (loaded, not broken-src).
- Emoji icon → emoji still renders (no regression of the working branch).
- No icon → single-letter chip with accent background (computed
  background-color ≠ the muted token).
- Two workspaces with different uploaded icons are visually distinct in the
  dropdown (the original complaint).

## S7 — search pill: drop the "(command palette)" parenthetical

**Audit verdict: GAP.** Label is 'Search or jump to… (command palette)' under
key `searchHint.label` (`messages/en.json:163`); aria-label `searchHint.aria` =
'Open command palette' (`en.json:164`). The label span (`flex-1 text-left`,
`search-hint-button.tsx:30`) has NO truncate/nowrap inside a `min-h-[36px]`
button — at the default 240px width the 37-char string needs ~230px but gets
~150px, so it wraps to a second line (claim consistent with code;
`sidebar.tsx:29`, `sidebar-resize-handle.tsx:14`, `globals.css:96`). The ⌘K kbd
chip is `search-hint-button.tsx:31-33`.

**Gap to build:** shorten `searchHint.label` to 'Search or jump to…' (the
aria-label already says 'Open command palette') and/or add `truncate` to the
span at `search-hint-button.tsx:30`. Preserve the v0.9.4 #97 intent documented
at `search-hint-button.tsx:11-13` (the pill must still read as the palette):
keep the ⌘K kbd + aria-label. Update **all three** locale files.

**Files:** `src/components/search-hint-button.tsx`,
`messages/{en,es,ar}.json`.

**Spec:** `tests/e2e/item-S7-search-pill-label.spec.ts`.

**Coverage check:** asserts the rendered pill is single-line at the 240px
default width by measuring the button's rendered height (one 13px line, not
two) — a string-only assertion could false-green while the es/ar strings still
wrap. Also asserts aria-label retained and clicking opens the palette. RED on
main: the button renders two text lines.

**Failure modes verified:**

- Pill height = single line at 240px sidebar width.
- Visible label contains no '(command palette)'.
- `aria-label` still 'Open command palette' (the #97 intent survives).
- ⌘K kbd chip still rendered; click still opens the Cmd+K palette.
- es/ar locales: pill stays single-line (truncate guard for longer
  translations).

## S8 — pages tree polish (DnD indicators, child count, per-row affordances)

**Audit verdict: PARTIAL.** Sub-claim audit of
`src/components/sidebar/virtualized-page-tree.tsx` (windowed flat list,
server-flattened): (a) drag-and-drop insertion indicator — **DOES NOT EXIST**;
the page tree has zero DnD (the only sidebar DnD is Favorites @dnd-kit
reorder, `sidebar-favorites.tsx:113-121`; tree moves go through the 'Move to'
dialog, `page-row-actions-menu.tsx:80-85`). (b) per-row add-subpage '+' —
**EXISTS**, hover-revealed (`page-row-actions-menu.tsx:38-57`, cluster
`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` at
`virtualized-page-tree.tsx:322-325`, stays DOM-mounted). (c) child count badge
next to chevron — **DOES NOT EXIST**, and the premise is off: PAGE rows have NO
chevron at all (no per-page collapse; subtree always rendered flat with depth
indentation, rows `:253-334`); chevrons exist only on SPACE-HEADER rows
(`:216-220`); `FlatPageNode` has no childCount/hasChildren (`tree.ts:56-66`).
(d) long-title tooltip — **EXISTS** via native `title` attr
(`virtualized-page-tree.tsx:318`, space headers `:224`). (e) drop-target
reparent indent visual — **DOES NOT EXIST** (no DnD at all). (f) page icon —
already sits in a **16px box** (`h-4 w-4`, `:315`; emoji glyph at `text-sm`
14px inside it; fallback FileText `h-4 w-4`, `:27`). Context: 26px rows, 16px
per-depth indent (`density-tokens.ts:9-10`).

**Premise corrections:** the '+' add-subpage already ships (hover-revealed),
the title tooltip already ships (native), and the icon box is already 16px —
none of these get rebuilt. Per scope ("use audit's actual size") (f) is a
no-op; (b)'s only delta is reveal mode: persistent at 30% opacity instead of
`opacity-0` hover-reveal. (d) stays native-title unless GO upgrades it.

**Gap to build:** (a)+(e) tree DnD (@dnd-kit, already a dep via Favorites) with
a between-siblings insertion line and a reparent indent/highlight visual at the
16px indent step, plus a move/reorder API call from the drop handler; (c) add
`hasChildren`/`childCount` to `FlatPageNode` in the flatten query
(`src/lib/pages/tree.ts`, `/api/pages/tree`) and render a per-page chevron +
count badge; (b) switch the row action cluster from `opacity-0` to
`opacity-30` at rest (keep `group-hover`/`group-focus-within` 100%).

**Files:** `src/components/sidebar/virtualized-page-tree.tsx`,
`src/components/sidebar/density-tokens.ts`, `src/lib/pages/tree.ts`,
`src/components/sidebar/use-page-row-actions.tsx`,
`src/app/api/pages/tree/route.ts`, `messages/{en,es,ar}.json`,
`tests/e2e/item-H3-sidebar-density-px.spec.ts`.

**Spec:** `tests/e2e/item-S8-tree-dnd-and-badges.spec.ts`.

**Coverage check:** drives a real pointer drag in the virtualized list (mouse
down → move over a sibling gap → assert the insertion line is visible → drop),
then **reloads and asserts the persisted order** — asserting only the visual
indicator would false-green if the drop handler never hits the move API.
Reparent path drops ONTO a row and asserts both the indent highlight during
drag and the new `parent_id` after reload. RED on main: rows are not draggable
at all.

**Failure modes verified:**

- Drag between siblings shows the insertion line at the correct gap; drop
  reorders; order survives reload (server persisted, not local state).
- Drag onto a row shows the reparent indent indicator; drop reparents; child
  appears under the new parent at +16px indent after reload.
- Child count badge renders next to the new per-page chevron and increments
  after adding a subpage via the '+'.
- '+' cluster measures opacity 0.3 at rest, 1.0 on row hover AND on keyboard
  focus-within (no regression of the focus-reachability the audit confirmed).
- Drag in the VIRTUALIZED list across a scroll boundary does not drop on the
  wrong row (windowing offset bug class).
- Native `title` tooltip still present on truncated titles (no regression).
- Row height stays on the density contract
  (`item-H3-sidebar-density-px.spec.ts` still green or updated with S2).

## S9 — personal-hub badges (Review due, Inbox, My tasks, Favorites star)

**Audit verdict: PARTIAL.** REVIEW DUE: badge **exists** — ReviewDueCounter
fetches `/api/flashcards/due` once on mount and renders an always-`bg-primary`
pill (`review-due-counter.tsx:15-43`); the row unmounts at count 0 (`:32`);
**NO overdue-specific color exists**. INBOX: plain link
(`sidebar-footer-nav.tsx:62-65`), **NO unread indicator of any kind**; the
inbox feature has no unread concept at all (grep of `src/components/inbox`
returned nothing); the only unread count in the app is the global-HEADER bell
(`bell.tsx:24-52`, polls `/api/notifications/unread-count` every 30s). MY
TASKS: plain link (`sidebar-footer-nav.tsx:66-69`), **NO count badge**.
FAVORITES: footer row star has no color class (`sidebar-footer-nav.tsx:58-61`,
`:33-34`); **no gold/yellow/amber/fill styling exists in any sidebar file**
(grep returned zero hits) and no count is passed to the footer.

**Gap to build:** (1) overdue color — `/api/flashcards/due` (or a new field)
must distinguish overdue vs due-today, then conditional red/destructive vs
blue/primary on `review-due-counter.tsx:43`; (2) Inbox unread — no data model
exists; needs a count source (new endpoint or reuse of notifications
unread-count — GO decision) plus a **right-edge count pill** (per scope: not an
avatar dot) on the Inbox row; (3) My-tasks open-count endpoint + right-edge
pill; (4) Favorites star gold (`text-yellow-500 fill-current` or token
equivalent) when count > 0 — SidebarContent must pass `favorites.length` down
(the footer currently receives no favorites count prop).

**Files:** `src/components/sidebar-footer-nav.tsx`,
`src/components/sidebar/review-due-counter.tsx`,
`src/components/sidebar-favorites.tsx`, `src/components/sidebar-content.tsx`,
`src/app/api/notifications/unread-count/route.ts` (or new count endpoints),
`messages/{en,es,ar}.json`.

**Spec:** `tests/e2e/item-S9-personal-hub-badges.spec.ts` (+ integration tests
for the new/changed count endpoints — endpoint logic is unit-testable in
`src/lib`, but the badge wiring must be proven in the browser).

**Coverage check:** seeds real data (an overdue flashcard, a due-today
flashcard, inbox items, open tasks, one favorite) and asserts each badge's
rendered count AND computed color in the sidebar — color assertions distinguish
the overdue/destructive path from today's unconditional `bg-primary`, which a
"badge exists" check would false-green on. RED on main: overdue renders
primary-colored; Inbox/My-tasks rows have no badge; star has no fill.

**Failure modes verified:**

- Overdue card present → Review-due badge is the red/destructive treatment;
  ONLY due-today cards → blue/primary treatment.
- Zero due → Review-due row still unmounts (no regression of `:32`).
- Inbox unread > 0 → right-edge count pill (explicitly NOT a corner/avatar
  dot — assert position); zero → no pill.
- My tasks: count matches seeded open tasks; completing one (via UI) and
  re-rendering drops the count.
- Favorites star: gold fill with ≥1 favorite; default color at 0 (remove the
  favorite, assert reset).
- Badge counts have sr-only/aria text from messages (no bare numeric-only
  buttons for screen readers).

## S10 — sidebar slot diet (Templates → Cmd-K; Replay tour → "?" help menu)

**Audit verdict: PARTIAL.** Templates row: permanent slot
(`sidebar-footer-nav.tsx:70-73`, `en.json:224`). Replay tour row: permanent
slot (`sidebar-footer-nav.tsx:91-100`, `en.json:1184`) — CAVEAT: it doubles as
the onboarding tour's last-step anchor `[data-tour="help"]`
(`tour/steps.ts:51`). Cmd-K Templates action: **SHIPPED** — palette action
`nav.templates` 'Open templates gallery' pushes `/templates`
(`palette/actions.ts:73-77`, rendered at `search-palette.tsx:335-361`) — zero
work. Footer '?' help menu: **DOES NOT EXIST** (only HelpCircle usage in src/
is the Replay-tour button itself); nearest surface is the keyboard-only `?`
shortcuts sheet (`dispatcher.tsx:60-69`, `sheet.tsx:43-47`), no footer button.

**Gap to build:** remove both permanent rows. Precondition already met for
Templates (palette action shipped — do not rebuild). Build the footer '?' help
button + menu housing at minimum Replay tour — plausibly also the existing
shortcuts sheet and the What's-new panel (GO decision on menu contents).
Re-anchor the tour's final step `[data-tour="help"]` (`tour/steps.ts:51`) onto
the new help button — removing the row without re-anchoring breaks the tour.

**Files:** `src/components/sidebar-footer-nav.tsx`,
`src/components/tour/steps.ts`, `messages/{en,es,ar}.json`.

**Spec:** `tests/e2e/item-S10-sidebar-slot-diet.spec.ts`.

**Coverage check:** asserts the absence of both rows AND exercises both
fallbacks end-to-end: Cmd-K → 'Open templates gallery' → lands on `/templates`;
'?' button → menu → Replay tour → the tour actually starts (the
`cairn:start-tour` event has an observable first step). Crucially it runs the
onboarding tour through to its FINAL step — the spec that would false-green is
one that checks the rows are gone but never notices the tour's last-step anchor
now dangles. RED on main: both rows present / no '?' footer button.

**Failure modes verified:**

- Templates row absent from the footer; `/templates` still reachable via the
  palette action (real navigation asserted).
- Replay-tour row absent; '?' menu contains Replay tour; clicking it starts
  the tour.
- Onboarding tour runs to its last step and the spotlight anchors on the new
  '?' button (`[data-tour="help"]` re-anchored, not 404'd).
- '?' menu is keyboard-operable (open with Enter, items focusable).
- The bare-`?` keyboard shortcut still opens the shortcuts sheet (no
  dispatcher regression).

## S11 — sign-out confirm dialog (#80 hardening)

**Audit verdict: GAP.** No confirm dialog on sign-out anywhere: the sidebar
footer Sign out is a bare `<form action={signOutAction}>` — one click signs out
(`sidebar-footer-nav.tsx:106-121`); the settings/security sessions card has the
identical pattern (`sessions-card.tsx:110-131`); `signOutAction` calls Auth.js
`signOut({ redirectTo: '/login' })` with no guard (`sign-out-action.ts:1-18`).
Note: #80 itself (sign-out broken ~16 releases, CSRF-less POST) **IS fixed**
via the Server Action (`sidebar-footer-nav.tsx:107-108`,
`sign-out-action.ts:5-14`) — only the confirm-dialog hardening remains; do not
re-fix sign-out. A reusable confirm primitive already exists:
`useConfirm()`/`ConfirmProvider` (`confirm-dialog.tsx:30-58`, provider in
`src/app/layout.tsx`, used by ~10 destructive flows) — reuse it, do not build a
new dialog.

**Gap to build:** confirmation at BOTH call sites: client-side intercept
(onSubmit preventDefault → `await useConfirm()` with "Sign out of `<email>`?
[Cancel] [Sign out]" → programmatic submit / call the action) + i18n strings
(`sidebar.signOutConfirm.*`) in all three locales. Per scope: a real dialog,
**NOT shift-click**.

**Files:** `src/components/sidebar-footer-nav.tsx`,
`src/components/security/sessions-card.tsx`, `messages/{en,es,ar}.json`.

**Spec:** `tests/e2e/item-S11-signout-confirm.spec.ts`.

**Coverage check:** the Cancel path must prove the session SURVIVED (navigate
to an authed route after cancelling, assert not redirected to /login) and the
confirm path must prove it ENDED (redirected to /login, authed route bounces) —
asserting only "a dialog appeared" would false-green a dialog that signs out
regardless of choice. RED on main: clicking Sign out logs out immediately with
no dialog. Runs through the proxy (auth state is the thing under test).

**Failure modes verified:**

- Sidebar Sign out → dialog shows the signed-in user's actual email → Cancel →
  still authenticated.
- Confirm → signed out, at /login, authed routes redirect.
- Same two paths on Settings → Security sessions card (the second call site is
  the one a single-site spec would miss).
- Escape closes the dialog without signing out.
- No shift-click bypass: shift+click still opens the dialog.
- Regression guard: confirmed sign-out still works end-to-end (the #80 Server
  Action path stays green).

## S14 — workspace-level Live indicator in the footer

**Audit verdict: GAP.** No workspace-level collab-health indicator exists; the
footer (`sidebar-footer-nav.tsx:54-149`) has nav links, Sign out, ThemeToggle,
version chip only. The only collab-health surfaces are page-scoped: the Live
pill in the page-header toolbar (`editor.tsx:673-679`; labels `STATUS_LABEL`
{connecting/connected/disconnected/error → 'Connecting…'/'Live'/
'Reconnecting…'/'Offline'} at `editor.tsx:81-86`; dot colors `STATUS_DOT` at
`:90-95`) and the per-page CollabOfflineBanner (`editor.tsx:699`). The status
source `useCollabDoc` is PER-PAGE — token minted per pageId
(`use-collab-doc.ts:63-147`, fetch at `:99`), one HocuspocusProvider's
onStatus/onDisconnect (`:120-129`) — it cannot be reused as-is at workspace
level. The topbar OfflineIndicator is NOT collab health — it tracks
`navigator.onLine` only (`offline-indicator.tsx:10-21`,
`offline-context.tsx:13-26`). **Premise-adjacent finding:** the Live pill
strings are hardcoded English in `editor.tsx:81-86`, not in `messages/en.json`.

**Gap to build:** a footer pill matching the page-header Live pill (reuse the
`STATUS_LABEL`/`STATUS_DOT` maps and dot+label markup from
`editor.tsx:81-95,673-679`). Requires a new health source — GO decision: lift
the active editor's CollabStatus into a shared context (footer mirrors the open
page; idle/no-page state needed) vs a workspace-scoped probe of the collab
endpoint (status without an open page). Move the status labels into
`messages/{en,es,ar}.json` — fixing the existing hardcoded-English violation in
the same PR (CI bans hardcoded JSX strings).

**Files:** `src/components/sidebar-footer-nav.tsx`,
`src/components/editor/use-collab-doc.ts`,
`src/components/editor/editor.tsx`, `messages/{en,es,ar}.json`.

**Spec:** `tests/e2e/item-S14-footer-live-indicator.spec.ts`.

**Coverage check:** asserts the footer pill against a REAL collab connection
lifecycle: open a page → both the page-header pill and the footer pill show
'Live'; block the collab websocket (route interception) → footer pill degrades
to 'Reconnecting…'/'Offline' — a spec that only checks the pill renders would
false-green a hardcoded-'Live' badge. RED on main: no footer pill exists.

**Failure modes verified:**

- Connected: footer pill reads Live with the success dot, matching the
  page-header pill state.
- Collab transport blocked → footer pill flips to the degraded state (it
  tracks reality, not a static label).
- Defined idle behavior on non-editor routes (per the GO decision: last-known /
  probe / hidden — asserted explicitly).
- Pill labels come from messages (en assertion + es/ar keys exist) — the
  editor's previously hardcoded strings included.
- navigator.onLine offline (PWA indicator) and collab-offline remain distinct
  signals (toggling one doesn't fake the other).

## S15 — empty states: SAVED SEARCHES + PINNED

**Audit verdict: PARTIAL.** Both audited behaviors are already answered:
SAVED SEARCHES hides its ENTIRE section (header included) at zero items
(`saved-searches.tsx:82` 'if (items.length === 0) return null;'; fetch +
mutation-bus reload at `:29-43`; silent unmount on fetch error too). PINNED
renders when admin pins exist (`pinned-section.tsx:28-45,47-69`) and is placed
ABOVE PAGES in the upper scroll group (`sidebar-content.tsx:67-75`); when empty
it returns null and collapses to zero pixels (documented at
`pinned-section.tsx:22-24`, guard `:45`). Neither has an empty-state
placeholder; the empty-state library (`empty-state/variants.tsx:15-124`) has no
saved-searches/pins variants. Note: both sections are client-fetched and pop in
after hydration (minor layout shift).

**Scope mapping:** the scope's first alternative — "hidden until first save" —
**is the shipped behavior**, and "PINNED above PAGES when pins exist" is also
shipped. **GO-gate decision:** accept hide-when-empty (then this item is a
guard spec only — do NOT rebuild the shipped behavior) vs build the dim-hint
variant (new `EmptySavedSearches`/`EmptyPinned` variants in
`empty-state/variants.tsx` wired into both components, plus deciding whether
non-admins ever see an empty Pinned hint, plus hint strings in all three
locales).

**Files:** `src/components/sidebar/saved-searches.tsx`,
`src/components/sidebar/pinned-section.tsx`,
`src/components/empty-state/variants.tsx`,
`src/components/sidebar-content.tsx`, `messages/{en,es,ar}.json` (last three
only if the hint variant is chosen).

**Spec:** `tests/e2e/item-S15-sidebar-empty-states.spec.ts` (guard — no RED
"before" if GO accepts hide-when-empty, per the guard convention).

**Coverage check:** drives the lifecycle, not a snapshot: zero saved searches →
assert no header in the DOM; save a search through the real UI → section
appears WITHOUT reload (the mutation-bus path, which a static seeded-state
check would never exercise); pin/unpin as admin → PINNED appears above the
PAGES tree (DOM order assertion) and collapses on unpin.

**Failure modes verified:**

- Zero saved searches → no 'SAVED SEARCHES' header rendered (not an empty
  header).
- Saving a search makes the section appear live (mutation-bus subscription, no
  reload).
- Admin pins a page → PINNED renders above PAGES (explicit DOM-order check);
  unpinning the last pin unmounts it to zero pixels.
- Fetch failure → section stays unmounted (no broken half-rendered header).
- If GO picks the hint variant: hint renders at zero items with the dim
  treatment, from messages keys, and the admin/non-admin visibility decision is
  asserted.

## S17 — slot reorder (top → bottom)

**Audit verdict: GAP.** Current order (audited at `sidebar-content.tsx:43-79`,
same body reused by the mobile drawer): 1. header block `border-b p-1` —
optional workspace brand logo (`:46-54`) + WorkspaceSwitcher (`:55`); 2. `<nav>`
— upper 45%-capped scroll group (`:68`) containing SearchHintButton (`:69`) →
PinnedSection (`:70`) → SidebarFavorites (`:71`) → SidebarRecents (`:72`) →
SavedSearches (`:73`), then PagesSection (`:75`); 3. SidebarFooterNav (`:77`),
internal order (`sidebar-footer-nav.tsx`): ReviewDueCounter (`:56`), StudyLink
(`:57`), Favorites (`:58-61`), Inbox (`:62-65`), My tasks (`:66-69`), Templates
(`:70-73`), Settings (`:74-77`), Archived (`:81-84`), Trash (`:85-88`),
Help/replay-tour (`:91-100`), divider + Sign out + ThemeToggle (`:106-121`),
version chip (`:126-142`). 4. SidebarResizeHandle, absolute, out of flow
(`sidebar.tsx:25-35`). The audit could compute no diff (the seed supplied no
target order); the scope now supplies one, so the diff is below.

**Target order (scope, verbatim):** 1 workspace switcher · 2 search pill ·
3 PINNED (when populated) · 4 SAVED SEARCHES (when populated) · 5 PAGES tree
(scrollable) · divider · 7 Review due – Study flashcards · 8 Favorites – Inbox
– My tasks · divider · 10 Settings – Archived – Trash · divider · 12 footer:
Sign out – Devices – version pill – ?.

**Diff to build:** (1) upper group: move SidebarFavorites and SidebarRecents
OUT of the upper group — the target lists no upper Favorites/Recents sections
(Favorites survives as the footer row in slot 8; **GO-gate decision: Recents is
absent from the target entirely — confirm removal vs relocation**); resulting
upper order = search pill → PINNED → SAVED SEARCHES. (2) Footer: Templates and
Replay-tour rows are already removed by S10; regroup remaining rows into slots
7/8/10/12 with dividers per S3's mechanism. (3) Slot 12 'Devices' = the
ThemeToggle position (S12 closed: that button IS the theme toggle, correctly
labeled — it keeps its slot; no Devices link is built unless GO reopens S12).
(4) Slot 12 '?' = the S10 help button. Audit caveat: the upper sections share
one capped scroll wrapper (`sidebar-content.tsx:68`), so moving an item across
the 45%-cap boundary changes its scroll/pinning behavior, not just its
position — S16's shipped pinned-footer behavior must not regress.

**Dependency (explicit, per scope):** slot 7 "Review due – Study flashcards" is
**superseded by Plan F1's single "Flashcards" parent if F1 lands in the same
release**. If F1 merges first, S17 implements slot 7 as the single Flashcards
parent and the spec asserts that; if S17 lands first, the S17 spec must be
updated in the F1 PR. The sequencing call is made at GO and recorded here.

**Files:** `src/components/sidebar-content.tsx`,
`src/components/sidebar-footer-nav.tsx`.

**Spec:** `tests/e2e/item-S17-sidebar-slot-order.spec.ts`.

**Coverage check:** with Pinned + Saved searches populated, walks the rendered
sidebar top→bottom and asserts the full slot sequence by DOM order (compareDocumentPosition / locator ordering), including divider positions —
then re-runs with both sections empty to assert slots 3/4 vanish without
stranding dividers. DOM-order assertion can't false-green on a CSS reorder
(`order:`/flex tricks) that leaves screen-reader order wrong. RED on main:
Favorites/Recents sit between the search pill and SAVED SEARCHES, and the
footer grouping doesn't match.

**Failure modes verified:**

- Populated state: exact top→bottom order = switcher, search pill, PINNED,
  SAVED SEARCHES, PAGES, divider, Review due + Study, Favorites + Inbox + My
  tasks, divider, Settings + Archived + Trash, divider, Sign out + theme
  toggle + version pill + '?'.
- Empty Pinned/Saved searches: slots 3/4 absent, no doubled dividers (S3
  interaction).
- Footer cluster still pinned below the tree at small viewport heights with a
  huge tree (S16 regression guard — the 45%-cap move trap).
- Mobile drawer (same body) renders the same order.
- Tab order matches visual order (reorder done in markup, not CSS).
- Slot 7 matches whichever F1 state is in the release (asserted explicitly per
  the dependency note).

---

## Per-PR artifacts

Every Plan S PR description MUST include, or the item does not merge:

1. **Spec file path** under `tests/e2e/` (every S-item spec is e2e — they all
   assert rendered-browser behavior: computed px/opacity/colors, DOM order,
   drag, auth state; guards note "guard — no before").
2. **RED-on-main output** — the spec run on `main` BEFORE the change, pasted
   (no fabricated befores; S15 is a guard if GO accepts shipped behavior).
3. **GREEN-on-branch output** — the spec run on the branch AFTER the change,
   pasted, **×3 for e2e** (flake-proofing).
4. **Live-deploy screenshot** — navigate the item's path on the booted preview
   deployment; screenshot committed under
   `docs/superpowers/v0.10.2/artifacts/` (named `item-S<n>-<slug>.png`) and
   linked from the PR.

UI-wiring specs must drive the real browser surface through the proxy
(handler-import tests don't count — the F1 lesson). Reminder once more for the
diff as a whole: any added UI text lands in `messages/en.json`,
`messages/es.json`, AND `messages/ar.json` — CI bans hardcoded JSX strings.
