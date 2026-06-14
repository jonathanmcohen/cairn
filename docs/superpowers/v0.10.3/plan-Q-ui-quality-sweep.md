# Plan Q — UI quality sweep (v0.10.2 live: broken or rough)

> **HOLD: do not touch code until the user replies GO on Plan A11Y (then CFG, then Q).** Scaffold only.
> REQUIRED SUB-SKILL at execution: superpowers:subagent-driven-development.

**Goal** — re-audit each item against repo + live browser; ship the GAPs, close
the SHIPPED ones with proof. Per item: **verdict SHIPPED (file:line + live
screenshot, no code) or GAP (missing file:line → build → spec → screenshot)**.
Many items below reference v0.10.2 work and are expected to close at audit.

| # | Item | Likely | Re-audit verdict (TBD at lock) |
|---|------|--------|--------------------------------|
| Q-1 | Sign-out confirm dialog (#80 / S11) — modal "Sign out of <email>? [Cancel][Sign out]" | verify | _SHIPPED-or-GAP file:line_ |
| Q-2 | Active sessions: per-row **Revoke** + "Sign out all other devices" (Settings → Security) | likely GAP | _TBD_ |
| Q-3 | Workspace storage card "Unlimited" → link to Storage (CFG-2) once landed; interim docs link | GAP (depends CFG-2) | _TBD_ |
| Q-4 | Template-clone lands at sidebar root → default new page under Cairn Guide or user-pickable parent | GAP | _TBD_ |
| Q-5 | "Suggest edits" chip always shown → hide when page owned by current user AND no reviewer assignments | GAP | _TBD_ |
| Q-6 | TRANSLATIONS panel always shown → hide until first link OR collapse by default | GAP | _TBD_ |
| Q-7 | SEE ALSO similarity % no legend → hover tooltip (cosine over embeddings); consider bar-only | GAP | _TBD_ |
| Q-8 | Trash row full timestamp → relative ("3 days ago") with absolute on hover | GAP | _TBD_ |
| Q-9 | Workspace switcher dropdown width (v0.10.2 P16) | verify | _SHIPPED-or-GAP file:line_ |
| Q-10 | Empty SAVED SEARCHES header hidden when none (v0.10.2 S15) | verify | _SHIPPED-or-GAP file:line_ |
| Q-11 | Status pills all four render + color-blind-safe (Draft neutral / In review amber / Published green / Archived dim) — deuter/protan/tritan | verify+a11y | _TBD_ |
| Q-12 | Drag-to-reparent drop-indicator line renders on sibling-gap drag-over (v0.10.2 S8) | verify | _SHIPPED-or-GAP file:line_ |
| Q-13 | Slash-menu category rail renders left + click jumps scroll (v0.10.2 P9) | verify | _SHIPPED-or-GAP file:line_ |
| Q-14 | Citation hover popover: author + year + first-line snippet (v0.10.2 P5) | verify | _SHIPPED-or-GAP file:line_ |
| Q-15 | Encryption page tone amber→blue info (v0.10.2 P13) | verify | _SHIPPED-or-GAP file:line_ |
| Q-16 | 404 page recovery search renders + queries workspace (v0.10.2 P17) | verify | _SHIPPED-or-GAP file:line_ |
| Q-17 | Workspace switcher renders uploaded icon image, not letter fallback (v0.10.2 S6) | verify | _SHIPPED-or-GAP file:line_ |
| Q-18 | PINNED section: drag-reorder works + pin/unpin from page ⋯ menu (not just Settings) | verify+GAP | _TBD_ |
| Q-19 | Help → Keyboard shortcuts ⌘+Shift+/ binding actually wired (opens via shortcut) | verify | _SHIPPED-or-GAP file:line_ |
| Q-20 | Sidebar collapse ⌘+\\ — confirm intended behavior: fully-hidden vs 56px icon rail; ship rail or fix the doc | decision | _TBD_ |
| Q-21 | Trash + Archived empty-title rows render "Untitled" incl. pre-fix rows (v0.10.2) | verify | _SHIPPED-or-GAP file:line_ |

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

## Coverage check (fill at lock)

Every Q-# above resolves to exactly one verdict row with file:line proof; GAP
rows additionally map to a spec + screenshot. Table complete = GO-ready.

## Failure-modes-verified (fill at lock)

- [ ] Q-5 hide-logic: chip still shows when a reviewer assignment exists / page not owned by viewer.
- [ ] Q-8 relative date: hover reveals exact absolute timestamp (no info loss).
- [ ] Q-11 palette: simulated deuter/protan/tritan keep the four pills distinguishable.
- [ ] Q-21 pre-fix rows: existing empty-title trash/archived rows show "Untitled" without a re-save/migration.

## Open questions for GO

- Q-7: hide the % digits entirely, or keep digits + add tooltip?
- Q-11: which color-blind-safe palette (Okabe-Ito? Cairn token set?).
- Q-20: is fully-hidden collapse intended, or is the 56px icon rail the target?
- Q-18: should non-admin members pin/unpin, or admins only?
