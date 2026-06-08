# v0.9.15 Scope — Trash icon renderer hotfix

Single-bug patch off v0.9.14. No migration (latest stays 0068). Single PR.

## Plan W — renderer polish

**Bug (reported post-v0.9.14 deploy):** `/trash` shows every entry's icon as the literal string `emoji::` + a faint default doc icon, instead of the actual emoji.

**Root cause (verified in code):** `pages.icon` stores prefix-encoded values (`emoji::<unicode>` / `file::<uuid>`, legacy bare emoji). The sidebar tree, page title, and see-also panel all strip the prefix via `parseIcon` (`src/lib/pages/icon-format.ts`) before rendering — but `src/components/trash-list.tsx:58` rendered `{item.icon ?? '📄'}` raw. (User's report guessed `upload::`; actual prefix is `file::`.)

**Fix:**
1. New shared client-safe renderer `src/components/page-icon-inline.tsx` → `<InlineIcon value fallback fileFallback className />`. Routes through `parseIcon`: `emoji::`→bare char, bare emoji passthrough, `file::<uuid>`→neutral image glyph (signed image URLs stay server-side via the RSC `PageIconRender`), null/empty→`fallback` (default 📄). Client-safe (no `AUTH_SECRET`/`signFileUrl`).
2. Use it in `trash-list.tsx` (the bug).
3. DRY: migrate `virtualized-page-tree.tsx` (`renderNodeIcon`) and `see-also-panel.tsx` (`renderRelatedIcon`) — three near-identical local copies existed → one component. Visuals preserved via `fallback`/`fileFallback` props (page-tree: FileText fallback; see-also: 📄 fallback + 🖼️ file).
4. Regression test `tests/ui/icon-render.spec.ts` — every prefix form (emoji::, the exact `emoji::📄` repro, bare, file::uuid, malformed file::, null, empty).

**Out of scope / deferred:** resolving `file::` icons to actual signed images in client list views (Trash, sidebar) — requires a round-trip; both render the neutral glyph, matching existing convention.

**Gate:** Biome 0 errors · typecheck clean · `tests/ui/icon-render.spec.ts` + page-tree regression green · CI matrix on PR. Single PR → tag `v0.9.15` → GHCR image.
