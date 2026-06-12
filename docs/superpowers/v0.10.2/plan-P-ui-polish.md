# Plan P — UI polish (Notion-density gap close)

> **HOLD until GO.**

Eighteen seeded items (P1–P18). Re-audit against repo evidence (file:line)
closed **2 at audit time** (premise wrong / already shipped — table below).
**16 open items** remain. Several open items carry premise corrections from the
audit — each is stated explicitly in its section; plans build only the delta,
never what already ships.

**Global i18n rule:** any item that adds or moves UI text must put strings in
`messages/{en,es,ar}.json` — no hardcoded JSX strings (CI bans them). The one
sanctioned exception is the slash menu, which portals outside `I18nProvider`
and uses its static `CATEGORY_LABEL` map (see P9).

**Sequencing note:** P14 depends on **B1** (the `busy`-flag `finally` fix in
`templates-gallery.tsx:63-71`) landing first — P14 asserts but does not
re-implement it.

## Closed by re-audit — no work (2)

| Item | Verdict |
|------|---------|
| P3 Cmd-K palette density | **Premise wrong, nothing to fix.** Rows are ~36px, not 44px: every Command.Item is `px-4 py-2 text-sm` with no min-h (`search-palette.tsx:270, :320, :347, :369`); the only 44px element is the footer Save-search button (`:383`). No footer hint chips exist to clip — the footer is a single right-aligned button (`:377-389`); the palette is `max-w-lg` (512px) in a `p-4` container (`:211, :221`), unconstrained at 800px (constraint starts ~544px). |
| P8 Block handles on paragraphs | **Already shipped.** The DragHandle hover selector explicitly includes `p` alongside h1–h3, lists, blockquote, pre, hr, callout, image, file, and node-view wrappers (`drag-handle.tsx:33-35`); insert-below + grip menu wired via blockActions (`:72-114`); mounted at `editor.tsx:735`. |

---

## P1 — Page header de-clutter (Lock + Move + Bibliography → overflow)

**Audit verdict: PARTIAL.** One toolbar row exists: `<div data-testid="page-toolbar">`
at `src/app/(app)/pages/[pageId]/page.tsx:111-161`, with the editor portaling
its control group in via the `EDITOR_TOOLBAR_SLOT_ID` div (`page.tsx:160`;
portal at `editor.tsx:707-714`). Lock, Move, and Bibliography are all
TOP-LEVEL today (Lock `page-action-panels.tsx:101-107`, Move `:108-126`,
Bibliography `editor.tsx:662-668`). The `...` overflow (PageMenu,
`page-menu.tsx:171-327`) holds Publish/Unpublish, Share, Export hint, Import,
Save-as-template, Copy link, Duplicate, Trash, Activity — and a TODO at
`page-menu.tsx:297-301` already plans a "Move to…" menu item. All keep-list
items (Comment, History, Export, Suggest chip, N-open badge, Live pill,
Outline, overflow) exist.

**Premise correction:** "9 controls in one row" is an undercount — for a
default editor-role user the row renders **14 interactive controls** plus the
title input and 2 display-only elements (full enumeration in the audit,
`page.tsx:111-161`, `page-action-panels.tsx:78-126`, `editor.tsx:644-694`,
`suggestion-toolbar.tsx:44-153`). Moving only Lock/Move/Bibliography still
leaves ~11 top-level controls (Status, Backlinks, Focus, Reader, Encrypt, icon
picker are outside this item's keep/move lists) — **GO-time confirmation:** is
the 3-control move the final scope, or should the keep-list be revisited?

**Gap to build** (delta only):

1. **Lock** — relocate LockToggle from `page-action-panels.tsx:101-107` into
   PageMenu as a menu item (needs a menu-item wrapper; the single-open-panel
   controller `bind('lock')` ownership moves or is dropped).
2. **Move** — relocate the canMove button (`page-action-panels.tsx:108-126`)
   into the menu, fulfilling the `page-menu.tsx:297` TODO; MoveToPicker dialog
   triggered from the menu item.
3. **Bibliography** — hardest: BibliographyToggle state lives in the editor
   client component (`editor.tsx:662-668`, `bibDisabled` state
   `editor.tsx:201`) while PageMenu is rendered by the server route — wire via
   a CustomEvent bus like the existing `cairn:export:open` pattern
   (`page-menu.tsx:245`).
4. Pass `canLock`/`canMove` props from `page.tsx:131-139` into PageMenu;
   update existing e2e specs that click these controls in the toolbar.

**Files:** `src/components/pages/page-action-panels.tsx`,
`src/components/page-menu.tsx`, `src/app/(app)/pages/[pageId]/page.tsx`,
`src/components/editor/editor.tsx`,
`src/components/editor/bibliography-toggle.tsx`, `messages/{en,es,ar}.json`
(menu-item labels), `tests/e2e/` (existing toolbar-clicking specs).

**Spec:** `tests/e2e/item-p1-toolbar-overflow.spec.ts`.

**Coverage check:** drives the real page route through the proxy. Each
relocated control is asserted by its **side effect**, not by menu-item
presence — a relocation that renders dead menu items (e.g. the Bibliography
CustomEvent never crossing the server/client boundary) would pass a
markup-only check but fails here.

**Failure modes verified:**

- Toolbar no longer renders the three relocated buttons (testid/count
  assertion on `page-toolbar`).
- Lock from menu: lock → LockBadge appears in the editor (`editor.tsx:646`)
  and edits are blocked; unlock from menu restores editing.
- Move from menu: MoveToPicker opens, page moved to another parent, tree/
  breadcrumb reflects the new parent.
- Bibliography from menu: toggling actually shows/hides the bibliography in
  the editor (CustomEvent wiring crosses the component boundary).
- Viewer role: Lock/Move menu items hidden (`canLock`/`canMove` gating
  survived the move).
- Menu with 12 items remains fully visible and clickable in the viewport (the
  e2e dropdown-overflow lesson: long dropdowns can overflow off-screen and
  become unclickable).

## P2 — Editor block spacing

**Audit verdict: PARTIAL.**

**Premise correction (do not plan against the claimed values):** the claimed
H2 mt 48px / p mt 24px / list mt 24px are `@tailwindcss/typography` defaults
(attached via `prose prose-sm sm:prose-base`, `editor.tsx:107`) — on the
editable surface they are **overridden** by higher-specificity
`.ProseMirror[contenteditable="true"]` rules in `src/app/globals.css` (scoping
comment `globals.css:202-211`). Actual shipped values: blanket sibling gap
`> * + *` margin-top `var(--cairn-block-gap, 6px)` (`globals.css:214-216`,
token at `:112`); **H1 has no margin-top rule** (effective 6px; mb 8px,
`:219-221`); **H2 mt 24px** (`:222-225`) — already the proposed value; p
margin 0 → effective 6px (`:232-234`); ul/ol margin 0 → effective 6px
(`:237-244`). The proposal therefore **loosens** p/list spacing (6→12/8px)
rather than halving it, and H2 needs zero work.

**Gap to build:** in `globals.css` only — (a) explicit
`.ProseMirror[contenteditable="true"] h1 { margin-top: 32px }`; (b) raise p to
12px and ul/ol to 8px margin-top via element-specific rules that beat the
`> * + *` sibling gap (or token adjustment). H2 = 24px: zero work. Public
reader stays untouched (`read-only-view.tsx:38` uses plain prose classes).

**Files:** `src/app/globals.css`.

**Spec:** `tests/e2e/item-p2-editor-block-spacing.spec.ts`. e2e is the right
layer: the bug class is a CSS **cascade/specificity** outcome
(`[contenteditable]` rules vs `:where()`-scoped typography), observable only
as computed style in a real browser — unit/DOM tests cannot compute it.

**Coverage check:** types real blocks into the live editor and reads
`getComputedStyle().marginTop` as pixel numbers on the contenteditable
surface; also asserts the public reader keeps typography defaults. A rule
landing in the wrong scope or losing the specificity battle shows up as a
wrong pixel value — class-presence checks would false-green.

**Failure modes verified:**

- h1 following another block: computed margin-top 32px (not the 6px sibling
  gap).
- h2: stays 24px (regression guard on the already-shipped value).
- p after p: 12px; ul after p: 8px.
- First child block: no doubled top margin from the new element rules.
- Public read-only view: typography defaults unchanged (scoping-leak guard).

## P4 — Status pill color hierarchy

**Audit verdict: GAP.** Premise confirmed: lifecycle pills are fully
monochrome. Both variants live in `src/components/pages/status-picker.tsx` —
viewer badge `:45-54`, editor PopoverTrigger `:98-106` — each with a
`data-status` attribute but default `--border`/`--foreground` colors only. No
CSS targets `[data-status]` in any stylesheet; no `--status-*` tokens exist.
Prior art: `--success`/`--warning` token pairs at `globals.css:29-32` (light)
and `:56-59` (dark), mapped via `@theme inline` (`:65`). Statuses:
`PAGE_STATUSES = ['draft','review','published','archived']`
(`src/db/schema/pages.ts:16`); labels at `messages/en.json:917-920`.
(`editor.tsx:88` "status-pill" is the unrelated collab-connection dot.)

**Gap to build:** (1) 8 token pairs
`--status-{draft,review,published,archived}-bg/fg` in `:root` and `.dark`,
plus `@theme inline` `--color-*` mappings (follow the `--success`/`--warning`
pattern); mapping per scope: draft = neutral gray, review = amber, published =
green, archived = dim gray. (2) Apply to BOTH pill variants
(`status-picker.tsx:45-54` and `:98-106`) via a `Record<PageStatus,
className>` map or `[data-status=...]` CSS. **Keep the `data-status`
attribute** (lines 49, 102) — asserted by
`tests/e2e/item-37-new-page-default-draft.spec.ts:31`.

**Files:** `src/app/globals.css`,
`src/components/pages/status-picker.tsx`.

**Spec:** `tests/e2e/item-p4-status-pill-colors.spec.ts`.

**Coverage check:** drives the real StatusPicker, cycles all four statuses,
and asserts **computed** background/foreground colors in both light and dark
themes. Under Tailwind v4 `@theme`, a token defined but not mapped resolves to
nothing — only a computed-color assertion catches that; class-presence checks
false-green.

**Failure modes verified:**

- Each of the 4 statuses renders a distinct computed bg/fg pair matching its
  semantic (gray/amber/green/dim-gray), on both the viewer badge and the
  editor trigger pill.
- Dark mode toggled: the `.dark` token pair takes effect (recomputed colors
  differ from light where intended).
- Computed color is never transparent/initial (missing `@theme inline`
  mapping caught).
- `data-status` attribute still present — item-37 spec stays green.

## P5 — /citation chip: superscript + hover popover from cached metadata

**Audit verdict: GAP.**

**Premise correction (reaches the proposal author):** inserted citations are
NOT an "unstyled blue link". The citation is an atom **block** node
(`group:'block', atom:true`, `citation-node.ts:15-19`) rendering the full
pre-formatted citation string as plain text with no anchor at all
(`citation.tsx:33-45`); the DOI URL is plain concatenated text
(`format.ts:21-25`). No `.cairn-citation` CSS exists anywhere; no hover
popover exists (only CitationAddDialog for empty placeholders,
`citation.tsx:46-74`). No cache at any layer: lookup is live-fetch only
(1-RPS in-memory limit, 5s timeout, 256KB cap — `lookup.ts:20-35`,
`api/citations/lookup/route.ts:56-78`); richer CitationMeta fields (journal,
volume, issue, pages, url — `lookup.ts:86-98`) are not persisted on the node;
no citations DB table exists. Prior art for the popover lives on FOOTNOTES:
FootnoteSup renders a numbered superscript `[n]` button with a click-toggled
popover (`footnote.tsx:25-60`; mark at `footnote-mark.ts:28-39`). "Snippet"
data exists nowhere in the citation pipeline.

**Gap to build** (everything):

1. **Superscript number** — add an inline `citation-ref` companion node
   paired with bibliography numbering, rather than converting the block atom
   to inline (that would be a breaking schema change hitting Yjs docs, the
   server parse path, and the Bibliography aggregator). `numbering.ts`
   currently numbers footnotes only — extend to citations.
2. **Hover popover** — author + year + snippet; copy the FootnoteSup pattern
   (`footnote.tsx:25-60`) but trigger on hover + keyboard focus, not click
   only.
3. **Cached Cross-Ref metadata** — persist the full CitationMeta on node
   attrs at insert time (cheapest: the data is already in hand at
   `slash-extension.ts:286` and `citation.tsx:50`). No new DB table or
   migration by default; the table route stays a fallback.
4. **Snippet — GO-time decision:** no data source exists today. Option A
   (default): render the formatted title line from persisted attrs as the
   "first-line snippet". Option B: extend the lookup to fetch the Cross-Ref
   abstract and persist its first line.

**Files:** `src/components/editor/extensions/citation.tsx`,
`src/components/editor/blocks/citation-node.ts`,
`src/components/editor/slash-extension.ts`, `src/lib/citations/types.ts`,
`src/app/api/citations/lookup/route.ts`,
`src/components/editor/read-only-view.tsx`; `src/db/schema/index.ts` +
`drizzle/migrations/` **only if** the DB-table cache route is chosen at GO
(default: no migration). Popover strings → `messages/{en,es,ar}.json`.

**Spec:** `tests/e2e/item-p5-citation-superscript-popover.spec.ts`.

**Coverage check:** inserts a citation through the real `/cite-doi` slash flow
(Cross-Ref mocked at the network layer), then **blocks the lookup route** and
asserts the hover popover still shows author + year — proving metadata is
served from persisted node attrs (the cache), not a refetch. A markup-only
check could false-green a popover that silently refetches on every hover.

**Failure modes verified:**

- Insert via `/cite-doi` → inline superscript `[n]` renders; number matches
  the bibliography entry order.
- Hover opens popover with author + year + snippet line; closes on mouse-out;
  keyboard focus opens it too (a11y parity with FootnoteSup).
- Popover renders with the lookup API blocked post-insert (cache proof).
- Page reload → popover still works (attrs persisted through the doc
  round-trip).
- Two distinct citations → distinct stable numbers; duplicate source behavior
  pinned.
- Read-only/public view renders the superscript path, not the raw block
  string (`read-only-view.tsx` wiring).

## P6 — Chips dim at zero — CLOSED (superseded by P1, 2026-06-12)

**Closed during execution — no work remains.** The audit had already narrowed
P6 to a single offender: the toolbar **BibliographyToggle** chip
(`bg-primary` fill at zero citations). Plan P1 (merged in this release)
**deleted that component entirely** — `src/components/editor/
bibliography-toggle.tsx` no longer exists (zero references; verified by ls +
grep post-merge). Bibliography toggling now lives in the page overflow menu
as a plain action row with no fill and no count badge, so there is no chip
left to dim. The other two surfaces named by the seed were premise-corrected
at audit time and re-verified post-P1:

- "N open" badge: gated by `openCount > 0` (`suggestion-toolbar.tsx:136`) —
  absent at zero, muted hairline when shown.
- Suggest toggle: `bg-primary` only while suggestion mode is actively on
  (`suggestion-toolbar.tsx:57` ternary) — dim at rest.

No spec ships for a deleted surface; the P1 spec
(`tests/e2e/item-p1-toolbar-overflow.spec.ts`) already pins the bibliography
control's new home and behavior.

## P7 — Heading collapse chevron visibility at rest

**Audit verdict: PARTIAL.**

**Premise correction:** the chevron is NOT mount-on-hover anymore. Since
v0.10.0 E3, HeadingCollapse renders a button for EVERY visible h1/h2/h3
(`heading-collapse.tsx:25-38` comment, `:50-78` recompute, `:146-166` render
loop; mounted `editor.tsx:738`). Visibility is pure CSS opacity tiers on
`.heading-collapse-chevron` in `globals.css`: **opacity 0 + pointer-events:
none at rest** (`:459-463`) — so "invisible at rest" IS true on desktop;
0.5 on row hover via `data-row-hovered` (`:465-468`;
tracker `heading-collapse.tsx:101-132`); 1 on direct hover / keyboard focus /
collapsed (`:471-476`); always 1 on `pointer: coarse` (`:478-483`).

**Gap to build:** rest-state value only — change `.heading-collapse-chevron`
rest state from `opacity: 0; pointer-events: none` to `opacity: 0.3;
pointer-events: auto`. **GO-time decision:** collapse the intermediate 0.5
`data-row-hovered` tier into the 100%-on-hover tier — the proposal's two-state
model would make the `heading-collapse.tsx:101-132` row-hover tracking and the
`data-row-hovered` attribute redundant (optional cleanup). Touch
(always-visible) and collapsed-state rules already satisfy/exceed the
proposal.

**Files:** `src/app/globals.css`,
`src/components/editor/heading-collapse.tsx` (only if the 0.5 tier is
removed).

**Spec:** `tests/e2e/item-p7-heading-chevron-rest-opacity.spec.ts`.

**Coverage check:** computed-opacity assertions in a real browser with
faithful pointer states (the B2 lesson: static DOM greps cannot see
hover-gated/opacity-tiered editor surfaces). Rest state is verified with the
mouse parked outside the editor; clickability at rest is verified by
**behavior** (a click collapses), which catches a forgotten
`pointer-events: none`.

**Failure modes verified:**

- Rest (no hover): every visible h1–h3 chevron computed opacity 0.3, and a
  direct click at rest collapses the section (pointer-events restored).
- Direct chevron hover: opacity → 1 (transition awaited).
- Collapsed heading: chevron stays opacity 1 without hover.
- Keyboard `:focus-visible`: opacity 1.
- If the 0.5 tier is removed at GO: row-hover no longer produces an
  intermediate opacity (two-state model holds).

## P9 — Slash menu category rail

**Audit verdict: PARTIAL** (grouped headers SHIPPED; rail GAP).

**Premise correction:** the actual categories are
`basic | media | database | advanced | workspace` (`slash-menu.tsx:15`, fixed
order `:57-63`) — there is **no "EMBED" category**; "Embed" is an individual
media ITEM (`slash-extension.ts:615-617`). Headers only look all-caps via the
Tailwind `uppercase` class (`slash-menu.tsx:192-197`). Labels come from a
static `CATEGORY_LABEL` map (`:86-92`) because the menu portals to
`document.body` outside `I18nProvider` — `useT()` cannot be used (matching
`slash.group.*` keys exist at `messages/en.json:473-476` and `:1162`). Rail /
jump-to: confirmed absent (grep). Structure: one scrollable
`div[role="listbox"].max-h-80.overflow-y-auto` (`:177-183`) inside a `w-64`
popover (`:167`); flat keyboard index (`:113`, `:128-152`);
`scrollIntoView` keeps the active row visible (`:123-126`); "No results"
branch at `:154-160`.

**Gap to build** (rail only — grouping/headers/scrolling already exist):

1. Wrap the existing scroll listbox (`slash-menu.tsx:166-239`) in a flex row;
   add a rail column derived from the existing `groups` memo (`:114`).
2. Jump-to: rail click scrolls the group header into view inside the existing
   scroller (`:177-183`) — per-group ids/refs on the header divs (`:191-197`).
3. Widen the popover from `w-64` (`:167`).
4. Keep rail buttons OUT of the ARIA option index (`tabIndex=-1` /
   presentation wrapper) so the flat keyboard index and
   `aria-activedescendant` stay coherent.
5. Rail labels from the static `CATEGORY_LABEL` map, NOT `useT()` (portal
   constraint, `:79-92`) — the sanctioned i18n exception; keep
   `slash.group.*` keys in sync across `messages/{en,es,ar}.json`.
6. Optional: highlight the active rail entry from `ordered[index]`'s category.
7. Hide the rail when filtering leaves ≤1 group; keep the "No results" branch.

**Files:** `src/components/editor/slash-menu.tsx`,
`messages/{en,es,ar}.json` (key parity check).

**Spec:** `tests/e2e/item-p9-slash-category-rail.spec.ts`.

**Coverage check:** opens the real slash menu in the editor and asserts the
clicked group's header actually lands inside the scroller's visible box
(boundingBox math), not merely that a handler fired; asserts keyboard
navigation and insertion still work afterwards — the exact coherence (flat
index + `aria-activedescendant`) the rail could silently break.

**Failure modes verified:**

- Rail lists exactly the non-empty groups in `SLASH_CATEGORY_ORDER`; **no
  "Embed" entry** (premise pinned in the spec).
- Click "Workspace" (last group) → its header visible inside the `max-h-80`
  scroller.
- ArrowDown still walks the flat item order; rail buttons never become the
  active option; Tab/arrow order unchanged.
- Enter inserts the active item correctly after a rail jump.
- Filter to a single group → rail hidden; zero results → "No results" branch
  intact.

## P10 — Admin nav grouping

**Audit verdict: GAP.**

**Premise correction:** the admin section has **15 unconditional entries**
(`sidebar.tsx:36-117`) plus a 16th, End-to-end encryption, gated on
`e2eEnabled` (`:119-125`) — not "~10". Rendering is flat — a single mapped
`<Link>` list with one left border, no headers, no disclosure (`:312-333`);
the Section/SubPage model is single-level with no group field (`:10-16`).

**Gap to build** (everything): grouping layer in the data model, collapsible
disclosure (state + chevron + `aria-expanded`), keyboard arrow-nav kept
working across collapsed groups (`data-settings-nav` querySelectorAll,
`sidebar.tsx:260`), i18n group labels. **Full bucket map — every actual entry
assigned; unlisted-by-user entries flagged ⚑ for GO-time confirmation:**

| Group | Entries |
|-------|---------|
| Identity | Members · SSO & SCIM · MFA policy · ⚑ End-to-end encryption (flag-gated) |
| Audit & Compliance | Audit log · SIEM forwarders |
| Integrations | Webhooks · Chat bridge · Federated search · ⚑ OAuth clients |
| Quotas | API key quotas · ⚑ Storage |
| Billing | Upgrade (audit note: no billing surface exists today — Upgrade is the closest fit; ⚑ confirm group name) |
| ⚑ Operations (new group, not in the user's list) | Backups · Health · Migrations |

**Files:** `src/components/settings/sidebar.tsx`,
`messages/{en,es,ar}.json` (group labels).

**Spec:** `tests/e2e/item-p10-admin-nav-groups.spec.ts`.

**Coverage check:** real settings sidebar as admin; an **enumerated**
assertion that all 16 entry hrefs appear exactly once across the groups
catches a silently dropped or duplicated entry (the false-green risk of
spot-checking two groups); collapse behavior asserted by focus/anchor
reachability, not class names.

**Failure modes verified:**

- All 16 admin hrefs present exactly once across the six groups (no
  orphans/dupes).
- Collapse Identity → its links leave the tab/arrow-nav order;
  `aria-expanded=false`; re-expand restores.
- Deep link to `/settings/admin/storage` → its group auto-expands and the
  entry is highlighted.
- Non-admin: admin section absent entirely (gating untouched).
- e2e flag on: Encryption appears in its assigned group.

## P11 — Settings nav rail icons

**Audit verdict: GAP.** Confirmed: the only lucide import is `ArrowLeft`
(`sidebar.tsx:3`), used solely on the back-to-workspace link (`:283-291`);
top-level section links render `{s.label}` only (`:299-311`); the section
model has no icon field (`:127-248`). Minor premise note: the actual top-level
set is Search, Account, Workspace, Admin (role-gated), Developer,
Notifications, Security — Search is a top-level entry too and Admin is hidden
for non-admins.

**Gap to build:** extend the Section type with an icon component field; pick
lucide-react icons for all seven sections; render `h-4 w-4 shrink-0`
`aria-hidden` icons inside the section Link, matching the ArrowLeft pattern at
line 289.

**Files:** `src/components/settings/sidebar.tsx` (no new strings — no i18n
delta).

**Spec:** `tests/e2e/item-p11-settings-nav-icons.spec.ts`.

**Coverage check:** real sidebar render through the proxy — asserts one 16px
svg per visible top-level link AND that each link's accessible name is still
just its label (icon `aria-hidden`). The a11y assertion is what a
markup-presence check would miss: an icon without `aria-hidden` pollutes every
link's screen-reader name.

**Failure modes verified:**

- Each visible top-level section link contains exactly one 16×16 svg.
- Accessible names unchanged (icons hidden from the a11y tree).
- Admin icon renders only for admins; non-admin link set unchanged.
- Child links get no icons (scope guard).

## P12 — Live-editor sync warning surfaced on the editor

**Audit verdict: GAP.** The banner exists exactly once, on the admin Upgrade
page (`upgrade/page.tsx:70-79`, keys `admin.upgrade.collabBridge.*`,
`messages/en.json:978-979`), plus a status row on admin Health
(`health-view.tsx:104-120`) — both admin-only; confirmed NOWHERE on the editor
surface (grep). Attachment points already exist: the above-editor banner slot
(CollabOfflineBanner at `editor.tsx:696-699`,
`collab-offline-banner.tsx:21-55`), the **Live status pill** in the portaled
toolbar group (`editor.tsx:673-679`, labels `:82-86`) — the user-chosen
placement — and the LockBanner precedent (`page.tsx:163-167`).

**Premise correction:** the warning is not about writes "during upgrade"
specifically — when `CAIRN_COLLAB_INTERNAL_URL` is unset, **any** REST API
write to page content updates the DB but never reaches an open editor until
reload (`isCollabBridgeConfigured()`, `publish-client.ts:35`).

**Gap to build:** (1) read `isCollabBridgeConfigured()` **server-side** in the
page route (env never reaches the client — see the `upgrade/page.tsx:53`
comment) and pass it as a prop into Editor (prop types `editor.tsx:60-80`);
(2) render a small degraded pill next to the Live pill in `toolbarControls`
(`editor.tsx:672-680`); (3) editor-facing i18n keys adapted from
`admin.upgrade.collabBridge.*` into `messages/{en,es,ar}.json`. **GO-time
decision:** audience — default plan is all users with edit access (their
collaborators' REST writes are what go stale); an admin-only workspace banner
is the accepted fallback per scope. Hidden for read-only viewers.

**Files:** `src/components/editor/editor.tsx`,
`src/app/(app)/pages/[pageId]/page.tsx`,
`src/components/editor/collab-offline-banner.tsx` (only if the banner variant
is chosen), `messages/{en,es,ar}.json`,
`src/lib/collab/publish-client.ts` (export the flag read if needed).

**Spec:** `tests/e2e/item-p12-editor-bridge-warning.spec.ts` **plus a unit
test for the configured branch.** Justification: the flag is server env read
at boot — one e2e process cannot exercise both states. The e2e harness boots
without `CAIRN_COLLAB_INTERNAL_URL` and asserts the pill end-to-end; a
unit/component test asserts no pill when `bridgeConfigured=true` (if the e2e
stack turns out to run WITH the bridge configured, the two assertions swap
layers — decided from the actual e2e env at implementation).

**Coverage check:** the e2e drives the full chain that can silently break —
server env → page-route prop → client Editor → portal into the toolbar slot —
through the proxy on the real page. A component test alone would miss a prop
never passed by the route (the F1 lesson).

**Failure modes verified:**

- Bridge unconfigured: pill visible adjacent to the Live pill, i18n'd label,
  `role="status"` announced.
- Unit: `bridgeConfigured=true` → no pill (false-positive guard).
- Pill shows for an editor-role user, not only admins (or per GO decision).
- Read-only viewer: pill hidden.
- Admin Upgrade banner unaffected (existing keys/surface untouched).

## P13 — Encryption page banner tone

**Audit verdict: PARTIAL — recommend re-scope or drop at GO.**

**Premise correction:** there is **no orange warning banner**. The env-off
banner is the shared EncryptionDisabledNotice, already neutral muted gray
(`rounded-md border border-border bg-muted/40 p-4 text-sm`,
`encryption-disabled-notice.tsx:15`, body + docs link `:16-25`), rendered on
both the admin page (`admin/encryption/page.tsx:32,45-56`) and the security
page via `E2EEnrollCard enabled={false}` (`security/encryption/page.tsx:17,24`;
`e2e-enroll-card.tsx:77-84`). Copy is already informational
(`messages/en.json:1065-1066`). Zero amber/orange classes on any encryption
surface (grep). No semantic info-blue token exists (`globals.css:276` is only
the `data-accent="blue"` theme).

**Gap to build:** the substantive goal (non-alarming tone) is already shipped
— arguably zero work. **GO decision (taken): literal info-blue restyle.** The
item text explicitly asks for info-blue, the gray-vs-blue distinction is a
real visible delta, and the `--info` token pair is reusable. Added `--info`/
`--info-foreground` to `globals.css` (`:root`, `.dark`, `@theme inline`
mappings — the `--success`/`--warning` pattern), restyled the one shared
component (covers both pages) with `border-info/40 bg-info/10` + lucide Info
icon (aria-hidden). No new strings.

**Files:** `src/components/admin/encryption-disabled-notice.tsx`,
`src/app/globals.css`.

**Spec (only if the restyle is chosen):**
`tests/e2e/item-p13-encryption-notice-info.spec.ts`.

**Coverage check:** with the flag off (the e2e default env), visits BOTH
mounting pages and asserts computed border/background resolve from the
`--info` tokens in light and dark — covering the shared-component reach and
the Tailwind v4 token-mapping trap (defined-but-unmapped tokens compute to
nothing).

**Failure modes verified:**

- Admin encryption page and security encryption page both show the
  info-styled notice (one component, two mounts).
- Computed colors resolve (non-transparent) in light AND dark.
- No warning/amber classes present on the notice.
- Docs link still rendered and navigable.

## P14 — Template gallery polish (depends on B1)

**Audit verdict: PARTIAL.**

**Premise correction:** the Preview half needs **zero work** — Preview is
already a ghost Button (`<Button type="button" variant="ghost" size="sm">`)
opening TemplatePreviewDialog (`templates-gallery.tsx:166-174`; label from
i18n key `templates.preview.open`, `messages/en.json:3`). It only *reads* as
muted text because ghost has no resting background (`button.tsx:20`) plus
`px-1 text-muted-foreground` — at most drop those classes for a more
button-like resting affordance (optional polish). Pending state on Use
template also exists (per-card `busy`, `:45`, `:179-183`).

**Genuinely missing:** (1) no timeout — `onUse` is a bare fetch with no
AbortController/timeout/retry (`templates-gallery.tsx:49-72`, fetch at `:53`);
(2) no error toast — failures set an inline destructive `<p>` (`:69`, `:110`)
even though sonner's Toaster is mounted app-wide (`ui/sonner.tsx`;
`app/(app)/layout.tsx:22,112`); (3) the busy flag leaks on the database-kind
success path (`setBusy(null)` only in catch, no finally, `:63-71`) — **that
fix is B1's scope; this item depends on B1 and asserts it, never
re-implements it**; (4) "Use template", "Working…", "Delete" are hardcoded
English (`:182, :193`).

**Gap to build:** in `onUse` — (a) AbortController + **10s** timeout (per
scope; audit suggested ~15s, scope wins) with a user-readable timeout message;
(b) `toast.error(...)` via the already-mounted Toaster, with a **Retry**
action that re-invokes `onUse`; (c) move the hardcoded labels into
`messages/{en,es,ar}.json` alongside the existing `templates.*` keys.
Optional: Preview className polish.

**Files:** `src/components/templates/templates-gallery.tsx`,
`messages/{en,es,ar}.json`.

**Spec:** `tests/e2e/item-p14-template-use-timeout-toast.spec.ts`.

**Coverage check:** drives the real gallery through the proxy with network
route interception: stalls the use-template request past 10s → asserts the
abort fires, the toast appears, and the button label resets; then clicks the
toast's Retry with the route unblocked and asserts the template actually
applies. Exercises the full timeout → toast → retry → success loop — a spec
asserting only toast markup would false-green a Retry that never re-fires.

**Failure modes verified:**

- Request stalled >10s: aborted; `toast.error` with timeout copy; button back
  to "Use template" (busy cleared — B1's `finally` observed here too).
- Server 500: toast shown (not only the inline `<p>`).
- Toast Retry: a second request fires; on success the normal post-use flow
  completes.
- Fast success path: no toast; busy resets (database-kind success-leak
  guard).
- Visible labels match the `messages/en.json` values (no hardcoded JSX
  strings; CI ban backs this).

## P15 — Notification panel footer on empty state

**Audit verdict: GAP** (claim verified TRUE). The footer is unconditional: the
border-t/p-3 div at `drawer.tsx:260-282` (Mark-all-read Button `:261-274`,
See-all Link `:275-281`) renders outside all conditionals — the only guard is
`if (!open) return null` (`:116`). The empty state ("You're all caught up")
renders at `:198-205` inside the scrollable body (`:181-258`) and the footer
still renders below it. Mark-all-read is disabled only by the in-flight
`markingAll` flag (`:264`). The bell (`bell.tsx:54`) has no footer logic.

**Gap to build:** condition the footer block (`drawer.tsx:260-282`) on
`items.length > 0` — hide the whole footer (both controls) during the empty
state, per scope. "See all" links to `/notifications`, which has its own empty
state (`page-list.tsx`), so hiding it loses nothing when empty. Footer remains
when items exist but are all read (See-all stays useful).

**Files:** `src/components/notifications/drawer.tsx`.

**Spec:** `tests/e2e/item-p15-notification-footer-empty.spec.ts`.

**Coverage check:** drives the real drawer through both states — zero
notifications (footer absent, caught-up copy visible) and ≥1 notification
(footer present, Mark-all-read functional). The state **transition** is the
thing a static render check can't false-green.

**Failure modes verified:**

- Empty: neither Mark-all-read nor See-all rendered; empty-state copy + icon
  visible.
- ≥1 item: footer present; Mark-all-read marks all items read.
- After mark-all-read with items still listed (read): footer remains (it
  conditions on `items.length`, not unread count).
- `markingAll` in-flight: button disabled (existing behavior preserved).

## P16 — Workspace switcher dropdown width

**Audit verdict: GAP.**

**Premise correction:** the dropdown is not a min-width — it is a **hardcoded
fixed width**: `DropdownMenu.Content` is `w-56` (224px) in a Portal
(`workspace-switcher.tsx:73-77`), while the Trigger is `w-full` (`:58-60`)
inside the resizable sidebar (`width: var(--cairn-sidebar-w, 15rem)` — 240px
default, user-resizable via SidebarResizeHandle, `sidebar.tsx:29`). Zero
occurrences of `--radix-dropdown-menu-trigger-width` repo-wide; the component
uses raw `radix-ui` primitives (`:3`), not a shadcn wrapper.

**Gap to build:** replace `w-56` on Content (`workspace-switcher.tsx:77`) with
`w-[var(--radix-dropdown-menu-trigger-width)]` (Radix sets this var on
portalled Content automatically), keeping a `min-w-56` floor for very narrow
sidebars. This makes the menu track the actual sidebar width, including
user-dragged sizes and the mobile drawer (`w-64`, `sidebar-drawer.tsx:56`).

**Files:** `src/components/workspace-switcher.tsx`.

**Spec:** `tests/e2e/item-p16-workspace-switcher-width.spec.ts`.

**Coverage check:** opens the real dropdown and compares Content vs Trigger
boundingBox widths at the default sidebar width, then **drags the resize
handle wider and re-asserts** — any fixed-width regression passes at most one
of the two checks, so the pair cannot false-green.

**Failure modes verified:**

- Default 240px sidebar: menu width equals trigger width (±1px).
- Sidebar dragged wider (e.g. ~360px): menu tracks the new trigger width.
- Sidebar dragged very narrow: `min-w-56` floor holds (menu ≥224px).
- Mobile-viewport drawer: menu matches the drawer trigger width.

## P17 — 404 page: add Search input

**Audit verdict: PARTIAL.** Premise confirmed: `src/app/not-found.tsx` renders
the "404" numeral (`:7`), h1 "This page wandered off" (`:8`), supporting copy
(`:9-11`), and the Back-to-home Button/Link (`:12-14`) — and **no search input
anywhere**. The root 404 renders outside the authenticated (app) shell: the
Cmd-K SearchPalette is mounted only inside `(app)/layout.tsx:80`, and no
session is available. Route-specific not-found variants
(`s/[slug]`, `p/[slug]`, `(app)/pages/[pageId]`) also lack any search input.

**Gap to build:** add the Search input to `src/app/not-found.tsx`, below
Back-to-home. Existing copy + button: zero work. **Design choice (default
plan, confirm at GO):** a plain GET form navigating to the in-app search
destination — signed-in users land in app search with the query applied;
signed-out users hit the auth gate and continue after sign-in. NOT a client
call to `/api/search` — that route is session-gated
(`src/app/api/search/route.ts`), so anonymous visitors would get a raw error.
New strings (placeholder/label) go to `messages/{en,es,ar}.json` if the root
not-found can reach the i18n provider; otherwise match the file's existing
copy approach and confirm the CI hardcoded-JSX rule's treatment of this file
before GO.

**Files:** `src/app/not-found.tsx`, `messages/{en,es,ar}.json`.

**Spec:** `tests/e2e/item-p17-404-search-input.spec.ts`.

**Coverage check:** requests a nonexistent route through the proxy (a real 404
render, not a component mount), asserts the input below the button, and
**submits a query** — asserting actual navigation to the search destination
with results for a seeded page. Markup-only checks would false-green a form
with no action wired.

**Failure modes verified:**

- Nonexistent route → 404 page shows the search input below Back-to-home.
- Signed-in submit → lands on the search surface with the query applied and a
  seeded page matched.
- Signed-out submit → auth gate, not a raw API error.
- Existing 404 copy and Back-to-home link unchanged.

## P18 — Indexing indicator in Cmd-K

**Audit verdict: GAP.** All three prerequisites are absent: (1) **no result
count** in the palette — only a "Pages" group heading (`search-palette.tsx:264`)
and the only lucide icon imported is Bookmark (`:4`); the search API returns
`{ results }` with no total/count field (`api/search/route.ts:113-127`).
(2) **no embedding queue or pending status** — embeddings are fire-and-forget
`setImmediate` hooks on update (`lib/pages/update.ts:159-176`) and create
(`lib/pages/create.ts:86-90`) calling `embedPage`
(`embed-page.ts:38-89`) into `page_embeddings`
(`db/schema/page-embeddings.ts:30-49`); no persisted queue, status column, or
pending set exists. (3) **no API exposes pending counts** — the closest is the
admin-only reindex route (`api/admin/search/reindex/route.ts:26-59`) returning
a last-run summary (`rebuild-index.ts:26-38`, `reindex-cli.ts:10-15`), not a
live count; the missing/stale computation exists only as raw SQL inside the
reindex walker (`reindex-cli.ts:41-48`).

**Architectural caveat (state in the PR too):** embedding is synchronous
fire-and-forget per write, not a durable queue — "still queued" can only mean
"pages whose embedding row is **missing or content-hash-stale**", computed on
demand.

**Gap to build** (everything):

1. Workspace-scoped pending-embeddings count query in `src/lib/search`
   (reuse the missing-OR-stale LEFT JOIN SQL from `reindex-cli.ts:41-48`).
2. A non-admin exposure: a count/pending field added to the `/api/search`
   response (cheapest) or a new `/api/search/embedding-status` route. The
   existing reindex endpoint is `requireRole('admin')` and per-replica
   in-memory — unsuitable.
3. Palette UI: a result-count line (**the anchor itself must be created** —
   none exists today) plus a lucide Clock icon when pending > 0, strings in
   `messages/{en,es,ar}.json`.

**Files:** `src/components/search-palette.tsx`,
`src/lib/search/embedding-status.ts` (new),
`src/app/api/search/route.ts` (or new embedding-status route),
`messages/{en,es,ar}.json`.

**Spec:** `tests/e2e/item-p18-embedding-pending-indicator.spec.ts`, plus a
unit test for the count SQL (missing vs stale vs embedded, workspace scoping)
— the SQL semantics are a DB-layer contract the e2e shouldn't enumerate.

**Coverage check:** the e2e seeds a page whose embedding row is missing (or
content-hash-stale) via the e2e DB helper — deterministic, since the
`setImmediate` embed can win any race with UI polling — then opens Cmd-K and
asserts count line + Clock; after embedding completes, asserts the Clock
clears. The indicator is tied to actual LEFT JOIN truth in the DB, so it
cannot false-green on a hardcoded pending flag.

**Failure modes verified:**

- Page with missing embedding row → result-count line renders with the Clock
  icon and i18n'd label.
- Page edited so its embedding content-hash is stale → also counted pending.
- All pages embedded → no Clock (zero-state guard).
- Pending pages in ANOTHER workspace do not light the indicator (workspace
  scoping).
- A non-admin user sees the indicator (the admin-gated reindex-route trap
  avoided).

---

## Per-PR artifacts

One PR per item off the release branch. Every PR description MUST include, or
the tag does not happen:

1. **Spec file path** under `tests/e2e/` (or the justified alternate layer —
   P12's configured-branch unit test, P18's SQL unit test).
2. **Spec output on main BEFORE the change** — pasted, RED (guards/net-new
   surfaces state "guard — no before"; no fabricated befores).
3. **Spec output on branch AFTER the change** — pasted, GREEN, **×3 for e2e**
   (flake-proofing).
4. **Live-deploy verification** — navigate the item's surface on the booted
   preview deployment; screenshot committed under
   `docs/superpowers/v0.10.2/artifacts/` (e.g.
   `docs/superpowers/v0.10.2/artifacts/item-p4-status-pills-dark.png`) and
   linked from the PR.

UI-wiring specs must drive the real browser surface **through the proxy**
(handler-import tests don't count — the F1 lesson). Items adding UI text ship
`messages/{en,es,ar}.json` updates in the same PR — CI bans hardcoded JSX
strings.
