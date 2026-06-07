# v0.9.11 Scope — Flashcard fixes + post-v0.9.10 verification

> # ⛔ HOLD — plan only, no code until explicit GO.
> Hotfix release. Single branch `patches/v0.9.11` · single PR · GitHub-hosted runners · Biome 0 errors · i18n en/es/ar for new strings · full `pnpm vitest run` in the gate · e2e a11y gate (the new structural gate).

## ⚠️ Triage first — most reported items are STALE-DEPLOY, not code bugs

The live env (`cairn.local.jonco.dev`) is **behind**: v0.9.9 crash-looped on the migration-skip bug; **v0.9.10 is not deployed yet**. A code audit on `main` (v0.9.10) shows **12 of the 17 reported items already fixed in code** — they only appear broken because the deployed image predates the fix. **Redeploy `ghcr.io/jonathanmcohen/cairn:v0.9.10` first, then re-test.** Expect 12 to clear with zero code change.

Only **5 items are genuine code bugs** present on `main`. Those are the actual v0.9.11 scope.

---

## Plans index (TDD docs)

| Plan | File | Covers | Migration |
|------|------|--------|-----------|
| **A** | [plan-a-flashcards-srs.md](plan-a-flashcards-srs.md) | #114 collab-save SRS reconcile · #115 block-id mint · #116 study CTA→/search | none |
| **B** | [plan-b-account-editor-fixes.md](plan-b-account-editor-fixes.md) | #126 dup display-name label · #127 color/highlight swatch popover | none |
| **C** | [plan-c-sidebar-density.md](plan-c-sidebar-density.md) | #130-revised text 13/18 (a11y-safe) · #131 width 224 · #132 palette pad | none |
| **U** | [plan-u-notion-polish.md](plan-u-notion-polish.md) | polish-audit PATCH set: typography+Inter, status-color tokens, handle transition, cover hairline, button press-scale, empty-state icons, skeleton | none |

**Build order:** A (only P0) → B → C → U (B/C/U independent). Single PR onto `patches/v0.9.11`, version 0.9.10 → 0.9.11. **No migration** (0068 stays latest). REFACTOR items deferred; 12 stale-deploy items verify-live after v0.9.10 redeploy.

---

## GENUINE v0.9.11 bugs (5) — real fixes

| # | P | Theme | Bug | Root cause (file:line) |
|---|---|-------|-----|------------------------|
| **#114** | **P0** | Flashcards | Editor-created card never reaches SRS → `/flashcards/study` shows "No cards due" | Live editor autosaves via **collab** `onStoreDocument` → `collab/server.ts:35-48,83-87` `materialize()` does a raw `UPDATE pages SET content` and **never calls `reconcileFlashcards`**. SRS upsert only runs on the REST PATCH path (`src/lib/pages/update.ts:109`), which the editor doesn't use for body edits. |
| **#115** | **P0** | Flashcards | `data-block-id=""` empty on flashcard div; card never persists to `flashcard_cards` | No global block-id plugin; `blockId` only minted inside `extractFlashcardBlocks` (`src/lib/pages/reconcile.ts:35-38`), which never runs on the collab save path (same root as #114). `flashcard-node.ts:41,57` defaults `blockId=null`. Needs client-side id minting at insert + reconcile on collab save. |
| **#116** | **P1** | Flashcards | Study empty-state "Browse pages" → home, not a has-flashcards view | `src/components/empty-state/variants.tsx:72` hard-codes `ctaHref="/"`. |
| **#126** | **P1** | Account | "Display name" label rendered twice (stacked) | Both the page `<dt>` (`settings/account/profile/page.tsx:49`) **and** the embedded `ProfileForm` `<label>` (`account/profile-form.tsx:46-47`) print it. Drop one. |
| **#127** | **P1** | Editor | Color control applies hardcoded red on click; no swatch dropdown | `editor-bubble-menu.tsx:38,167-171` — `TEXT_COLOR='#dc2626'` single toggle; palette explicitly punted (`:161`). Add a color/highlight swatch popover. |

### Flashcard note
#114 + #115 are one knot: the **collab store path bypasses flashcard reconcile + block-id minting**. Fix = call `reconcileFlashcards`/block-id extraction from the collab `onStoreDocument` hook (and mint a client-side block id when the node is inserted so `data-block-id` is non-empty pre-save). Fixing that revives the entire flashcard SRS feature.

---

## STALE-DEPLOY (12) — verify after deploying v0.9.10, NO code expected

All confirmed present in `main` (v0.9.10). Re-test post-redeploy; only escalate to a real bug if still broken.

| # | Item | Present at |
|---|------|-----------|
| #113 | Flashcard NodeView renders Front/Back | `editor/extensions/flashcard.tsx:14-39`, lazy-wired `extensions-lazy.ts:38` |
| #117 | Heading-collapse chevron (D6) | `editor/heading-collapse.tsx` |
| #118 | Suggestions inline diff (S1) | `lib/suggestions/diff-preview.ts` + `suggestions-drawer.tsx` |
| #119 | Whole suggest-chip clickable (S2) | `editor/suggestion-toolbar.tsx` |
| #120 | Notification matrix approval/status/lock (I4) | `db/schema/notifications.ts:40-42` |
| #121 | `/settings/admin` → `/audit` (C4) | `settings/admin/page.tsx` redirect |
| #122 | New page default Draft (K2) | `lib/pages/create.ts:48` + mig 0066 |
| #123 | See-also score differentiation (F6) | `lib/search/see-also.ts:132` min-max rescale |
| #124 | Passkeys env-var admin-gated (H4) | `security/passkeys/page.tsx:31,39` |
| #125 | Encryption disabled-card copy when flag off | `settings/security/encryption/page.tsx:17,24` |
| #128 | Slash menu dismiss on /flashcard modal | `slash-extension.ts:742-759` + `onExit popup.destroy()` |
| #129 | Semantic-only snippets (G3) | `lib/pages/search.ts:13,64,69` (excerpt + snippet) — document: parity exists |

#113 caveat: NodeView is lazy-loaded; if it's still blank after redeploy, the real bug is a lazy-load/registration failure → reclassify P0.

---

## Plan C — sidebar density refinement (#130–133)

Measured live = 256px wide, ~44px rows, 58px palette button, 9–10 items above fold. Goal: 14–16 above fold. Audit on v0.9.10 code:

| # | P | Item | Code state | Verdict / action |
|---|---|------|-----------|------------------|
| #130-tree | — | PAGES tree rows 44px | `ROW_HEIGHT_PX = 30` (`virtualized-page-tree.tsx:28`), icons `h-4` (16px) | **STALE-DEPLOY** — already 30px in code; live 44px is the pre-v0.9.10 image. Redeploy fixes. |
| #130-util | **P1** | Utility rows (Favorites/Inbox/My-tasks/Templates/Settings/Trash) 44px | `NAV_ITEM_CLASS` has `min-h-11` (`sidebar-footer-nav.tsx:21`) | **REAL but constrained.** 44px is the **WCAG 2.5.5 touch-target floor** enforced by `tests/a11y/mobile-touch-targets.spec.ts` (fixed in v0.9.9). Naive shrink → re-breaks the a11y gate. Needs **responsive density**: keep `min-h-11` at coarse-pointer/mobile, drop to ~`min-h-8` (32px) at `md:`+fine-pointer, AND scope the touch-target spec to a mobile viewport so desktop-compact rows pass. |
| #131 | **P1** | Sidebar default width 256px | `width: var(--cairn-sidebar-w, 16rem)` (`sidebar.tsx`); user-resizable + persisted | **REAL, free.** Drop fallback `16rem → 14rem` (224px). No a11y conflict. Users who dragged it keep their stored width. |
| #132 | P2 | Palette trigger 58px | `SearchHintButton` `min-h-11 py-2` (`search-hint-button.tsx:26`) | **REAL but floored at 44px** (same touch-target rule). `py-2`→`py-1.5` trims a little; can't go below 44 on touch. Apply same responsive approach as #130-util if sub-44 desired on desktop. |
| #133 | — | Tree icons 20px | already `h-4 w-4` (16px) everywhere | **DONE/STALE** — already 16px. No work. |

### #130-revised — it's the TEXT SIZE, not row height (a11y-safe, preferred)

User clarified the real ask: sidebar **body text is 14px/20px**, feels loose vs Notion 13.5 / Linear 13/18 / VSCode 13. **Shrinking font ≠ shrinking touch target** — keep `min-h-11` (44px floor intact, a11y gate stays green) and just reduce the *text*. This is the clean, mostly-free win; the row-height/`py` debate above is moot if we go text-first.

Tokenize in `globals.css`:
- `--cairn-sidebar-text: 13px` (from 14), `--cairn-sidebar-leading: 18px` (from 20)
- `letter-spacing: 0.1px` on body links for legibility at 13px
- Apply to: PAGES tree page-title spans, saved-search entry spans, utility-link spans (Favorites/Inbox/My-tasks/Templates/Settings/Trash), workspace switcher "Homelab", "Sign out" text.
- **Keep section labels at 12px** (already correct), kbd 10px, badge 10px (already correct).
- Optional `py` 6→4 *inside* the 44px min-h: tightens visual block without dropping below the touch floor (min-h wins).

Net: text feels dense/tool-like, rows still ≥44px for touch, a11y gate untouched. Effective visible rows rise via reduced leading + the post-redeploy tree compaction (30px) + width 224.

**Honest take:** the "9–10 above fold" is mostly **stale deploy** (tree rows are 30px, not 44px, once v0.9.10 ships). Genuine a11y-safe wins: **text 14→13 / lh 20→18 (#130-revised)** + **width 256→224 (#131)**. Dropping the interactive rows *below* 44px tall remains a deliberate a11y trade (desktop-only responsive + spec change) — only if text-size alone isn't dense enough. **Decide on GO.**

## Plan shape (on GO)
Single PR onto `patches/v0.9.11`, version `0.9.10 → 0.9.11`:
1. **Flashcard ingest (P0, #114/#115):** call flashcard reconcile + block-id mint from the collab `onStoreDocument` path; client-side block-id on node insert. TDD: collab-save → SRS row exists; reconcile idempotent. (Likely no migration — reuses `flashcard_cards`.)
2. **Study CTA (#116):** point empty-state CTA at a has-flashcards view (new `/flashcards` browse or `/?filter=has-flashcards`). Decide target on GO.
3. **Profile dup label (#126):** remove the redundant `<dt>` or the form `<label>`.
4. **Color picker (#127):** swatch popover for text color + highlight in the bubble menu; i18n the swatch labels.
5. **Sidebar density (C):** #130-revised text 14→13 / lh 20→18 + 0.1px tracking (a11y-safe, keeps min-h-11); #131 width 16rem→14rem. #132 palette py trim. Optional desktop-only sub-44 row trade only if needed. #130-tree/#133 = no-op (stale/done).
6. Gate: lint 0 · typecheck · i18n none-new · full vitest · build · a11y e2e.

## Migrations
None expected (0068 stays latest). Flag if #114 needs a backfill for already-orphaned editor cards.

## Plan U — Notion polish pass

Code/token design audit (full detail: [`polish-audit.md`](polish-audit.md)). 20 dimensions: **6 SHIP · 9 PATCH · 3 REFACTOR · 2 VERIFY-LIVE**. **Migration = none.** No live screenshot possible (LAN-only + stale deploy); 2 items wait on v0.9.10 redeploy.

### PATCH — ship in v0.9.11 (token/class only, a11y floor untouched)

| P | Task | File:line | Fix |
|---|---|---|---|
| **P1** | Sidebar density (xref §130-revised) | `globals.css:157`, `sidebar.tsx:26`, `sidebar-footer-nav.tsx:21` | text 14→13 / lh 20→18 / `0.1px` tracking; width `16rem→14rem`. Keep `min-h-11`. |
| **P1** | Status colors → tokens | `editor.tsx:86-91`, `suggestion-toolbar.tsx:123,130` | `bg-amber/emerald-500`→`bg-warning/bg-success`; `text-green/red-700`→`text-success/text-destructive` (tokens already exist `globals.css:82-85`). |
| **P1** | Button press + drawer/palette timing | `ui/button.tsx:8`, `ui/sheet.tsx:40`, `search-palette.tsx:220` | `active:scale-[0.98]` (+ `motion-reduce` reset); pin enter 200ms ease-out / exit 150ms; palette `animate-in fade-in-0`. |
| **P2** | Block-handle hover transition | `drag-handle.tsx:101,111` | add `transition-colors duration-150`. |
| **P2** | Editor prose rhythm | `globals.css` (new scoped block) | base 16px/1.6; H1 1.875/600 · H2 1.5/600 · H3 1.25/600 · `tracking-[-0.01em]`; title `tracking-tight`. |
| **P2** | Empty-state icons | `empty-state/variants.tsx` | add icons to Search/Trash/Inbox/Backlinks/Recents for parity. |
| **P3** | Cover hairline (optional) | `cover-banner.tsx` | bottom `border-b` so banner doesn't butt flush into white. |
| **P2** | Skeleton primitive | new `ui/skeleton.tsx` | `animate-pulse rounded bg-muted motion-reduce:animate-none`; use in search results / notifications drawer / see-also (>300ms loads). |

### REFACTOR — defer (larger / structural, not v0.9.11 hotfix-shaped)

| P | Task | Why defer |
|---|---|---|
| R1 | Shared `Badge` primitive + migrate 5 ad-hoc pills (status ×2, suggest, bib, editor status) | New component + multi-callsite migration. |
| R2 | Right-rail slide-in (comments/outline/version-history/suggestions → `ui/sheet.tsx`) | 4 rails currently pop instantly; route through animated Sheet. |
| R3 | Single sidebar in `/settings` (hide workspace `<Sidebar>`; `app/(app)/layout.tsx:69` + `settings/layout.tsx:13`) | Layout/route-group change. |

### VERIFY-LIVE (after v0.9.10 deploy, no code expected)
- Toolbar rows: editor strip vs page action bar reading as two toolbars — only consolidate (R-tier) if confirmed cluttered.
- Mobile auto-collapse < 768px (`sidebar.tsx:12` `md:flex` + `sidebar-drawer.tsx` `md:hidden`) — wired correctly in code; confirm runtime smoothness.

### Gate (Plan U adds nothing new)
Same as Plan shape §6: lint 0 · typecheck · i18n none-new (token/CSS changes carry no new strings; empty-state icons reuse existing keys) · full `pnpm vitest run` · build · a11y e2e. **The a11y gate stays green precisely because every PATCH is font/leading/color/timing — no interactive height drops below the 44px touch floor.** REFACTOR items, if taken, must re-run the touch-target spec.
