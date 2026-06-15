# Plan Q — UI quality sweep (v0.10.2 live: broken or rough)

> **HOLD: do not touch code until the user replies GO on Plan A11Y (then CFG, then Q).** Scaffold only.
> REQUIRED SUB-SKILL at execution: superpowers:subagent-driven-development.

**Goal** — re-audit each item against repo + live browser; ship the GAPs, close
the SHIPPED ones with proof. Per item: **verdict SHIPPED (file:line + live
screenshot, no code) or GAP (missing file:line → build → spec → screenshot)**.
Many items below reference v0.10.2 work and are expected to close at audit.

Status legend: **SHIPPED** = already in the codebase (file:line proof, no code change, live screenshot at deploy) · **SHIPPED✚PR** = GAP/PARTIAL built this milestone (PR ref) · **BUILD** = still to build.

| # | Item | Likely | Re-audit verdict (locked) |
|---|------|--------|---------------------------|
| Q-1 | Sign-out confirm dialog (#80 / S11) — modal "Sign out of <email>? [Cancel][Sign out]" | verify | **SHIPPED** — `src/components/sidebar-footer-nav.tsx:74` (useConfirm gate on the sign-out form submit) |
| Q-2 | Active sessions: per-row **Revoke** + "Sign out all other devices" (Settings → Security) | likely GAP | **SHIPPED✚PR** #437 — `revokeSingleSession` + `POST /api/auth/sessions/[id]/revoke` + per-row Revoke button (`sessions-card.tsx`) |
| Q-3 | Workspace storage card "Unlimited" → link to Storage (CFG-2) once landed; interim docs link | GAP (depends CFG-2) | **SHIPPED✚PR** #434 — `src/components/settings/storage-usage-card.tsx` (interim docs link; repoint to in-app Storage when CFG-2 lands) |
| Q-4 | Template-clone lands at sidebar root → default new page under Cairn Guide or user-pickable parent | GAP | **SHIPPED✚PR** #438 — instantiate route honors validated `parentId`; gallery "Add under…" destination picker (`template-destination-dialog.tsx`) |
| Q-5 | "Suggest edits" chip always shown → hide when page owned by current user AND no reviewer assignments | GAP | **WON'T-FIX** (#433 closed) — no reviewer model exists; the re-scoped owner+draft hide broke the suggest-edits feature (12 e2e: item-53/53-54/54, E4-suggest-auto-mark, E6-toolbar). Track-changes is authored *on your own draft*, so the chip there is the feature's entry point, not noise. Chip stays always-shown |
| Q-6 | TRANSLATIONS panel always shown → hide until first link OR collapse by default | GAP | **SHIPPED✚PR** #430 — `src/components/pages/translations-picker.tsx:63` (viewer + empty → null) |
| Q-7 | SEE ALSO similarity % no legend → hover tooltip (cosine over embeddings); consider bar-only | GAP | **SHIPPED✚PR** #432 — `src/components/pages/see-also-panel.tsx:96` (`seeAlso.similarityTooltip`, kept digits + legend) |
| Q-8 | Trash row full timestamp → relative ("3 days ago") with absolute on hover | GAP | **SHIPPED✚PR** #431 — `src/components/trash-list.tsx:67` + `src/lib/datetime/format.ts` (`relativeFromNow`/`absoluteLocal`) |
| Q-9 | Workspace switcher dropdown width (v0.10.2 P16) | verify | **SHIPPED** — `src/components/workspace-switcher.tsx:128` (content width tracks trigger via `--radix-dropdown-menu-trigger-width`) |
| Q-10 | Empty SAVED SEARCHES header hidden when none (v0.10.2 S15) | verify | **SHIPPED** — `src/components/sidebar/saved-searches.tsx:82` (`return null` when empty) |
| Q-11 | Status pills all four render + color-blind-safe (Draft neutral / In review amber / Published green / Archived dim) — deuter/protan/tritan | verify+a11y | **SHIPPED✚PR** #435 — `src/components/pages/status-picker.tsx:34-38,61` (text label = non-color distinguisher; characterization test added) |
| Q-12 | Drag-to-reparent drop-indicator line renders on sibling-gap drag-over (v0.10.2 S8) | verify | **SHIPPED** — `src/components/sidebar/virtualized-page-tree.tsx:593` (drop-line span on before/after dropZone) |
| Q-13 | Slash-menu category rail renders left + click jumps scroll (v0.10.2 P9) | verify | **SHIPPED** — `src/components/editor/slash-menu.tsx:204` (rail on `showRail`; `jumpToGroup()` scroll) |
| Q-14 | Citation hover popover: author + year + first-line snippet (v0.10.2 P5) | verify | **SHIPPED** — `src/components/editor/extensions/citation.tsx:95` (CitationSup popover: author-year line + title) |
| Q-15 | Encryption page tone amber→blue info (v0.10.2 P13) | verify | **SHIPPED** — `src/components/admin/encryption-disabled-notice.tsx:22` (`border-info/40 bg-info/10 text-info`) |
| Q-16 | 404 page recovery search renders + queries workspace (v0.10.2 P17) | verify | **SHIPPED** — `src/app/not-found.tsx:34` (`<form action="/search" method="get">` + search input) |
| Q-17 | Workspace switcher renders uploaded icon image, not letter fallback (v0.10.2 S6) | verify | **SHIPPED** — `src/components/workspace-switcher.tsx:47` (`if (iconUrl)` → `<img>`, else letter) |
| Q-18 | PINNED section: drag-reorder works + pin/unpin from page ⋯ menu (not just Settings) | verify+GAP | **SHIPPED✚PR** #439 — sidebar dnd-kit drag-reorder (admin) + page ⋯ Pin/Unpin (`isWorkspacePinned`, `page-menu.tsx`, `pinned-section.tsx`) |
| Q-19 | Help → Keyboard shortcuts ⌘+Shift+/ binding actually wired (opens via shortcut) | verify | **SHIPPED** — `src/components/shortcuts/app-shortcuts.ts:104` (`Mod+/`) + `dispatcher.tsx:60` (bare `?`=Shift+/); proven by `question-mark-shortcut.test.ts` + e2e `item-E1` |
| Q-20 | Sidebar collapse ⌘+\\ — confirm intended behavior: fully-hidden vs 56px icon rail; ship rail or fix the doc | decision | **SHIPPED** — `src/components/shortcuts/app-shortcuts.ts:95` (`sidebar.toggle` → `toggleSidebarCollapsed`, flips the `cairn-sidebar-collapsed` root class). Behavior as built; a rail-vs-hidden change would be a separate decision |
| Q-21 | Trash + Archived empty-title rows render "Untitled" incl. pre-fix rows (v0.10.2) | verify | **SHIPPED** — `src/components/trash-list.tsx:67` + `src/components/archived-list.tsx:84` (`title.trim() \|\| t('trash.untitled')`, display-only so pre-fix rows covered) |

---

## Notes / dependencies

- **Q-3 depends on CFG-2** (Storage UI) — sequence Q-3 after CFG-2 or ship the
  interim docs link first.
- **Q-11 & Q-20** carry decisions (color-blind palette choice; collapse
  semantics) — resolve at GO; Q-20 may be doc-only if "fully hidden" was intended.
- **Verify items (Q-1, Q-9, Q-10, Q-12–Q-17, Q-19, Q-21)** must produce a live
  screenshot even when SHIPPED (proof of current behavior), per the artifact gate.
- Each GAP item gets a `tests/e2e/` UI-wiring spec driving the real browser:
  RED on `main`, GREEN on branch (×3), screenshot under
  `docs/superpowers/v0.10.3/artifacts/`.

## Coverage check (locked)

All 21 Q-# rows carry a verdict + file:line. **All 21 resolved** —
11 SHIPPED (verify-only, characterized where useful), 8 SHIPPED✚PR
(GAP/PARTIAL built: Q-2 #437, Q-3 #434, Q-4 #438, Q-6 #430, Q-7 #432, Q-8 #431,
Q-11 #435, Q-18 #439), Q-19 SHIPPED (no code), **Q-5 WON'T-FIX** (#433 closed —
owner+draft hide broke the suggest-edits feature; chip stays always-shown).
Plan Q is **complete**; remaining v0.10.3 work is Plan CFG + the canary-blocked
A11Y-2..5.

## Failure-modes-verified (locked)

- [n/a] Q-5 — WON'T-FIX. No reviewer-assignment model exists, and the re-scoped owner+draft hide broke the suggest-edits feature (it's authored on your own draft; 12 e2e regressed). The chip stays always-shown, so there is no hide-logic to verify.
- [x] Q-8 relative date: hover reveals exact absolute timestamp (`title={absoluteLocal(...)}`) — `tests/components/trash-list.test.tsx`.
- [x] Q-11 palette: the four pills carry text labels (non-color distinguisher), so they survive simulated deuter/protan/tritan and monochrome — `tests/components/status-picker.test.tsx`.
- [x] Q-21 pre-fix rows: the "Untitled" fallback is display-only (`title.trim() || t('trash.untitled')`), so existing empty-title rows render it with no re-save/migration.

## Open questions for GO

- Q-7: hide the % digits entirely, or keep digits + add tooltip?
- Q-11: which color-blind-safe palette (Okabe-Ito? Cairn token set?).
- Q-20: is fully-hidden collapse intended, or is the 56px icon rail the target?
- Q-18: should non-admin members pin/unpin, or admins only?
