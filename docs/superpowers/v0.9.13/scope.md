# v0.9.13 Scope — post-v0.9.12 browser-sweep findings

> # ⛔ HOLD — plan only, no code until explicit GO.
> Patch release. Single branch `patches/v0.9.13` · single PR · GitHub-hosted runners · Biome 0 errors · i18n en/es/ar for new strings · full `pnpm vitest run` in the gate · e2e a11y gate.

## Release lineage (clarifying the v0.9.11 vs v0.9.12 question)

- **v0.9.11** (tag `v0.9.11`, PR #292): flashcard SRS ingest (#114/#115/#116) + account/editor fixes (#126/#127) + sidebar density (#130/#131/#132) + Notion-polish PATCH set. **Real release — not skipped.**
- **v0.9.12** (tag `v0.9.12`, PR #293): pure hotfix — the collab Docker image was missing `flashcards/reconcile-raw`, crash-looping `cairn-collab`. Contains **everything v0.9.11 shipped + the collab fix** (it is `main` HEAD).
- **Net:** deploying `v0.9.12` delivers all v0.9.11 work *and* a bootable collab service. The audit-log / backlinks / connectors / citation items that now appear "shipped" are mostly older features that were **stale-deploy** before — visible now only because the deployed image finally advanced. **Deploy `v0.9.12`; skip `v0.9.11`** (its image has the broken collab service).

---

## ⚠️ Triage first — code-checked, NOT browser-trusted (v0.9.8 lesson)

A browser sweep on the live v0.9.12 deploy flagged 9 items. A read-only code audit on `main` shows **5 of 9 are already PRESENT in code** — they are runtime bugs or hover/discoverability, NOT missing features. Only **4 are genuine code gaps.** Re-verify the PRESENT ones live before treating any as "missing."

### GENUINE code gaps (4) — real fixes for v0.9.13

| # | P | Item | Verdict | Root cause (file:line) |
|---|---|------|---------|------------------------|
| **#119** | P2 | Suggestion card: only buttons clickable, not whole chip | DEFINED-NOT-WIRED | `suggestions-drawer.tsx:63` — `<li>` container has no `onClick`; only Accept/Reject buttons do. Add a container click that focuses/scrolls to the suggestion (keep buttons stopPropagation). |
| **#76** | P1 | Slash text leaks into prior block after a slash-modal **Cancel** | NOT-WIRED | `slash-extension.ts:187` — the citation (and footnote) slash item opens a dialog but never `popup.destroy()`s and only calls `consumeSlashRange` on *resolve*, not on *cancel*, so the typed `/…` range survives. Mirror `openPagePicker` (which `popup.destroy()`s) + consume/clear the range on cancel. |
| **#136** | P2 | Citation modal: slash menu stays visible behind the modal | NOT-WIRED | Same root as #76 — `citationMenuItem.run()` (`slash-extension.ts:187`) doesn't `popup.destroy()` on open. Flashcard (#128) already does. Fix #76 + #136 together. |
| **#137** | P2 | Custom lock Duration: no **Minutes** option | NOT-WIRED | `lock-toggle.tsx:205-211` — select offers Hours + Days only. Add Minutes. (User asked "verify Minutes/Days" — Days present, Minutes absent.) |

### RUNTIME bugs (2) — code present, fails at run; needs live debug

| # | P | Item | Verdict | Notes |
|---|---|------|---------|-------|
| **#134** | **P1** | Template Preview modal → red "Could not load this preview" | route PRESENT | `template-preview-dialog.tsx:38` fetches `/api/templates/[id]` (`route.ts:16` exists). The handler exists but 500s live. **Needs runtime repro** (systematic-debugging): capture the actual server error — likely a data/parse/permission fault in the GET handler or a shape mismatch the dialog can't render. Add a test reproducing the failing case before fixing. |
| **#135** | P2 | Bookmark unfurl shows only URL + domain (no OG title/desc/image) | unfurl PRESENT | `bookmark.tsx:24` `unfurl()` fetches OG metadata + updates attrs. Live shows minimal card → the server-side OG fetch is failing (CSP/egress/timeout/parse) or the card was created pre-unfurl. **Needs runtime repro**: confirm the fetch path + why OG fields stay empty. Possibly an allowlist/egress restriction on the server fetch. |

### VERIFY-LIVE / likely-not-a-bug (3) — present in code, re-check before any work

| # | Item | Verdict | Notes |
|---|------|---------|-------|
| #117 | Heading-collapse chevron — "h2 bare, no chevron" | PRESENT | `heading-collapse.tsx:21` wired at `editor.tsx:611`. Chevron is **hover-only** by design — likely discoverability, not missing. Confirm on hover; if intended, no work (or make affordance more visible = polish). |
| #118 | Suggest-edits inline diff — "cards still by-author + Accept/Reject" | PRESENT | `diff-preview.ts:15` computed + rendered `suggestions-drawer.tsx:67`. Diff renders **only when a text diff exists**; a whole-block or no-op suggestion shows none. Confirm with a real word-level edit. |
| #58 | Reader mode — "no explicit Exit affordance" | PRESENT | `page-mode-toggles.tsx:62` is an explicit Eye toggle button (it *is* the exit). Candidate **won't-fix / relabel tooltip** ("Exit reader mode" when active) rather than a new control. |

---

## Confirmed SHIPPED in v0.9.12 (no action) — from the sweep
DOI citation w/ live CrossRef fetch + APA/MLA/Chicago picker (#64/E1) · connectors taxonomy (L1/L2) · SSO outlined buttons (H1) · bookmark block inline form + card · backlinks drawer (titles+snippets) · audit-log Action filter incl. `page.permission_*` (B) · template pills (P2). All confirmed live.

## Proposed v0.9.13 plan shape (on GO)
Single PR onto `patches/v0.9.13`, version `0.9.12 → 0.9.13`:
1. **#76 + #136 (P1/P2, one fix):** citation/footnote slash items `popup.destroy()` on open + consume/clear the slash range on cancel. TDD: cancel a slash-citation → no leaked `/` text, slash popup gone.
2. **#134 (P1):** systematic-debugging — repro the template-preview 500, add a failing test, fix the handler/shape.
3. **#119 (P2):** clickable suggestion card container (buttons keep stopPropagation).
4. **#137 (P2):** add Minutes to lock-duration select.
5. **#135 (P2):** diagnose + fix bookmark OG unfurl (likely server-fetch egress/parse).
6. **VERIFY-LIVE #117/#118/#58:** confirm live; only act if genuinely broken (likely tooltip/affordance polish at most).
7. Gate: lint 0 · typecheck · i18n en/es/ar for any new strings (lock "Minutes", reader "Exit" tooltip) · full `pnpm vitest run` · build · a11y e2e.

## Migrations
None expected.

## Standing CI debt (carryover, flagged at v0.9.11)
Workflows still pin `runs-on: [self-hosted, linux, x64]` — the 2-runner pool zombie-stalled the v0.9.11 release ~40 min. Migrating ci/a11y/security/embed/lighthouse to `ubuntu-latest` (the "GitHub-hosted only" discipline) would end the recurrence. Separate infra PR — decide alongside v0.9.13.
