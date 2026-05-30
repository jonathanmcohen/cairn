# Cairn UX Audit Patches (v0.9.2) — Plan Suite Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement these plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the 36-item live UX audit of Cairn v0.9.2 — fixing rendering bugs, replacing native form controls with themed components, repairing navigation gaps, and polishing empty/active states across the app.

**Branch:** all work lands on `patches/ux-audit-v0.9.2`, one PR into `main` at the end (held for user review — do NOT auto-merge).

**Tech Stack:** Next.js 16 (App Router, React 19, RSC), TypeScript strict, Tailwind v4 (`@theme` in `src/app/globals.css`), shadcn/ui (new-york), next-themes, TipTap 3, Drizzle ORM, Vitest 4 + Testcontainers, Biome 2.

**Verify gate (every plan):** `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test`; for UI/route changes also `pnpm build`. Commit per task (Conventional Commits), reference the GitHub issue (`Closes #NN`).

---

## Audit item → GitHub issue → Plan map

| Audit # | Summary | GH issue | Plan |
|--------:|---------|---------:|------|
| 1 | `emoji::` shortcode leaks into page list | #10 | P02 |
| 2 | Page icon + title overlap | #11 | P02 |
| 3 | Workspace switcher chevrons unclear | #12 | P02 |
| 4 | Theme toggle placement | #13 | P02 |
| 5 | Lower-nav hierarchy inverted | #14 | P02 |
| 6 | Version footer dead text | #15 | P02 |
| 7 | Two "Add cover" affordances | #16 | P03 |
| 8 | Duplicate top-right floating box | #17 | P03 |
| 9 | Empty whitespace right of content | #18 | P03 |
| 10 | Empty DB block no header row | #19 | P03 |
| 11 | Headings in callouts full size | #20 | P03 |
| 12 | Language picker native `<select>` | #21 | P01 |
| 13 | `/tasks` 404 → redirect | #22 | P04 |
| 14 | Bare default 404 page | #23 | P04 |
| 15 | `/my-tasks` lowercase filter tabs | #24 | P05 |
| 16 | `/my-tasks` weak active filter state | #25 | P05 |
| 17 | `/my-tasks` terse empty state | #26 | P05 |
| 18 | `/my-tasks` native date input | #27 | P01 |
| 19 | `/notifications` native status `<select>` | #28 | P01 |
| 20 | `/notifications` native date pickers | #29 | P01 |
| 21 | `/notifications` pills no active state | #30 | P06 |
| 22 | `/notifications` plain empty state | #31 | P06 |
| 23 | Profile missing email/display name | #32 | P07 |
| 24 | Profile User ID no copy button | #33 | P07 |
| 25 | Developer "Create key" off-theme button | #34 | P07 |
| 26 | Developer missing MCP info surface | #35 | P07 |
| 27 | Templates no built-ins listed | #36 | P08 |
| 28 | Templates no "Save as template" CTA | #37 | P08 |
| 29 | Cross-cutting native form controls | #38 | P01 |
| 30 | Page tab strip no separators/active | #39 | P03 |
| 31 | Bell drawer not verified | #40 | P06 |
| 32 | Workspace chevron click target too small | #41 | P02 |
| 33 | Sidebar resize handle missing | #42 | P02 |
| 34 | No ⌘K hint | #43 | P02 |
| 35 | Sign out raw, no separation | #44 | P02 |
| 36 | No Settings nav entry | #45 | P02 |

## Plans

- **P01** — `…-01-themed-form-controls.md` — Foundation: build `ui/select` + themed date control, migrate audit-scoped native controls. **Do first** (P05/P06 depend on it).
- **P02** — `…-02-sidebar-nav-chrome.md` — Sidebar rendering bugs, hierarchy, version link, Settings entry, ⌘K hint, switcher.
- **P03** — `…-03-page-editor-surface.md` — Cover dedup, control consolidation, column/whitespace, empty DB header, callout typography, tab strip.
- **P04** — `…-04-routing-and-404.md` — `/tasks` redirect + themed app-root 404.
- **P05** — `…-05-my-tasks-polish.md` — Title-case tabs, active state, empty state.
- **P06** — `…-06-notifications-polish.md` — Pills toggle state, empty state, bell-drawer verification.
- **P07** — `…-07-settings-surfaces.md` — Profile fields + copy, UUID copy button, primary button, MCP info.
- **P08** — `…-08-templates.md` — Built-in seed/listing fix, "Save as template" CTA.
- **P09** — `…-09-codeblock-language.md` — Code block language selector + lowlight highlighting (#47). *(Added to batch.)*
- **P10** — `…-10-callout-types.md` — Semantic callout variants note/tip/warning/error/info + picker (#48). *(Added to batch.)*

## Later additions (beyond original 36-item audit)

| GH issue | Summary | Plan |
|---------:|---------|------|
| #47 | Code blocks: no language selector / no highlighting | P09 |
| #48 | Callouts: selectable semantic types | P10 |

## Suggested execution order

P01 → P04 → (P02, P03, P05, P06, P07, P08 in any order) → P09 → P10. P05/P06/P09/P10 reuse the P01 `Select` primitive, so land P01 first. P09 + P10 both edit `extensions.ts` — run them sequentially.
