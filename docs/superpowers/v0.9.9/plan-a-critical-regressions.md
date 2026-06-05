# v0.9.9 Plan A — Critical Regressions (P0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the 5 P0 regressions that shipped broken: sign-out, workspace general 500 hardening, slash-command parser, sidebar URL aliases, comment mention rendering.

**Architecture:** Single PR onto `patches/v0.9.9`. Auth.js v5 server-action sign-out; RSC error boundary + narrowed select; ProseMirror slash-command range/cancel correctness; Next redirects; comment-body mention render pipeline.

**Tech Stack:** Next 16 App Router · Auth.js v5 (`signOut()` from `src/lib/auth/config.ts:220`) · TipTap 3 / ProseMirror · Drizzle · Vitest 4 + Testcontainers · Playwright (GitHub-hosted only).

**Gate (every task + group):** `pnpm lint` (0 err) · `pnpm typecheck` · `pnpm i18n:check` (none new) · **full `pnpm vitest run`** · `pnpm build` · route-reachability + feature e2e smoke. i18n en/es/ar for new strings.

---

## A1 — Sign-out restore (#80, P0 security; REGRESSION v0.1.0)

**Files:**
- Modify: `src/components/sidebar-footer-nav.tsx:50` (the bare `<form action="/api/auth/signout" method="post">`)
- Modify: `src/components/security/sessions-card.tsx:121` (same CSRF-less defect)
- Create: `src/app/(app)/logout/route.ts` (GET → signOut redirect)
- Create: `src/lib/auth/sign-out-action.ts` (`'use server'` action calling `signOut`)
- Test: `tests/e2e/auth-signout.spec.ts`

- [ ] **A1.1** Write failing e2e `tests/e2e/auth-signout.spec.ts`: sign in → click "Sign out" → assert redirect to `/login` + protected route now redirects to login (session cleared).
- [ ] **A1.2** Create `src/lib/auth/sign-out-action.ts`: `'use server'; import { signOut } from '@/lib/auth/config'; export async function signOutAction() { await signOut({ redirectTo: '/login' }); }`
- [ ] **A1.3** Rewire `sidebar-footer-nav.tsx` form: `<form action={signOutAction}>` (drop the manual `action="/api/auth/signout" method="post"`). Keep button markup + i18n `sidebar.signOut`.
- [ ] **A1.4** Same rewire in `sessions-card.tsx:121` (sign-out-others / this-session control — use the existing sessions action if present, else the new action).
- [ ] **A1.5** `src/app/(app)/logout/route.ts`: `export async function GET() { await signOut({ redirectTo: '/login' }); }` (muscle-memory `/logout`).
- [ ] **A1.6** Run e2e + full vitest. Commit `fix(auth): restore sign-out via server action + /logout (#80)`.

## A2 — Workspace general 500 hardening (#1, P0; REGRESSION pre-0.9)

**Note:** the live 500 is **ops** (missing migration 0054 `workspaces.icon`) — cleared by redeploy+migrate, NOT this plan. This plan hardens so a lagging column degrades gracefully.

**Files:**
- Modify: `src/app/(app)/settings/workspace/general/page.tsx:14` (narrow the bare `.select()`)
- Create: `src/app/(app)/settings/error.tsx` (RSC error boundary)
- Modify: `src/server/entrypoint.ts` / `src/db/migrate.ts` (fail-loud on pending migrations)
- Test: `tests/components/settings/general-error-boundary.test.tsx`, `tests/lib/upgrade/pending-fail-loud.test.ts`

- [ ] **A2.1** Narrow `general/page.tsx:14` `.select()` to the exact columns the page reads (id, name, icon, …) so an unrelated lagging column can't 42703 the whole page. Test asserts the projection.
- [ ] **A2.2** Add `src/app/(app)/settings/error.tsx` — `'use client'` error boundary rendering a recoverable "couldn't load — retry" instead of the bare Next digest. Test: boundary renders on thrown child.
- [ ] **A2.3** Entrypoint fail-loud: if `compareJournalToDb` reports pending migrations at boot, log a explicit fatal + non-zero exit (don't silently serve a half-migrated DB). Test the helper path.
- [ ] **A2.4** Gate + commit `fix(settings): harden workspace-general against lagging columns + error boundary (#1)`.

## A3 — Slash-command parser (#38/76/77/111/112, P0; REGRESSION v0.9.6)

**Root:** `src/components/editor/slash-extension.ts:786` — sync unconditional `deleteRange(range)` then async/early-returning `props.command`. In non-paragraph blocks range excludes the `/` trigger → stray char + merged text; on cancel text already deleted → lone `/`; no `preventDefault` on Enter.

**Files:**
- Modify: `src/components/editor/slash-extension.ts:785-788` (command), `slash-menu.tsx:112` (Enter handling)
- Test: `tests/components/editor/slash-parser-fuzz.test.ts`

- [ ] **A3.1** Failing fuzz test: every slash command × {empty paragraph, H1, bullet list item, blockquote} × {Enter-select, click-select, Escape-dismiss}. Assert: selected → block inserted + no stray chars + trigger consumed; dismissed → original text intact, no lone `/`.
- [ ] **A3.2** Fix range: compute a range that includes the leading `/` trigger in all block contexts (not the suggestion-provided range that drops it in headings).
- [ ] **A3.3** Restore-on-cancel: only `deleteRange` once the command will actually insert; for async commands (dialog/lazy) delete after resolution, and on cancel/early-return leave text untouched.
- [ ] **A3.4** `preventDefault` on Enter in slash-menu so the keystroke can't leak to the underlying editor (no block-split / stray char).
- [ ] **A3.5** Run fuzz + full vitest. Commit `fix(editor): slash-command range + cancel correctness across block types (#38)`.

## A4 — Sidebar URL redirect-alias safety net (#2/3/4)

**Note:** source hrefs already correct (`/settings/workspace/trash`, `/settings/developer/tokens` — verified). The reported 404s were stale-deploy. This adds aliases so the typed URLs resolve + a reachability test.

**Files:**
- Modify: `next.config.mjs` (`async redirects()`)
- Modify: `src/components/settings/sidebar.tsx` (channel-links entry — wire or remove)
- Test: `tests/unit/redirect-aliases.test.ts`, `tests/a11y/settings-routes-reachable.spec.ts`

- [ ] **A4.1** Add redirects: `/trash-retention`→`/settings/workspace/trash`, `/access-tokens`→`/settings/developer/tokens` (308). Test the config.
- [ ] **A4.2** Channel-links (#4): the sidebar entry points at `/admin/chat-bridge/channels` (exists). Either keep (it resolves) or fold into Plan C's chat-bridge relocation — for A4, confirm it resolves + leave a note. No dead `/channel-links` route.
- [ ] **A4.3** Route-reachability Playwright: visit every settings/admin/developer slug, assert 200 + known element. Commit `feat(nav): URL aliases + route-reachability smoke (#2/#3/#4)`.

## A5 — Comment mention render (#72, P0; REGRESSION v0.3.0)

**Root:** `src/components/comments/comment-panel.tsx:189` renders `{comment.body}` raw; `@[Name](uuid)` token never parsed to a pill on the read path.

**Files:**
- Create: `src/lib/mentions/render.tsx` (parse `@[Name](uuid)` → React nodes / pills)
- Modify: `src/components/comments/comment-panel.tsx:189`
- Test: `tests/lib/mentions/render.test.tsx`, `tests/components/comments/comment-mention-render.test.tsx`

- [ ] **A5.1** Failing test: `comment.body = "Hello @[Jon](uuid) testing!"` renders a `@Jon` pill element + preserves surrounding text, no literal `@[`.
- [ ] **A5.2** `src/lib/mentions/render.tsx`: pure tokenizer splitting body on the `@[Name](uuid)` pattern → text + `<MentionPill>` nodes (reuse the editor mention styling class). Handles 0, 1, N mentions + adjacent text.
- [ ] **A5.3** Wire into `comment-panel.tsx:189` (replace `{comment.body}` with `renderCommentBody(comment.body)`). Keep `whitespace-pre-wrap`.
- [ ] **A5.4** Gate + commit `fix(comments): render @mention pills in comment bodies (#72)`.

## Group gate (before Plan B)
Full gate + the new **e2e UI-acceptance smoke** (sign-out works, slash insert clean in H1+paragraph, comment mention renders). Open single PR `patches/v0.9.9` → main referencing #80 #1 #38 #76 #77 #111 #112 #2 #3 #4 #72. **HOLD for user GO** before Plan B.
