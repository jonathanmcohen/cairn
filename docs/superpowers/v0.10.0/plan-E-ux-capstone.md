# Plan E — UX

> **HOLD until GO.**

Seven items (E3–E7 absorbed from the deferred ledger per user decision).
E2 ships LAST in the whole release so the panel can announce v0.10.0 itself.

## E1 — `?` opens the shortcuts cheat sheet (seed 25) — UI-incomplete (tiny)

**Exists:** the sheet is complete (`shortcuts/sheet.tsx:14-75`) registered as
`Mod+/` (`app-shortcuts.ts:89-98`). **Missing:** bare `?` — the dispatcher
early-returns on any non-modifier key (`dispatcher.tsx:88-90`).

**Build:** register `?` (match `e.key === '?'`, layout-independent), allowed
only when focus is not in input/textarea/contenteditable. `Mod+/` stays.

**Failure modes verified:**
- Typing `?` in the TipTap editor or any input does NOT open the sheet.
- `?` and `Mod+/` resolve to distinct registry entries (no normalizeKeys
  collision).
- Layout-independent: keyed off `e.key`, not physical Shift+/.
- Sheet listing + tooltips show both triggers (stale-copy check).

## E2 — "What's new" release-notes panel (seed 28) — Backend-stub

**Exists:** sidebar `v{version}` external GitHub link
(`sidebar-footer-nav.tsx:74-84`); upgrade page links notes only when an
upgrade is PENDING; release-watch notifications carry `releaseNotesUrl`.
**Missing:** any in-app panel for the running version.

**Build:** in-app What's-new panel (from the sidebar version chip) rendering
the CURRENT version's CHANGELOG section; per-user `last_seen_version` badge;
all roles.

**Failure modes verified:**
- Seen-marker: bump version → badges once → dismiss → stays dismissed.
- CHANGELOG sourcing survives `output:'standalone'` (build-time bundle; spec
  asserts the panel renders in the production image).
- Viewer-role sees it (not admin-only — the release-watch audience trap).
- Local dev build newer than latest tag → no stale notes.

## E3 — #117 chevron discoverability — UX (from the live-deploy sweep)

**Context:** collapse works (B2 record) but the chevron only mounts on a
precise heading hover and lives at gutter `left:-28` — the sweep's author
couldn't find it, which predicts real users can't either.

**Build:** make the affordance discoverable without regressing the
decorations design: widen the hover zone to the full heading row + show the
chevron at reduced opacity whenever the BLOCK is hovered (not just the
gutter), and always show it on collapsed headings (state must be visible).
Touch devices: chevron always visible on `pointer-coarse`.

**Failure modes verified:**
- Hover anywhere on the heading row → chevron visible within 150ms (spec
  hovers the text center, not the gutter — exactly what the sweep did).
- Collapsed heading shows the chevron with NO hover (state visibility spec).
- `pointer-coarse` emulation → chevron present without hover.
- No layout shift: the chevron stays absolutely positioned (CLS check).

## E4 — Suggest-mode auto-mark-on-type — design decision + impl (ledger)

**Today (by design):** suggest mode is MANUAL — select a range, click "Mark
insert"/"Mark delete" (`editor.tsx:493-497`). Typing in Suggesting mode wraps
nothing. The v0.9.19 sweep expected Google-Docs auto-tracking and read the
manual flow as a miss. **This is a design decision, not a bug** — so E4 first
DECIDES, then implements the chosen branch (the F/U correction discipline:
never silently drop, record the call).

**Proposed default — implement auto-wrap, keep manual:** while `suggestionMode`
is on, intercept text input → wrap inserts in `suggestionInsert`; route
deletions (Backspace/Delete/cut) into `suggestionDelete` tombstones. Manual Mark
buttons stay for marking pre-existing ranges.

**Failure modes verified:**
- **Auto-wrap goes THROUGH the editor command pipeline** so it propagates over
  Yjs — the C3 lesson from v0.9.19: never reconstruct a fresh Y.Doc and
  `Y.applyUpdate`; a CRDT merge can't express deletions. Spec runs two clients
  and asserts the wrap replicates.
- IME / composition input wraps ONCE per committed token, not per fragment
  (compositionstart/end guard; spec drives a composition event).
- Toggling suggest mode OFF mid-paragraph stops wrapping cleanly; subsequent
  typing is plain (spec toggles then types).
- Accept/reject of an auto-wrapped insert behaves identically to a
  manually-marked one (shared accept path — no second code route).

**If the decision is "keep manual":** E4 collapses to a label/tooltip change so
"Suggesting" doesn't imply auto-track — recorded as a deliberate scope cut, not
a dropped item.

## E5 — Settings double-sidebar refactor (ledger; polish-audit row 19) — REFACTOR

**Today:** under `/settings/*` both the workspace `<Sidebar>` and
`SettingsSidebar` render — two left navs stacked. **Build:** suppress the
workspace sidebar on settings routes (conditional in the `(app)` layout on
pathname, or a settings route group whose layout omits the workspace aside).

**Failure modes verified:**
- `/settings/*` renders exactly ONE left nav (spec counts nav landmarks).
- Back-nav out of settings restores the workspace sidebar (spec navigates
  settings→page, asserts workspace tree returns).
- Mobile/responsive collapse still works on settings routes (no orphaned
  always-open drawer).
- A deep settings link (`/settings/admin/siem`) lands with the single settings
  nav, not a flash of both.

## E6 — Editor/page toolbar consolidation (ledger; polish-audit row 5) — REFACTOR

**Today:** the editor control strip (`editor.tsx`) and the page action bar
(`page.tsx`) render as two stacked toolbars. **Build:** fold the editor
status/outline/suggest group into the single page action bar — one toolbar row.
Largest E item; **first declared cut candidate if scope slips** (README lists
F3/E6/E5 as the pre-agreed cut order — reconciled here: E6 is the largest
refactor, cut before E5).

**Failure modes verified:**
- Focus-mode / reader-mode toggles still reachable from the consolidated bar
  (spec toggles each).
- Suggest + bibliography + outline controls keep their disabled-in-lock states
  (the D3-from-v0.6.0 lock contract; spec locks a page, asserts disabled).
- No horizontal overflow on a narrow viewport — the C2-from-v0.9.19 lesson: the
  bar wraps/scrolls, never pushes a control off-screen (spec at 360px asserts
  every action is in-viewport and clickable).

## E7 — Search-palette mount fade-in (ledger; polish-audit row 15) — minor

**Today:** the ⌘K palette mounts instantly. **Build:** `animate-in fade-in-0
zoom-in-95 duration-150`, motion-reduce safe.

**Failure modes verified:**
- `prefers-reduced-motion` → no animation (spec emulates reduced motion,
  asserts no transition).
- The fade does NOT delay focus-trap or the first keystroke — typing
  immediately on open still filters (spec opens + types in the same tick).
- No layout shift on open (CLS check; the palette is overlay-positioned).

## Release flow note

E2 ("What's new") ships **last in the entire release** so the panel can
announce v0.10.0's own CHANGELOG section once the tag exists. Every other E item
follows the standard per-item PR gate (spec path · RED-on-main · GREEN-on-branch
· live-deploy screenshot). E5/E6 are refactors — their specs assert behavior is
unchanged (nav still works, toolbar actions still fire), not new features.