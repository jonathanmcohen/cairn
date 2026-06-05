# Changelog

All notable changes to Cairn will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## [Unreleased]

## [0.9.10] - 2026-06-04

Hotfix for a v0.9.9 upgrade outage.

### Fixed
- **Migrations 0063–0068 skipped on upgrade (boot crash-loop).** Their journal
  `when` timestamps were stamped *earlier* than 0062's. drizzle's migrator runs
  an entry only when `max(applied.created_at) < entry.when`, so on any database
  that already had 0062 applied it silently skipped 0063–0068; the boot-time
  `assertNoPendingMigrations` guard then refused to serve (`FATAL: 6 pending
  migration(s) … first pending: 0063_db_row_body`). Re-stamped 0063–0068 with
  strictly-increasing `when` values above 0062. No SQL/schema change — the
  migrations themselves were correct, only their ordering metadata was wrong.
  Fresh installs were unaffected (the Testcontainers harness applies `*.sql` in
  filename order, which is why CI never caught it).
- Added `tests/lib/upgrade/journal-monotonic.test.ts` to enforce the drizzle
  upgrade invariant (newest migration holds the max `when`; idx ≥ 62 strictly
  increasing) so a non-monotonic journal can never ship again.

**Operators on v0.9.9:** redeploy from `ghcr.io/jonathanmcohen/cairn:v0.9.10`.
The entrypoint migrator will apply 0063–0068 on boot. No manual DB steps.

## [0.9.9] - 2026-06-04

Remediation release closing 112 findings from the v0.9.8 live browser audit
(GH #185–#277), grouped into 20 themed plans (A–T). 13 findings were tagged
`regression` — features marked done in prior releases that had silently broken;
each is restored with a test that pins the behavior. Migrations **0062–0068**.
**Operators should redeploy from `ghcr.io/jonathanmcohen/cairn:v0.9.9`** and let
the entrypoint migrator apply 0062–0068 at boot (a new fail-loud check aborts
startup on a half-migrated DB rather than serving it).

### P0 regressions restored (A)
- **Sign-out (#80, broken since v0.1.0, security)** — replaced the CSRF-less
  `<form action="/api/auth/signout">` with an Auth.js v5 server action; added a
  `/logout` GET convenience route.
- **Slash-command parser (#38/76/77/111/112, since v0.9.6)** — range now includes
  the `/` trigger across all block types; deferred commands delete-on-insert only
  and restore text on cancel; Enter captured in the menu.
- **Comment @mentions (#72, since v0.3.0)** — comment bodies render `@[Name](id)`
  as mention pills instead of raw tokens.
- **Workspace-general 500 (#1)** — narrowed the over-broad select + added an RSC
  error boundary so a lagging column degrades gracefully.

### Per-page ACL UI (B, #94/#259 — v0.7.0 backend finally wired)
- "Share & permissions" on every page's ⋯ menu; invite-by-email, owner role,
  pending invites, transfer-ownership; audit `page.permission_*` events.
  Migration **0062**.

### Editor polish, a11y, slash, suggestions (D, E, S)
- Toolbar tooltips/ARIA; markdown `**`/`~~` input rules; scoped blockquote quotes;
  selection bubble (color/highlight/turn-into/comment/align/sub-sup/inline-math);
  heading-collapse; block right-click context menu; outline drawer; lock mode keeps
  Suggest-edits + Bibliography visible-disabled (#9).
- Unified slash ergonomics; `/equation` live-preview modal; `/citation` DOI
  auto-fetch; comment-mention trailing text preserved (#73).
- Suggestions drawer renders per-suggestion inline diff; whole suggest chip is one
  target (#53/#54).

### Nav, search, database (C, F, G)
- Sticky compact sidebar; flex-grown PAGES tree (thin scrollbar, contained
  overscroll, sticky header, expand/collapse-all); chat-bridge relocated under
  `/settings/admin`; unified workspace "Export" label.
- Database row-detail drawer (migration **0063** `db_rows.body`); human-readable
  property-type labels + 8 new property types (migration **0064**); optimistic
  add-filter / add-view (popover-race fixed); See-also relative match-strength.
- Version-history + saved-search live-refetch via a client mutation bus; semantic
  search snippets + normalized scores (migration **0065**).

### Security UX (H)
- Consistent SSO buttons; friendly device labels + trusted-proxy-gated IPs in
  active sessions; E2EE-disabled card reframed as informational; passkey operator
  env-var names admin-gated; operations docs linked; approval 409 → friendly,
  self-clearing message.

### Onboarding, theme, empty states (K, J, I)
- Empty-title new pages with autofocus + naming nudge; new pages default **Draft**
  (migration **0066**); invite-member modal + copy-link; editable display name;
  avatar upload. 3-state theme toggle; light-mode contrast fixes; 44px theme
  swatches with live preview + hex prefill. Iconed empty states + CTAs across
  favorites/trash/flashcards/bell; Favorites + Inbox sidebar entries; SMTP-off
  banner CTA; notification matrix gains approval/status/lock types (migration
  **0067**); fuller webhook event catalog; API-key "Mint a token →" empty state.

### Polish (L, M, N, O, P, Q, R, T)
- Connector taxonomy disambiguated (Database sync vs Chat bridge); cover picker
  regrid + de-emphasized default + hex prefill + clickable cover + legacy-orange
  backfill (migration **0068**); icon-picker tooltips. Consolidated Export menu +
  HTML/DOCX export + ⌘⇧E shortcut + publish URL preview. Focus/read-mode tooltips,
  exit affordance, hot-edge sidebar reveal, per-page reset. Template preview drawer
  + simplified cards. Audit log resolves actor/target names + hides empty-metadata
  toggle. PAT scope tooltips. Comment edit affordance.

### Process
- New **e2e UI-acceptance gate**: route-reachability Playwright smoke on the
  deployed image — the structural fix for the 13 silent regressions (prior scope
  was checklist-completed without UI acceptance on a real container).
- Every per-plan gate ran the **full** `vitest run` (not touched-files-only),
  catching 5 cross-file test breaks before merge.

## [0.9.8] - 2026-06-01

Hotfix release reconciling the v0.9.7 production browser audit (items A–L).
**Operators must redeploy from `ghcr.io/jonathanmcohen/cairn:v0.9.8`** — several
audit findings (cover default, Admin tab, SSO route, E2EE banner, bibliography
badge) were artifacts of a stale running container; the source was already
correct on `main` and is now verified by tests.

### Audit reconciliation (already-correct on main; verified + improved)
- **Cover (C)** — confirmed default preset is `slate-dusk` (no orange); expanded
  curated palette; contrast warning now evaluates against the title-overlay color.
- **Admin tab (A)** — fixed the Admin parent-nav click; added the federated-search
  admin page and a dedicated user-management page.
- **SSO (B)** — moved SSO pages under `/settings/admin/sso/*` with redirects from
  the old `/admin/sso/*` paths (API routes unchanged).
- **E2EE (E)** — kept `CAIRN_ENABLE_E2E_ENCRYPTION` default-off; verified the
  flag-ON enroll → encrypt → decrypt → rekey path end-to-end; rewrote the admin
  banner to explain the env var; added an encryption admin guide.
- **Bibliography (D)** — added a live citation count to the bibliography toggle.

### New / built (F, G, H, I, J)
- **Chat OAuth (F)** — full Slack + Discord OAuth installers (migration 0060
  `chat_oauth_installs`): signed short-TTL CSRF state, SSRF-gated redirect URIs,
  bot tokens AES-256-GCM-sealed at rest and never logged. The manual
  webhook+secret path remains as a fallback. Removed the "coming in v0.10" copy.
- **Live refetch (G)** — `router.refresh()` on comment-add, favorites-reorder, and
  notification mark-read so server-rendered counts/badges/ordering stay consistent.
- **Orphan sweep (H)** — new `pages:purge-orphans` CLI (dry-run + soft-delete).
- **Collab resilience (I)** — exponential backoff + token re-fetch retry +
  dismissible offline banner; DNS-dependency ops note.
- **Workflow builder (J)** — AND/OR condition grouping (migration 0058), drag-
  reorder actions (migration 0059), searchable templates gallery, and a run-history
  sub-tab (migration 0061).

### Migrations
- 0058 workflow condition tree · 0059 action ordering · 0060 chat OAuth installs
  · 0061 automation run history.

## [0.9.7] - 2026-05-31

Post-release browser-audit-2 fixes (findings S–Y; closes #153–#159) plus a
full-app UI-reachability + ui-ux-pro-max quality sweep (audit-3; closes #161–#170).

### Audit-3 — reachability (every shipped feature now reachable in the UI)
- **Nav wiring + routes** (#161) — surfaced ~15 orphaned settings/admin pages
  (automation builder, webhooks, static export, SSO/SCIM, MFA policy, E2E toggle,
  upgrade, PAT tokens, PAT quotas, Swagger /api-docs, theme, trash retention,
  pinned pages, chat-bridge); added the missing `/search` and `/favorites` routes.
- **Databases** (#162) — filter editor, group-by picker, Kanban add-view, full-page
  database route, gallery empty-state CTA.
- **Collaboration** (#163) — mounted row/file comments, backlinks panel, submit-for-
  review + lifecycle status picker, page-translation linker, reminder materialization.
- **Search** (#164) — fts/semantic/hybrid mode toggle + `/search` results page +
  admin cross-workspace (federated) opt-in.
- **Connectors** (#165) — connectors landing (create + config + conflicts) + chat-
  bridge admin nav.
- **Citations** (#166) — DOI/PubMed lookup slash item + in-editor bibliography toggle.
- **SSO + ACLs** (#167) — per-IdP "Sign in with…" buttons + page-ACL management UI/API.
- **E2EE** (#168) — keypair enrollment (generate → seal → persist) wired into the
  per-page Encrypt action + workspace-wide toggle (no longer dead-ends) + rekey/
  member-removal flow.

### Audit-3 — ui-ux-pro-max quality
- **Critical** (#169) — global `prefers-reduced-motion` guard; restored focus-visible
  rings across inputs/links/palette; AA dark-mode contrast (`--destructive`/success/
  warning tokens, semantic banners); ≥40–44px touch targets; themed confirm dialogs
  on destructive upgrade/E2E actions; focus-trap + Esc on the command palette + cover
  modal; real labels on 2FA inputs.
- **Polish** (#170) — emoji→lucide structural icons; Loader2 busy states on async
  actions; empty states (gallery/automation/Unsplash); ≥12px text; truncation
  tooltips; single-image lightbox.

### Audit-2 (findings S–Y; closes #153–#159)

### Added
- **Automation visual workflow builder** (#154) — replaced the raw-JSON rule form
  with a Zapier/n8n-style canvas: trigger card, chainable AND/OR condition cards,
  typed action cards (notify / set-property / create-page / send-webhook), a
  "Test rule" dry-run panel, a templates gallery, flow-connector lines, and a
  run-history sub-tab. Builder editor-state persists in a new additive
  `automation_rules.builder` jsonb column (migration **0056**); the compiled rule
  shape stays compatible with the existing dispatcher.
- **Curated cover palette** (#155) — AA-safe gradient + muted-neutral cover presets
  (stable keys) replacing the solid-orange default; picker shows presets, recent
  uploads, an Upload CTA, and a one-click default.
- **WCAG contrast utility** (#159) — `src/lib/color/contrast.ts` (relative luminance
  + ratio + AA check) with a live <4.5:1 warning on user-pickable colors.

### Fixed
- **Real-time sidebar refresh** (#153) — the page tree now updates after add-child /
  duplicate without a manual refresh (`router.refresh()`); favorites / notifications
  / comments confirmed already self-refreshing (regression-pinned).
- **"See also" emoji shortcode** (#156) — related-page rows render the parsed page
  icon instead of raw `emoji::` text.
- **Sidebar search subtitle** (#157) — dropped the sub-12px "(command palette)"
  subtitle from the search label (the ⌘K badge already signals it).
- **Sidebar truncation tooltips** (#158) — truncated page/space names now expose the
  full title via a native `title` tooltip.

## [0.9.6] - 2026-05-30

> Audit-driven release resolving **every open issue from the v0.9.4 live-deploy audit** (#38, #70, #124, #129–#139, #141–#149, #150). One migration (`0055` — `auth_sessions`). Plans: `docs/superpowers/plans/v0.9.6/`.

### Added
- **Themed dialogs everywhere** — `ConfirmDialog`/`InputDialog`/`AlertDialog` primitives replace every native `window.confirm`/`prompt`; a framework-free editor dialog bus routes the slash-command prompts (footnote / citation / flashcard) through themed forms. A Biome `noRestrictedGlobals` rule now bans `confirm`/`alert`/`prompt` going forward (#138, #135).
- **WebAuthn passkeys** — passkey registration **and** passwordless login alongside TOTP.
- **Active sessions** — Settings → Security lists active sessions (current device marked) with **Sign out everywhere**, backed by a new `auth_sessions` store + a `sid` JWT claim with server-side revocation (#70).
- **Admin console** — functional audit-log viewer, member management, and SIEM-forwarder config pages (#132).
- **Connectors UI** — "Add connector" Slack/Discord create flow + a Developer-settings nav entry + themed empty state (#146, #147).
- **Move-to page picker** — searchable reparent destination picker in the page row actions + action bar (#124).
- **Page covers** — "Add cover" now opens a working picker (image upload + URL) (#108).
- **Suggestions drawer** — the "N open" suggesting-mode badge opens an accept/reject suggestions list (#85/#145).
- **Slash keyword aliases** — blocks are findable by synonyms (`/math`→Equation, `/img`/`/photo`→Image, `/iframe`/`/youtube`→Embed, etc.) (#149).
- **Workspace icon picker**; **🔒 Locked-until indicator** on locked pages (#134).

### Fixed
- **Embeddings work in the Docker image** — the embedder runs on the `onnxruntime-web` (WASM) backend, removing the native `onnxruntime-node` `.so` that was missing from the image (semantic search was silently dead). CI smoke boots the image + asserts `embedPage` writes a vector (#136).
- **Emoji picker** — grid now loads (data source points at the same-origin `emoji-data.json` instead of the CSP-blocked CDN); collapsed the duplicate search box; Escape + click-outside dismiss (#129, #130, #131).
- **Sidebar page-tree rows are clickable again** — full-bleed navigation overlay; the `…`/`+` actions no longer steal the row click (#150).
- **Image & file blocks** render a visible empty-state placeholder/CTA when empty instead of nothing (#139, #148).
- **Editor edge-glow** — the global `:focus-visible` accent ring no longer leaks onto the editor surface / slash menu (#110, #133).
- **Swagger `/api-docs`** — server URL uses the public origin, version reflects the running build, dark theme, back-to-Cairn link (#141).
- **Database views** — `+ Add view` shows per-type icons + tooltips on disabled Calendar/Timeline; empty databases show an "Add your first row" CTA (#142, #143, #144).
- **Collab auth** — `onAuthenticate` logs the rejection reason; docs note the shared-`AUTH_SECRET` requirement (#137).

### Changed
- **All native form controls replaced** — every remaining native `<select>` / date input swapped for the themed `Select`/`DateField`; a CI guard prevents regressions (#38).
- Sidebar search input label clarifies it opens the command palette (#84).

## [0.9.5] - 2026-05-30

> **Hotfix.** Startup migrations could silently no-op, leaving the schema behind the code. v0.9.4's `workspaces.icon` column (migration `0054`) was never created on deployments whose container started the server from a working directory other than the image root — every workspace fetch then threw `column "icon" does not exist` (Postgres `42703`) on every page load.

### Fixed
- **Migrations now resolve their folder from the module location, not the process working directory.** The runner used a cwd-relative `./drizzle/migrations` path; when the standalone server was launched from any other directory, Drizzle's migrator found no migrations, reported success, and skipped the schema change entirely. The path is now resolved absolutely from `src/db/migrate.ts`, so on-boot migrations apply regardless of cwd (the v0.9.4 `workspaces.icon` outage).
- **Concurrent replicas no longer race migrations.** `runMigrations` now takes a Postgres session-level advisory lock around `migrate()`, so the first booting container applies pending migrations while others block then no-op — safe for multi-replica `docker compose up --scale`.

### Added
- Integration test that runs the migrator from a non-repo working directory against a fresh Postgres, then performs the exact full-row `workspaces` select (all columns, incl. `icon`) and asserts no missing-column error — a regression guard for the whole "code references a column its migration never applied" class.

> **Unblock an already-broken deployment immediately** (works on the existing `0.9.4` image too — no need to wait for `0.9.5`): run the bundled compiled migrator against your database once —
> ```sh
> docker compose run --rm --entrypoint node -w /app cairn /app/dist/db/migrate.js
> ```
> Then restart the app container (`docker compose up -d`). Notes:
> - `--entrypoint node` forces the binary to `node`, ignoring any `entrypoint`/CMD your compose sets. Without it, the command is appended to your entrypoint — a compose with `entrypoint: node` turns `… cairn pnpm db:migrate` into `node pnpm …` → `Cannot find module '/app/pnpm'`.
> - The slim runtime image has no `pnpm`/`tsx`/`src/` — invoke the **compiled** `dist/db/migrate.js` directly (not `pnpm db:migrate`). It has a CLI guard that applies pending migrations.
> - `-w /app` pins the working directory so the `0.9.4` image's cwd-relative migrations path still resolves; `DATABASE_URL` is inherited from the `cairn` service environment.
>
> Upgrading to the `0.9.5` image makes on-boot migrations cwd-independent, so this won't recur.

## [0.9.4] - 2026-05-30

> UX-audit patch release, round 2. Deeper homelab-deploy review of v0.9.3 found ~half of the round-1 fixes didn't hold on a real deployment, plus a wave of new findings (GitHub #50–#123). This release re-fixes the 12 regressed items and resolves the new findings: production-only rendering/theming bugs, the create-then-switch flows that never activated, accent-token wiring, the cover/icon contract mismatch, and a broad sweep of empty/active-state and form-control polish. One migration (`0054` — `workspaces.icon`), one new env var (`CAIRN_ENFORCE_2FA`). Plans: `docs/superpowers/plans/v0.9.4/`.

### Added
- **Workspace icons** — `workspaces.icon` column (migration `0054`) so workspaces, not just pages, carry an emoji/icon in the switcher and sidebar.
- **`CAIRN_ENFORCE_2FA`** environment flag — admins can require all workspace members to enrol a second factor (#66).
- **Themed `Dialog`, `PasswordInput`, and `Calendar` UI primitives** (`src/components/ui/`) on the unified `radix-ui` package; `DateField` rewritten as a radix Popover + calendar (#18, replacing leftover native controls).
- **Keyboard-shortcut formatter** (`src/lib/shortcuts/format.ts`) — platform-aware (`⌘` vs `Ctrl`) shortcut rendering across the palette and menus (#13).
- **Page duplication** — `POST /api/pages/[pageId]/duplicate` plus a "Duplicate" row action that deep-copies an owned page subtree (#19, #76).
- **Forwarded-host-aware public origin helper** (`src/lib/url.ts`) so share/MCP/export URLs resolve correctly behind a reverse proxy even when `PUBLIC_URL` isn't injected into the container (#50).

### Fixed
- **Workspace switcher now actually switches.** Selecting a workspace only refreshed the current route; it now resolves the landing page and navigates to it (#82). Newly **created** workspaces/views are now activated on create instead of silently staying on the old context (#115).
- **Default accent restored in dark mode.** The default accent never bound `--primary`, leaving a near-white primary button under the dark theme; the token is now wired (#34).
- **Editor focus ring no longer tints the whole canvas.** A global `:focus-visible` accent ring was bleeding onto `.ProseMirror`, painting an orange/red glow under amber/rose accents (#123).
- **Page covers persist again.** The cover picker wrote a legacy `cover_url` field instead of `pages.cover`; restored the `CoverPicker` mount and the correct write path (#121).
- **Empty-page placeholder** ("Type / for commands…") reappears — the `.is-empty::before` rule had been purged (#84).
- **Callout headings, empty database header row, and editor control-strip** rendering fixes from round 1 re-anchored on data-attributes so they survive the production CSS purge (#17, #19, #20, #39).
- Re-surfaced the **passkeys page** (existed but was unlinked from Security) (#68); recovery-codes count + regenerate (#69); themed primary **Set-up-2FA** CTA (#71).
- SMTP-off hardening + email-preference enum alignment (#72, #73, #74); themed status/date filters on `/notifications` (#29, #30) and `/my-tasks` (#27).
- Broad form-control, badge, disclosure, slash-menu grouping, block-handle, and reader-toggle polish across the editor, templates gallery, and sidebar (#51–#59, #61–#65, #67, #75, #77–#81, #83, #85–#114, #116–#120, #122).

### Changed
- **Single-open-panel controller** for page action panels — opening one (cover, icon, share, …) closes the others (#93).
- Sidebar lower-nav and version-footer refinements carried forward (#15, #42, #44).

> **Deferred (tracked, intentionally still open):** sessions list (#70 — blocked on jwt session strategy, no DB session store); the move-to picker UI (backend `POST /api/pages/[pageId]/move` exists, picker unbuilt — follow-up issue); #108 unify pass. #12/#41 remain closed pending a product decision.

## [0.9.3] - 2026-05-29

> UX-audit patch release. Resolves the 36-item live UX audit of v0.9.2 (GitHub #10–#45): rendering bugs, themed replacements for native form controls, navigation gaps (Settings entry, `/tasks` redirect, themed 404), and empty/active-state polish. No migrations, no new env vars; one templates listing fix. Plans: `docs/superpowers/plans/v0.9.3/`.

### Added
- Themed `Select` + `DateField` UI primitives (`src/components/ui/`), built on the unified `radix-ui` package (#38).
- **Code block language selector** with lowlight syntax highlighting — pick a language from a styled dropdown, or "Auto" to let lowlight auto-detect untagged code (#47).
- **Semantic callout types** — note / tip / warning / error / info, each with an icon + accent color, switchable via an in-block type picker; legacy `color` callouts map forward automatically (#48).
- **Settings** navigation entry in the sidebar lower nav (#45) — `/settings` was previously only reachable by typing the URL.
- Visible **search affordance with a ⌘K hint** in the sidebar (#43).
- Themed app-root **404 page** with a home link (#23); `/tasks` now redirects to `/my-tasks` (#22).
- Copy-to-clipboard for the profile **User ID** (#33); **MCP connection info** + scopes panel on developer settings (#35).
- Friendly empty states for `/my-tasks` (#26) and `/notifications` (#31); discoverable **Save as template** guidance on the templates gallery (#37).

### Fixed
- **Emoji picker now loads.** `emoji-picker-element` defaulted to fetching its dataset from the jsdelivr CDN, which Cairn's strict CSP (`connect-src 'self'`) blocks. The dataset is now self-hosted (`public/emoji-data.json`, copied from `emoji-picker-element-data` at dev/build, like `public/sw.js`) and the picker points at it same-origin — no external CDN, no CSP change (#49).
- Sidebar page rows no longer leak the raw `emoji::` shortcode and no longer overlap icon/title (#10, #11).
- Profile now shows **email + display name** (read from the users table), and the intro copy matches (#32).
- **Built-in templates** now appear in the gallery — listing surfaced built-ins on the `builtIn` flag rather than only the `public` visibility tier (#36).
- Empty **database blocks** render a header row instead of a bare "+ New row" (#19); headings inside **callouts** are scaled down to keep hierarchy (#20).
- Single **"Add cover"** affordance (was duplicated) (#16); page **mode toggles** consolidated into the title action bar (was a separate floating box) (#17).
- Themed, dark-mode-safe **locale switcher** (#21), **/notifications status + date filters** (#28, #29), and **/my-tasks due-by** date control (#27) — replacing native `<select>`/`<input type=date>`.

### Changed
- Rebalanced sidebar lower-nav hierarchy + separated Sign out; relocated the theme toggle to the account group (#14, #44, #13).
- Linked the sidebar version footer to the matching GitHub release (#15); clearer workspace-switcher affordance + larger hit target (#12, #41); visible sidebar boundary border (full drag-resize deferred) (#42).
- Title-Case `/my-tasks` filter tabs with a clear active state (#24, #25); toggle semantics + active state for `/notifications` Mentions/Replies pills (#30); separators + active states on the editor top control strip (#39); intentional centered editor content column (#18).
- Verified the notification bell drawer renders and links to `/notifications` (#40).

> Remaining native form controls outside audit scope (databases, admin, connectors, automation) tracked for a follow-up pass under #38.

## [0.9.2] - 2026-05-28

> Hotfix for the `cairn-collab` sidecar image, which crash-looped on startup in v0.9.1. The app image (`cairn`), database schema, and env vars are unchanged — only the collab container is affected. Upgraders pull the new `cairn-collab:0.9.2` image (compose does this on redeploy); no migrations.

### Fixed
- **`cairn-collab` container crash-loop.** Three bugs combined to keep the Hocuspocus sidecar from booting after v0.9.1:
  - `Dockerfile.collab` still pinned `NODE_VERSION=22-alpine` — the v0.9.1 Node-24 sweep missed it. Now `24-alpine`, matching the app image.
  - The `CMD` ran `pnpm exec tsx`; pnpm 10+ runs a dependency-status check before `exec` that writes a temp file into the root-owned `/app` working directory, which fails with `EACCES` under the non-root `cairn` user. The entrypoint now invokes `node_modules/.bin/tsx` directly — no pnpm, no deps-check, no network — while still resolving the `@/` path alias via tsconfig.
  - `collab/server.ts` value-imports `@/lib/observability/metrics`, but the image only copied `src/lib/collab` + `src/lib/auth`. Added a `COPY src/lib/observability` so the prom-client metrics module resolves at runtime.

## [0.9.1] - 2026-05-28

> Dependency-maintenance release: runtime → Node 24 LTS, package manager → pnpm 11, and the full dependency tree advanced to latest (including the breaking nodemailer 8 and pdfjs-dist 5 majors) with the codebase migrated to match. No schema changes — **no migrations, no new env vars**; upgraders need only redeploy. Plus a public-render bug fix that unblocks Lighthouse CI, and a light+dark feature screenshot set in the README.

### Changed (runtime + tooling)
- **Node 24 LTS** is now the runtime: `engines` `>=24`, `.nvmrc`, Dockerfile `NODE_VERSION` (`24-alpine`), CI `setup-node` (all jobs + Lighthouse), and `@types/node@24`. Node-24 webcrypto type change handled (`generateKey` → `CryptoKey`).
- **pnpm 11.4.0** (`packageManager` + corepack). pnpm 10+ no longer auto-runs dependency build scripts; an `allowBuilds` allowlist in `pnpm-workspace.yaml` re-enables the native deps Cairn needs (esbuild, sharp, onnxruntime-node, cpu-features, ssh2, protobufjs).
- Dependency sweep to latest: TipTap 3.23.6, Biome 2.4.16, AWS SDK, Slack Bolt, TanStack Virtual, Testcontainers 12.0.1, react-hook-form, `@hookform/resolvers` 5.4, lucide-react 1.17.
- **nodemailer 8** (breaking major) — transport API verified unchanged; no code change beyond the bump.
- **pdfjs-dist 5** (breaking major) — `page.render()` now requires `canvas`; the PDF viewer passes it. Worker wiring unchanged.

### Fixed
- Public page `/p/<slug>` returned HTTP 500 (and failed every Lighthouse CI run): prosemirror-model builds node/mark attrs with `Object.create(null)`, which React 19's RSC serializer rejects when passed to a Client Component. `previewAccepted` now normalizes its output to plain objects.

### Docs
- README gains a **Screenshots** section (light + dark) for the editor, ⌘K palette, API keys, automation, and webhook deliveries, captured via the a11y harness (`tests/a11y/screenshots.spec.ts`).

## [0.9.0] - 2026-05-27

> Power features + 1.0-readiness release. Nine groups completing every remaining pre-1.0 roadmap feature except the AI cluster. 44 plans, 20 new migrations (`0034`–`0053`), executed on a single `release/v0.9.0` branch and merged via one PR — per the v0.7-v0.8 retrospective rule on release-branch discipline.

### Added (v0.9.0 G1 — Security + identity)
- **P1** SSO data model: `idp_configurations`, `external_identities`, `scim_tokens` (migration `0034`). Workspace-scoped IdP configs; user-to-external-subject mapping; SCIM bearer tokens (token plaintext returned once; only SHA-256 hash stored).
- **P2** OIDC adapter: Auth.js v5 OIDC provider per IdP config; HMAC-signed state cookie via `jose`; admin CRUD UI; existing-user link by email + auto-provision via workspace invite flow; session minted via `next-auth/jwt` `encode`. Admin GET strips `clientSecret`. Idempotent `external_identities` upsert.
- **P3** SAML 2.0 adapter (`samlify`): SP-initiated + IdP-initiated flows; metadata XML at `/api/sso/saml/metadata/[id]`; HMAC-signed state cookie with `InResponseTo` replay protection; admin CRUD; per-IdP X.509 keypair; sandbox SP keypair stripped from admin GET.
- **P4** SCIM 2.0 endpoint: `/api/scim/v2/Users` + `/Groups`; bearer-token auth with scope gating (`users:read|write`, `groups:read|write`); filter parser (`userName eq ...`); roles-as-groups for `owner/admin/editor/viewer`; admin token mint/revoke + dashboard at `/admin/sso`.
- **P5** End-to-end encryption — crypto core + migration `0035`. Tables `user_keypairs`, `page_encryption_keys`, `workspace_encryption_keys`; `pages.encrypted` flag. X25519 keypair generation, passphrase-sealed private key (scrypt KDF), DEK generation, X25519 sealed-box wrap/unwrap. New env `CAIRN_ENABLE_E2E_ENCRYPTION`.
- **P6** E2E per-page mode + migration `0036` (`pages.content_encrypted` bytea). UI toggle to encrypt; per-page AES-256-GCM cipher; DEK wrapped to each workspace member's keypair. Consumer audit: search (FTS + trigram + semantic), embeddings, public-share, webhooks all skip encrypted pages.
- **P7** E2E workspace-wide mode + migration `0037` (`workspaces.e2e_mode`, `pages.encrypted_under_wsk`). Admin enable sweeps all pages under one WSK; per-member key wrap; rekey support; member add/remove rewraps; page-creation hook auto-encrypts under WSK.
- **P8** MFA WebAuthn + migration `0038` (`user_webauthn_credentials`, `workspace_mfa_policies`). `@simplewebauthn/server` v13 ceremonies; step-up auth (5-min TTL JWT claim + cookie); admin workspace-MFA enforcement gates sign-in; `requireStepUp` helper; reusable `<StepUpModal>` wired to DangerZone workspace-delete.
- **P9** PAT quotas + migration `0039`. Daily + monthly request caps + per-scope rate-limits in `personal_access_tokens`; `pat_quota_usage` rollup. Atomic upsert via raw SQL `INSERT ... ON CONFLICT DO UPDATE WHERE requests < limit` closes the race window. Dispatcher returns 429 + `Retry-After` on cap.
- **P10** PAT quota admin dashboard at `/settings/admin/api-keys`: per-PAT current usage + 14-day sparkline + reset button. Reset scoped to current day + month windows only — historical sparkline preserved.

### Added (v0.9.0 G2 — Workspace structure)
- **P11** Spaces + migration `0040`: `spaces`, `space_members`, `pages.space_id`. Sidebar groups pages by space; per-space ACL chain extends `requirePageAccess` (workspace owner/admin > space role > viewer-of-space). Admin space CRUD at `/settings/workspace/spaces`; page-create space picker; move-space route.
- **P12** Workspace pins + migration `0041`: `workspace_pins` (distinct from v0.8 favorites). Admin UI with drag-reorder; sidebar Pinned section above Favorites.
- **P13** Trash retention + migration `0042` (settings batch: `trash_retention_days`, `default_page_status`, `enable_federated_search`). Daily `trash:purge` cron per workspace; admin UI with confirm-by-typing empty-trash button. `CAIRN_TRASH_RETENTION_DAYS=0` disables auto-purge.
- **P14** Page lock + migration `0043` (`pages.locked_at/locked_by/locked_until`). Write-gate refuses update/delete/move when locked + caller is not locker/admin. Auto-unlock cron sweeps expired locks every 5 min. Lock banner + popover toggle (Lock indefinitely / 1h / 24h). Yjs collab token-mint gate refuses editor-role tokens to non-lockers on locked pages. `PageLockedError extends HttpError` (status 403) for uniform error mapping.

### Added (v0.9.0 G3 — New blocks)
- **P15** Diagram blocks expansion: PlantUML (lazy-load encoder, `<img>` to configurable `CAIRN_PLANTUML_SERVER`) + drawio (sandboxed iframe to `viewer.diagrams.net`). CSP `EMBED_FRAME_HOSTS` updated. Encrypted-page guard refuses to render diagrams (would leak source to 3rd-party server).
- **P16** Image gallery + lightbox block: TipTap gallery node (`cairnImage+` content); multi-file drop composes one gallery node; portal modal with focus trap + ESC + arrow nav; semantic `<ul><li><button>` grid.
- **P17** PDF viewer + annotation + migration `0044` (`pdf_annotations`). `pdfjs-dist` lazy-mounted; per-user annotation overlay; HMAC-signed file URL via existing storage helper; encrypted-page guard refuses to render.
- **P18** Citation + footnote blocks + bibliography aggregator: APA/MLA/Chicago formatters; bibliography section auto-renders on public pages; footnote popover with `role="doc-noteref"`/`role="doc-footnote"`; ReadOnlyView numbers footnotes via `FootnoteSup`.
- **P19** Flashcards block + migration `0045` (`flashcard_cards`, `flashcard_reviews`). SM-2 algorithm; due-queue per-user; grade endpoint with atomic `onConflictDoUpdate` upsert; reconcile hook on page save; daily `flashcards:notify-due` cron + in-app + email digest. Sidebar review-due counter; study session route `/flashcards/study`.
- **P20** Date/time block with timezone (`luxon`): TipTap node + popover picker; markdown export emits semantic `<time>`; page-save hook extracts ISO timestamps into `pages.metadata.datetimes`.
- **P21** DOI / PubMed citation lookup: Crossref + PubMed fetchers (1 RPS rate-limit, 5s timeout, 256 KB cap); `/api/citations/lookup` GET with xor `doi`/`pubmed` validation; paste-detect dialog with style preview.
- **P22** Bulk file drag-drop + audio block + MIME allowlist. `cairnAudio` TipTap node (`<audio controls>`); bulk uploader modal with parallel queue + per-file status; audio MIME allowlist (`audio/mpeg|wav|ogg|flac|aac`).

### Added (v0.9.0 G4 — Content lifecycle)
- **P23** Tasks hub `/my-tasks` + migration `0046` (`mv_user_tasks` materialized view). PL/pgSQL extractor walks `pages.content` for taskItem nodes; refresh trigger on page INSERT/UPDATE/DELETE; filter chips (open/done/all + due date); optimistic toggle with revert on error.
- **P24** Page approval + signed audit + migration `0048` (`page_approvals`). HMAC-SHA256 signature over canonical `{ page_id, status, approver_id, decided_at }`; editor requests, admin decides; `ApprovalPanel` gated on `canDecide` + `inReview`; lifecycle integration with P26 status transitions.
- **P25** Save-as-template + sharing controls: `templates.visibility` (private/workspace/public, default workspace); modal with visibility selector; `/templates/gallery` groups by visibility; ACL via `canReadTemplate` + `listVisibleTemplates`.
- **P26** Page lifecycle status + migration `0047` (`pages.status` enum draft|review|published|archived, `translation_of_page_id` self-FK, `translation_locale`). `transitionStatus` matrix with audit; FTS + sidebar + public-share filter on status; symmetric translation linkage helper.

### Added (v0.9.0 G5 — Search + discovery)
- **P27** "See also" related-pages panel: reuses v0.7 pgvector embeddings; cosine-kNN with ACL post-gate + encrypted-page skip; RSC panel on page-detail.
- **P28** TOC sidebar: sticky right-rail with IntersectionObserver active-link; per-user pref via localStorage + cookie; coexists with v0.6 P6 inline TOC block. Headings extended to h4.
- **P29** Search operators parser + chip UI + migration `0049` (`saved_searches.template_name`): `type:`, `space:`, `status:`, `from:`, `created:>`, `due:<` operators; chip-builder client component; named saved templates with `@name` expansion (no nesting).
- **P30** Federated multi-workspace + cross-instance search + migration `0050` (`peer_instances`). HMAC-signed envelope with anti-replay LRU + 5-min window; admin cross-workspace scope; peer fan-out with per-peer token-bucket rate-limit (10/min); inbound peer route with peer-auth + 256KB cap; new env `CAIRN_FEDERATION_SHARED_SECRET`.

### Added (v0.9.0 G6 — Polish + UX)
- **P31** i18n framework polish: TypeScript-Compiler-API audit script `pnpm i18n:check` with baselined hardcoded-string registry (796 baselined findings; `i18n-audit.baseline.json`); CI step before typecheck; full `es` locale bundle (17 keys); `<LocaleSwitcher>` surfaces all 3 locales (en, ar, es).
- **P32** Side-by-side version diff: structural ProseMirror snapshot diff (LCS over block signatures); ACL-gated `/api/pages/:id/versions/diff`; `<VersionDiffViewer>` with added/removed/changed markers + a11y landmarks; encrypted-page refuse.
- **P33** Focus + reader + share-password verify: focus-mode hides sidebar/chrome; reader-mode renders content-only typography; Argon2id verify for `link_password_hash` with 5-min cookie TTL; password-rotate affordance; rate-limited verify attempts.

### Added (v0.9.0 G7 — Export + interop)
- **P34** Static-site export pipeline + CLI + UI + MkDocs target: `pnpm exec cairn-export --target=mkdocs`; admin UI button at `/settings/workspace/export-static-site`; page-tree walk + asset extraction + in-doc link rewrite; per-target frontmatter helper. Adds `gray-matter` + `js-yaml`.
- **P35** Static-site export Docusaurus target + i18n parallel-translations: `sidebars.js` + `docusaurus.config.js` emission; translation pages route to `i18n/<locale>/...`. README documents both targets.
- **P36** Chat bridge outbound + inbound + migration `0051` (`webhooks.kind` discriminator + `chat_posted_messages`). Outbound translators for Slack + Discord (signed POST); inbound HMAC-SHA256 verify-slack + Ed25519 verify-discord (Node webcrypto); per-workspace synthetic chat-bot user posts comments back. Adds `@slack/bolt` + `discord.js`.
- **P37** Chat bridge slash commands + channel↔page sync + migration `0052` (`chat_bridge_installs`, `chat_channel_links`). `/cairn create|search|page` slash commands (Slack + Discord); channel↔page sync engine; admin channel-link management UI; sanitize + dedupe + bot-skip; rate-limit + replay-protection primitives.
- **P38** OpenAPI 3.1 generator + `/openapi.json` + Swagger UI at `/api-docs`: `zod-to-openapi` registry + v1 route manifest + shared Zod schemas; workspace-member gate + 1h cache; local-bundled Swagger UI (no external CDN).

### Added (v0.9.0 G8 — Operations)
- **P39** SIEM forwarder core + migration `0053` (`siem_forwarders`, `siem_delivery_log`). Envelope + RFC5424 syslog (UDP/TCP) + HTTP webhook with optional bearer; dispatcher via `setImmediate` audit hook + delivery log; cron retry sweep every minute; admin UI; prom-client counters + latency histogram.
- **P40** SIEM native Splunk HEC + Datadog Logs + S3 NDJSON archive: per-kind sender + Zod admin form; daily S3 archive cron (01:15 UTC) with injectable dump/restore for tests; logger redact paths for HEC token + DD-API-KEY + S3 creds.
- **P41** `cairn-upgrade` CLI + compose orchestration: preview (scratch-DB dry run + schema diff), apply (snapshot → migrate → restart → health → auto-rollback), rollback (pg_restore + auto snapshot picker), healthcheck (`/api/health` + journal-vs-db). Dockerfile ships `postgresql17-client`. Audit actions `upgrade.applied|failed|rolled_back`.
- **P42** Release-watch daemon + admin upgrade UI: daily 04:30 UTC cron polls `CAIRN_RELEASE_FEED_URL`; fan-out `upgrade_available` notifications to workspace admins/owners; `/settings/admin/upgrade` page shows current + available + Apply button with SSE-streamed progress. New env `CAIRN_RELEASE_WATCH_ENABLED`.
- **P43** Encrypted workspace backups: AES-256-GCM envelope around v0.5 S3 backup pipeline; Argon2id KDF (m=64MB, t=3, p=1) from `CAIRN_BACKUP_ENCRYPTION_PASSPHRASE`; envelope magic `CAIRN-ENC-BAK-v1` + salt + nonce; backup + restore CLI auto-detect `.enc` siblings; secret-leak hygiene + logger redacts.

### Migrations
- `0034`–`0053` (20 additive). All migrations forward-only. Drizzle `_journal.json` updated. Migration ledger in `docs/superpowers/plans/v0.9.0/2026-05-26-cairn-v0.9.0-plans-index.md`.

### Conventions
- Release-branch discipline (`release/v0.9.0`) per the v0.7-v0.8 retrospective. No direct commits to `main` between v0.8.0 and v0.9.0 tags.
- Per-plan subagent execution with plan-review gate + spec-compliance review + code-quality review + fix-pass loop.
- Retrospective lessons applied preemptively: `db.transaction(...)` around state + audit, `.onConflictDoUpdate` for race-prone upserts, secret stripping on admin GET, generic 400 + server-side log for external-lib errors, encrypted-page consumer audit across every read path.

## [0.8.0] - 2026-05-24

> Experience + 1.0-readiness release. Ten new bands on top of v0.7: full Yjs-over-IndexedDB sync + mobile gesture polish (G1), performance pass with virtualization + bundle code-split + Lighthouse CI budget (G2), quick-capture + PWA `share_target` + onboarding wizard (G3), expanded command palette + settings-hub restructure + microcopy polish (G4), a11y v0.7 new-route sweep (G5), notification center + favorites reorder + backlinks delta (G6), per-user themes + page covers + page-icon polish (G7), embed allowlist expansion + rich unfurls + new block types (G8), opt-in server-side native PDF via Playwright (G9), and the cross-feature release smoke + docs (G10). Migrations `0029`–`0033`. Built area-by-area (plans P1–P26); entries below are grouped by group.

### Added (v0.8.0 P26 — Combined smoke & release)
- Combined cross-feature docker-compose smoke (`scripts/smoke-v0.8.0.sh`) exercising every v0.8 delta band against a live boot: `/api/health` reports `0.8.0`, inbox capture (anon → 401; PAT → 201), notification bell unread-count shape, native PDF magic-bytes (skipped if `CAIRN_NATIVE_PDF` unset), page cover save+restore, theme apply (data-accent on `/p/` render), PWA `share_target` manifest entry, and cross-workspace inbox capture existence-non-leak.
- Lighthouse + axe gates skipped in P26 plan execution; covered by existing CI on every PR (G2 P7 + G5 P14).
- README "v0.8.0 features" overview (10 groups; 16 features) + extended "Security & operations caveats" (Playwright runtime, Unsplash key, offline-doc IndexedDB cap, PWA `share_target` browser support gaps, new CSP `frame-src` entries).
- SECURITY.md `v0.8.0 additions` section: Unsplash key handling, Playwright runtime opt-in surface, IndexedDB client-side persistence, embed CSP allowlist additions, `share_target` manifest entry.
- Bumped version to 0.8.0; reused the existing GHA-hosted release workflow to publish `ghcr.io/jonathanmcohen/cairn:0.8.0`.

### Added (v0.8.0 G1 — PWA + mobile polish)
- **P1** Full Yjs-over-IndexedDB sync: every opened page is mirrored to IndexedDB for the workspace session; offline edits land in the local Yjs doc and CRDT-merge with the server on reconnect via the existing Hocuspocus provider. Per-workspace `doc-index` helper + FIFO eviction at `CAIRN_OFFLINE_DOC_LIMIT_MB` / `NEXT_PUBLIC_CAIRN_OFFLINE_DOC_LIMIT_MB` (default 256MB); `src/lib/offline/{doc-index,evict}.ts` unit-tested against `fake-indexeddb`.
- **P2** Mobile gesture polish: `useSwipeBack` hook + edge-swipe-back on page detail routes; `<LongPress>` HOC + context-menu wiring on sidebar pages + db rows; `<PullToRefresh>` wrapper on list + timeline views. WCAG 2.5.5 touch-target audit across v0.7 surfaces with follow-up fixes on `/settings/developer` + the new settings hub.
- **P3** Offline reconnect smoke (integration test harness): Hocuspocus stub + two-client Y.Doc setup; asserts two-client CRDT convergence + IndexedDB-survives-restart; precondition guards for Docker-up + Hocuspocus ready.

### Added (v0.8.0 G2 — Performance pass)
- **P4** Virtualized page-tree sidebar via `@tanstack/react-virtual`: `flattenedPageTree` DFS helper + `<VirtualizedPageTree>` client component swap for the recursive `<SidebarTree>` flat-list render. Sustains 10k+ row workspaces.
- **P5** Virtualized db-table view: `<VirtualizedRowBody>` with sticky header + windowed grid rows, wired into `<TableView>` non-grouped path. Sticky-header regression guards under frozen-column + rerender.
- **P6** Code-split heavy TipTap extensions (math, syncedBlock, embed): dynamic-import factories + schema-only static node placeholders; on-mount + on-insert lazy load; bundle-budget test asserts KaTeX stays out of the core editor chunks (≥ 200KB cut).
- **P7** DB query audit (top 5 routes by p99) + missing indexes added; Lighthouse CI budget config (`@lhci/cli`) on `/p/<id>` — 5pt floor + 10% LCP/FCP/TTI cap — wired into CI as a dedicated workflow with an LHCI seed page + ops docs.

### Added (v0.8.0 G3 — Quick capture + onboarding)
- **P8** Inbox capture + PWA `share_target`. Migration `0030`: `pages.metadata jsonb` + `workspaces.inbox_page_id`. `ensureInboxPage` + `captureInbox` + `markInboxDone` library helpers (cross-workspace → 404). `POST /api/inbox` accepts JSON + multipart share-target POSTs; PWA manifest registers `share_target` → `/api/inbox`. `/inbox` triage UI + mark-done route.
- **P9** Quick-capture hotkey. Module-level open/close controller, `<QuickCaptureModal>` with form submit, `Cmd+Shift+N` / `Ctrl+Shift+N` registered in the `(app)` layout.
- **P10** Onboarding wizard. Built-in "Welcome to Cairn" template, `getOnboardingState` helper, per-workspace localStorage flag, 3-step `<OnboardingWizard>` modal + template picker, gallery preview disclosure.

### Added (v0.8.0 G4 — Command palette + settings hub)
- **P11** Palette expansion: typed action registry + `buildPaletteActions(ctx)`; expanded actions (open settings, switch workspace, create page, create db row, open recent ×10, FTS+semantic search, MCP token info); localStorage-backed recent-commands surface above search results.
- **P12** Settings hub nav restructure: `<SettingsSidebar>` + `<SettingsBreadcrumb>` with keyboard nav; nav-sectioned layout shell + `/settings` landing redirect; settings pages moved into the hub with breadcrumbs; `resolveSettingsRedirect` helper applied in `src/proxy.ts` so old flat paths redirect.
- **P13** Microcopy + empty-state polish: keyed string registry, base `<EmptyState>` component, 8 per-feature named variants, audit + plumbing across v0.8 surfaces.

### Added (v0.8.0 G5 — A11y v0.7 new-route sweep)
- **P14** `pnpm test:a11y` Playwright + axe suite extended to cover `/settings/developer`, `/settings/automation`, `/settings/connectors`, `/settings/admin/webhooks/[id]/deliveries`, and `/healthz`. Keyboard nav + focus management asserted on the mint-PAT dialog, automation-rule form, and connector OAuth flow. (Mobile touch-target audit shipped in G1 P2; sub-44 fixes applied across the v0.7 settings surfaces and the new settings hub.)

### Added (v0.8.0 G6 — Notification center + favorites + backlinks delta)
- **P15** Notification bell + drawer. Shared `listNotifications` + `markRead` + `markAllRead` helpers; `GET /api/notifications/unread-count` fast-count endpoint; per-id read + mark-all-read endpoints; refactored `GET /api/notifications` to delegate. SWR-polled `<NotificationBell>` with unread badge + right-side focus-trapped `<NotificationDrawer>` grouped today/this-week/older, mounted in the layout header.
- **P16** `/notifications` full inbox page with `type[]` / `status` / `dateFrom` / `dateTo` filters + load-more pagination — shared list query with the drawer.
- **P17** Favorites reorder. Migration `0031`: `user_page_prefs.position` for favorite ordering. `reorderFavorites` helper + `@dnd-kit/sortable` deps; `POST /api/favorites/reorder` + legacy shim; drag + keyboard reorder + remove action in the sidebar.
- **P18** Backlinks delta. `findUnlinkedMentions` FTS + `page_links` anti-join helper; `GET /api/pages/[pageId]/preview` for transclusion popover; inline page-link hover popover via shared tippy; unlinked-mentions section in `BacklinksPanel` with its own GET endpoint.

### Added (v0.8.0 G7 — Themes + page covers + icons)
- **P19** Per-user themes. Migration `0032`: `user_theme_prefs` + presets module (accent color × 8 presets + custom hex, font family system / serif / mono, page width narrow / wide / full). `getThemePrefs` / `setThemePrefs` helpers + roundtrip test; `<ThemeProvider>` + `PATCH /api/settings/theme`; `/settings/account/theme` page; provider mounted on `(app)` and `/p/<id>`. Applied via CSS custom properties + `<html data-accent="...">` — Tailwind v4 `@theme` tokens inherit.
- **P20** Page covers. Migration `0033`: `pages.cover jsonb`. `setPageCover` / `getPageCover` helpers + roundtrip test; `PATCH /api/pages/[pageId]/cover` route; `<CoverBanner>` 200px renderer; `<CoverPicker>` modal (color / Unsplash / upload tabs — Unsplash gated behind `CAIRN_UNSPLASH_ACCESS_KEY`, client-side search); mounted on editor + `/p/<slug>`.
- **P21** Page-icon polish. Icon-format prefix-convention helpers; `randomDefaultIcon()` wired into `createPage`; icon-picker polish — search + recently-used + custom-upload icon path.

### Added (v0.8.0 G8 — Embeds + new blocks)
- **P22** Embed allowlist expansion. Added Loom, Codepen, Spotify, Vimeo Showcase, Excalidraw to the editor allowlist; extended CSP `frame-src` to the new hosts; Mermaid block as a lazy-loaded SVG (no iframe). Drift-test guards against accidental allowlist removal.
- **P23** Rich unfurls. `extractOpenGraph` helper with caller-provided fetcher; `/api/unfurl` returns `imageData` (256KB cap, SSRF-guarded); bookmark card prefers inlined `imageData` over remote URL.
- **P24** New block types. Divider, button (label + href + variant), video upload (mp4/webm) — each with a slash command. Public `/p/<slug>` re-signs video src on render.

### Added (v0.8.0 G9 — Native PDF)
- **P25** Server-side native PDF export gated behind `CAIRN_NATIVE_PDF=1`. Promoted `@playwright/test` to a runtime dep. `pageToPdf` singleton-browser helper (lazy-launched on first request, closed on `SIGTERM`/`SIGINT`). `/api/pages/[pageId]/export?format=pdf` serves native bytes when the env is set; browser-print HTML remains the default; `?format=pdf-print-html` is an explicit fallback selector. MCP `pages.export` tool surfaces md / json / pdf (base64-encoded PDF in the JSON-RPC envelope; rejects `format=pdf` with `INVALID_REQUEST` when the env is unset). README docs for `CAIRN_NATIVE_PDF` + "Server-side native PDF" section; gated magic-bytes check in tests.

## [0.7.0] - 2026-05-23

> Cross-feature release adding seven new bands on top of v0.6: authz primitives (PATs + page ACLs), an MCP server (Streamable HTTP + SSE shim), observability + ops delta (`/healthz` + new metric series + webhook delivery dashboard), pgvector-backed semantic search, scheduled S3 backups + bulk import/export UI, an automation/rules engine, and two-way DB connectors (Google Sheets / Airtable / CSV). Migrations `0024`–`0028`. Built area-by-area (plans P1–P23); entries below are grouped by plan.

### Added (v0.7.0 P23 — Combined smoke & release)
- Combined cross-feature docker-compose smoke (`scripts/smoke-v0.7.0.sh`) exercising every new band against a live boot: `/healthz` + version, PAT mint+revoke, MCP `tools/list` over Streamable HTTP, semantic search (post-seed), automation rule fire on `row.created`, and connector API-shape per kind (Sheets / Airtable / CSV — OAuth skipped in smoke; cross-workspace webhook receipts asserted to 404).
- (Optional) Lighthouse PWA + accessibility and `@axe-core/playwright` runs against the assembled v0.7.0 stack (mirrors v0.6.0 P23 Task 2).
- README "v0.7.0 features" overview + extended "Security & operations caveats" (PATs, page ACL precedence, MCP allowlist, connector secrets, embedding API key, single-instance ceiling for the three new schedulers).
- SECURITY.md `v0.7.0 additions` section: PAT token class, ACL precedence + owner bypass, MCP tool-dispatch enforcement order, embedding + connector secret classes, single-instance ceiling for the new schedulers.
- Bumped version to 0.7.0; reused the existing GHA-hosted release workflow to publish `ghcr.io/jonathanmcohen/cairn:0.7.0`.

### Added (v0.7.0 G1 — Authz primitives: PATs, page ACLs, token usage log)
- **P1** Migration `0024`: `personal_access_tokens` (per-user `cairn_pat_*` secrets, sha256 hash-at-rest, prefix shown once, scopes[] + mcp_tools[] config, optional expiry), `page_acls` (per-page role override with workspace-scoped FK + unique `(page_id, user_id)`), `token_usage_log` (high-cardinality per-call ledger keyed by token_id / tool_id / outcome with ts index). Drizzle table modules wired into the schema barrel.
- **P2** PAT library (`mintPat` / `verifyPat` / `revokePat` / `expirePat`, sha256 hash + `cairn_pat_<48-hex>` prefix, single-shot plaintext at mint) + token resolver middleware (`resolveToken`) that dispatches `cairn_sk_` → v0.5 API-key path, `cairn_pat_` → PAT path, otherwise session cookie. All `requireRole`/`requirePageAccess` call-sites unchanged — they consume the resolved `AuthContext`.
- **P3** Page ACL resolver: recursive CTE walking `pages.parent_id` upward returns the nearest ancestor ACL for `(user, page)`; effective permission = explicit ACL else nearest ancestor else workspace role; **owner role bypasses the chain entirely**. New `requirePageAcl(pageId, role)` helper wrapping `requirePageAccess` + the ACL resolver, wrapped in React `cache()` per request.
- **P4** Developer-settings UI at `/settings/developer`: mint a PAT (named, scope multi-select with named presets `read-only`/`full CRUD`/`write-minus-destructive`/`MCP read-only`/`MCP full`, advanced per-tool multi-select, optional expiry), revoke, view a per-token usage timeline (last 100 from `token_usage_log`), and copy a generated Claude Desktop / Cursor MCP config snippet.
- **P5** Audit + secret-leak extensions: new `AuditAction` literals `pat.created` / `pat.revoked` / `pat.expired` and `page_acl.{created,changed,removed}`; `FORBIDDEN_SECRET_PREFIXES` now includes `cairn_pat_`; the secret-leak suite asserts no PAT plaintext leaks via API response, audit metadata, token-usage log, or workspace archive.

### Added (v0.7.0 G2 — MCP server)
- **P6** MCP tool registry (~20 tools across pages / databases / rows / search / comments / files / workspace) + dispatcher enforcing three layers in order: (1) tool's declared scope ∈ PAT.scopes, (2) tool.id ∈ PAT.mcp_tools allowlist (empty allowlist blocks all MCP), (3) underlying mutation passes the acting user's workspace role + page ACL. Every dispatch writes a `token_usage_log` row with `(token_id, tool_id, status, duration_ms)`.
- **P7** Streamable HTTP transport at `POST /api/mcp`: single endpoint, bearer-authed (`Authorization: Bearer cairn_pat_*`), JSON-RPC envelope, wrong PAT prefix → 401 (no listing leak). The transport reuses the registry from P6.
- **P8** SSE fallback shim at `GET /api/mcp/sse` + `POST /api/mcp/messages` for first-generation MCP clients (Claude Desktop ≤ certain build, Cursor early builds); same auth + dispatch contract as the Streamable transport, just a different framing.

### Added (v0.7.0 G3 — Observability + ops delta)
- **P9** Always-open `GET /healthz` (no auth) returns `{ status, version, db, uptime_seconds }`; touches the DB with `SELECT 1` for liveness; returns 503 on DB failure. Safe to expose on a load balancer (K8s-style probe). New closed-label metric series wired into the v0.6 P20 `prom-client` registry: `mcp_tool_called_total{tool,outcome}`, `embedding_generation_total{provider,outcome}`, `automation_rule_fired_total{action_type,outcome}`, `connector_sync_total{kind,outcome}` — all labels are bounded, no tenant identifiers.
- **P10** Per-webhook delivery dashboard (admin) at `/settings/admin/webhooks/[id]/deliveries` listing the most recent deliveries with status / status_code / attempts / next_retry_at; **manual replay** button re-enqueues a failed delivery; **HMAC-secret rotate** (`POST /api/webhooks/[id]/rotate-secret`) mints a fresh `cairn_whsec_*` shown once and invalidates the old one. Audit-logged as `webhook.secret_rotated` / `webhook.delivery_replayed`.

### Added (v0.7.0 G4 — Vector / semantic search)
- **P11** Migration `0025`: `pgvector` extension + `page_embeddings(page_id PK → pages, model text, embedding vector(384), updated_at)` + an `ivfflat` ANN index. Embedding provider abstraction with two implementations: a bundled `all-MiniLM-L6-v2` ONNX local model (no external network needed) selected by default, and an OpenAI-compatible remote provider toggled by `CAIRN_EMBEDDING_URL` + `CAIRN_EMBEDDING_API_KEY` (Ollama, OpenAI, vLLM, …). API key is in `pino`'s redact list + `FORBIDDEN_KEYS`.
- **P12** On-write embedding pipeline: every `pages.content` change schedules a fire-and-forget post-commit embed (mirrors the v0.5 webhook emit pattern, never awaited, errors swallowed + structured-logged). `pnpm cli reindex-embeddings [--workspace <id>] [--model <name>]` backfill with batching, resume cursor, and a `CAIRN_BACKFILL_EMBEDDINGS=1` opt-in env to run on startup.
- **P13** Search route union at `GET /api/search`: `?mode=fts` (the v0.1 + v0.6 path, default), `?mode=semantic` (pgvector cosine distance over `page_embeddings`, joined to page metadata + workspace + ACL gate), `?mode=hybrid` (reciprocal rank fusion of the two). All three modes pass through the v0.6 P22 filter compiler so author / dateRange / scopeDatabaseId still apply.

### Added (v0.7.0 G5 — Bulk import/export + scheduled S3 backup)
- **P14** Migration `0026`: `cron_schedules(id, workspace_id, kind, expression, last_run_at, last_status, enabled, created_by)` for in-process scheduled jobs. Entrypoint scheduler exec the existing backup CLI on the configured cron expression (single-instance only — same ceiling as the v0.6 backup ticker, documented). `pnpm cli restore --from-s3` closes the v0.5/v0.6 gap: backups went to S3 but restore wanted a local file; the CLI now streams the backup bundle from `s3://.../backups/<name>` directly into `pg_restore` + the uploads tar.
- **P15** Bulk import/export UI on the workspace settings page over the v0.6 P21 lib (Notion / Markdown folder / workspace archive); SSE progress streaming (`text/event-stream` from `POST /api/imports/[jobId]/stream`) so the UI shows per-item progress + the final `ImportReport`. Export buttons surface the workspace-archive download from the same screen.

### Added (v0.7.0 G6 — Automation / rules engine)
- **P16** Migration `0027`: `automation_rules(id, workspace_id, name, trigger_event, condition jsonb, action_type, action_config jsonb, enabled, created_by, created_at)` + `automation_runs(id, rule_id → rules, fired_at, status, error, trigger_payload jsonb)`. The dispatcher subscribes to the v0.5 internal event bus (the same the webhook dispatcher reads from) and evaluates rules per event via a pure `matchesCondition(condition, eventPayload)` over the v0.6 P22 filter operator vocab.
- **P17** Action runners for the four declared `action_type` values: `notify` (writes a `notifications` row), `send_webhook` (HMAC-signed POST via the v0.5 webhook lib), `set_property` (mutates a db_row cell via the v0.4 row lib), `create_page` (creates a child page from a template id). Each run writes an `automation_runs` row with `{ status: 'success' | 'failed', error, duration_ms }` and increments `automation_rule_fired_total{action_type,outcome}`.
- **P18** Settings-page form builder at `/settings/automation`: pick trigger event (`row.created` / `row.updated` / `row.deleted` / `page.created` / `page.updated` / `comment.created` / …) → build the condition with the v0.6 P22 filter operator vocab → pick the action + fill its config (notify recipient + message / webhook url + event / property + value / page parent + template). Recent-run timeline panel shows the last 50 `automation_runs` per rule.

### Added (v0.7.0 G7 — Two-way DB connectors)
- **P19** Migration `0028`: `database_connectors(id, workspace_id, database_id → databases, kind, sync_config jsonb, auth_config bytea ENCRYPTED, last_sync_at, last_status, enabled, created_by)` + `connector_conflicts(id, connector_id, db_row_id, property_id, local_value, remote_value, resolved_at, resolution)`. A `ConnectorAdapter` interface (`pull` / `push` / `subscribe`) + sync engine with LWW per-cell conflict resolution (each `db_cell` carries a `last_modified_at` shadow; the higher timestamp wins; ties record a conflict). Conflict-review inbox at `/settings/admin/connectors/[id]/conflicts`. Single-instance ceiling — multiple instances will double-fire (documented).
- **P20** Google Sheets adapter: OAuth (Google client id + secret env-only) → Drive change webhooks for change notifications + the Sheets v4 Records API for read/write; `auth_config` holds the refresh token encrypted via the v0.6 secret-box (AES-256-GCM, key = HKDF of `AUTH_SECRET`). Sheets-side webhook receiver verifies `x-goog-channel-token` (workspace-scoped UUID; cross-workspace → 404, never 403).
- **P21** Airtable adapter: paste-PAT auth + Airtable webhooks + the Records API; PAT + webhook MAC secret both encrypted in `auth_config`. Webhook receiver verifies HMAC-SHA256 over the request body (constant-time compare); cross-workspace → 404.
- **P22** CSV adapter: poll-only (no webhooks; configurable polling interval); resolves relative paths under `CAIRN_CONNECTOR_CSV_PATH` and rejects paths whose resolved form escapes the mount prefix (path-traversal guard). Connector secret-leak suite extended to assert Sheets refresh tokens + Airtable PATs + Airtable webhook MAC secrets never appear in API responses, audit metadata, token-usage log, or workspace exports.

## [0.6.0] - 2026-05-23

> Large consolidated release closing Notion-parity gaps across content/databases, sharing/collaboration, mobile/a11y/i18n, admin/observability/ops, and import/export. Migrations `0013`–`0023`. Built area-by-area (plans P1–P23); entries below are grouped by plan.

### Added (v0.6.0 P23 — Combined smoke & release)
- Combined cross-feature docker-compose smoke (`scripts/smoke-v0.6.0.sh`) exercising all five bands against a live boot: content/database (reverse relations, list view, row hierarchy, calc footer, new blocks), sharing (password + expiry publish, public site `/s/<slug>`, duplicate), collaboration (row comment, suggestion accept), mobile/observability (PWA manifest, token-gated `/metrics`), admin/ops (audit log, 2FA enroll, quota enforcement), and import/export (workspace archive round-trip).
- README "v0.6.0 features" overview + "Security & operations caveats"; SECURITY.md updated with the new secret classes, anonymous surfaces, observability gating, and the single-instance scheduling ceiling.
- Bumped version to 0.6.0; reused the existing private-repo-safe multi-arch native-runner release workflow to publish `ghcr.io/jonathanmcohen/cairn:0.6.0`.

### Added (v0.6.0 P1 — Reverse (bidirectional) relations)
- Relation properties can mint a mirrored relation on the target database (`reversePropertyId` in the relation config); writing a relation cell syncs the paired cell on the linked rows, with a re-entrancy guard so the two sides never loop.

### Added (v0.6.0 P2 — List view + filters + grouping + multi-sort)
- New `list` view type (migration `0013`, `ALTER TYPE view_type ADD VALUE 'list'`); per-type filter operators (text contains/starts/ends/is/is-not/is-any-of, number/date between/≠, checkbox is); client-side grouping (`groupRows`) with a leading "Uncategorized" group; multi-column sort config.

### Added (v0.6.0 P3 — Row hierarchy / sub-items)
- `db_rows.parent_row_id` self-FK (migration `0013`, on-delete set null); same-database + no-cycle validation; rows render as an expand/collapse forest.

### Added (v0.6.0 P4 — Blocks pt.1: toggle / columns / table)
- Toggle (collapsible) block, multi-column layout block, and a simple table block (`@tiptap` TableKit) — all Yjs round-trip safe.

### Added (v0.6.0 P5 — Blocks pt.2: embed / bookmark / math / synced)
- Allowlist-only `embed` (YouTube/Vimeo/Figma/gist/CodeSandbox, https-only, sandboxed iframe); `bookmark` unfurl card via an SSRF-guarded `/api/unfurl`; KaTeX `math` (inline + block); same-page `syncedBlock` (live read-only mirror of a source block). Yjs round-trip audited.

### Added (v0.6.0 P6 — Table of contents + outline + full-page DB + calc footer)
- `tableOfContents` node (live heading links, no stored state) + a header-toggled outline panel; full-page-database render mode over the existing views; per-column calc footer (count/sum/avg/min/max/empty/filled) stored in the view config jsonb.

### Added (v0.6.0 P7 — Per-page share settings + public site)
- Per-page link password (Argon2id via `@node-rs/argon2`), expiry, and allow-duplication (migration `0014`); an HMAC-signed per-page access cookie reusing the v0.5.0 file-URL signer (no new secret); a workspace public site at `/s/<slug>` (migration `0015`) listing published pages and linking through to each page's own `/p/` gate. Expired/unpublished/unknown → 404, never 403. CSP `frame-src` now allowlists exactly the embed providers (unblocks P5 embeds, drift-guarded against the embed allowlist).

### Added (v0.6.0 P8 — Comments on databases + files)
- `0016` migration: `comment_target` enum (`page`/`db_row`/`file`) + `target_type`/`target_id` columns on `comments`, a `(target_type, target_id)` index, existing rows back-filled to their page (`target_id = page_id`); `page_id` is now nullable to permit page-less file comments.
- Polymorphic comment threads: comments anchor to a page, a database row, or a file via `(target_type, target_id)`, workspace-scoped, cross-workspace → 404. `page_id` is denormalized (owning page of the row's database / the file's page) so the @mention + comment-reply notification fan-out stays page-anchored.
- `src/lib/comments/target.ts`: `CommentTarget` schema + `resolveTarget` (validate target in workspace, denormalize page id). `createComment` now takes a `target` and fires the `comment.created` webhook for every target type; `listCommentsByTarget` lists by target; `resolve`/`delete` are target-agnostic.
- API: `POST`/`GET /api/databases/[databaseId]/rows/[rowId]/comments` and `POST`/`GET /api/files/[fileId]/comments` (editor+ / viewer+). PATCH/DELETE reuse `/api/comments/[commentId]`.
- Target-generic `TargetCommentPanel` + `RowComments`/`FileComments` wrappers (mounting awaits a row-expand / file-viewer surface).

### Added (v0.6.0 P9 — Suggestion / track-changes mode)
- Yjs-native suggestion mode: `suggestion-insert`/`suggestion-delete` marks + a `suggestion-block` node carrying author + suggestion id ride the live collab doc; a `suggestions` index table (migration 0017, `suggestion_status` enum) lists open suggestions without parsing the doc.
- Propose / accept / reject: a pure ProseMirror transform resolves a suggestion to clean text, applied both to the live Y.Doc (idempotent) and to `pages.content` server-side under a status-guarded conditional update, so the index never drifts from the marks and concurrent resolves can't flip-flop.
- A suggestion-mode toolbar toggle + accept/reject UI (editor+ only); public `/p/` + `/s/` pages render the clean accepted text (no suggestion chrome).
- Role-gated: proposing and accepting/rejecting require `editor`+; viewers see no suggestion controls and the API fails closed.

### Added (v0.6.0 P11 — BYO-SMTP email notifications + preferences)
- Opt-in email notifications via a bring-your-own SMTP server (`SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM`/`SECURE` env, `nodemailer`); fully disabled — a clean no-op — when `SMTP_HOST` is unset (the transport factory returns null, the single chokepoint every send path checks).
- Per-event email fired fire-and-forget from the notify path (`setImmediate`, never awaited, errors swallowed — mirroring the webhook `emit` pattern), gated by each user's `notification_email_prefs`; the SSRF guard runs on every rendered deep link.
- Digest mode: `scanDigests` batches a user's unread digest-only notifications into one email, idempotent via a per-user `system_meta` watermark; runnable via `pnpm email:digest` (tsx) or an opt-in single-instance `CAIRN_DIGEST_INTERVAL` ticker in instrumentation (external-cron recommended).
- Email templates (plain text + minimal inline-styled HTML).
- Notification-preferences API (`GET`/`PUT /api/notifications/prefs`) + a settings panel (`/settings/notifications`) with a per-type email / in-app-only / daily-digest choice, surfacing the SMTP-unset state. Backed by the `notification_email_prefs` table (created in migration 0018).

### Added (v0.6.0 P10 — page links + backlinks + page mentions/embeds + row templates)
- Page links: `[[` autocomplete inserts a `pageLink` to another workspace page; `@@` inserts a `pageMention` (member `@`-mentions unchanged); a "Page embed" slash entry inserts a `pageEmbed` snapshot card.
- Write-time `page_links` index (`reindexPageLinks` on save) powering a "Linked references" backlinks panel; read-time "Unlinked mentions" FTS search for the page title.
- Per-database row templates (`rowTemplates` in `databases.config`, migration 0019) + a "new row from template" picker on the table view.
- `GET /api/workspaces/pages?q=` — workspace page search (viewer+) for the page picker; `GET /api/pages/[pageId]/backlinks`.
- Migration `0018`: `page_links` index table + `notification_email_prefs` (the email-prefs store consumed by P11).
- New editor nodes (`pageLink`/`pageMention`/`pageEmbed`) verified Yjs round-trip safe.

### Added (v0.6.0 P12 — Responsive / mobile UI)
- A shared `useFocusTrap` a11y primitive (unit-tested); below the `md` breakpoint the desktop sidebar is replaced by a hamburger + an off-canvas, `aria-modal`, focus-trapped, Escape/backdrop-dismissable drawer rendering the same nav; the page header wraps and tightens gutters and the editor prose relaxes width on small screens; database views adapt for touch (table horizontal-scroll + taller rows, narrower kanban columns, single-column gallery under `sm`).

### Added (v0.6.0 P13 — PWA + bounded offline)
- Cairn is now an installable PWA: a web app manifest, maskable + any-purpose icons, an apple-touch icon, and a service worker built with `@serwist/next` (configurator mode — `serwist build` post-step, Turbopack-compatible). SW registration is CSP-nonce-clean (a bundled module, not an inline script; auto-registration disabled).
- The service worker precaches the app shell, stale-while-revalidates idempotent page/search reads, network-firsts navigations with an `/offline` fallback, and is **network-only (never caches)** for auth, mutations, signed `/api/files` URLs, and the collab WebSocket. The strategy allow-list is unit-tested (network-only checked first).
- Bounded offline editing: opened pages persist to IndexedDB (`y-indexeddb`) on the existing Yjs/Hocuspocus doc, so recently-viewed pages READ offline and offline edits CRDT-merge on reconnect — no new queue. An `aria-live` offline indicator shows connection state.
- Offline scope is deliberately bounded (NOT offline-first): only Yjs edits to already-opened pages work offline; creating/moving/deleting pages, database mutations, file uploads, comments, and sharing are disabled offline (not silently queued), enforced by a unit-tested `isActionAllowedOffline` gate.

### Added (v0.6.0 P14 — Accessibility / WCAG 2.1 AA)
- WCAG 2.1 AA compliance across the editor, sidebar, database, dialog, and sign-in screens, verified by an `@axe-core/playwright` gate (`pnpm test:a11y`) on both light and dark themes and run as a CI `a11y` job that fails on any violation.
- Skip-to-content link, `<main>`/`<nav>`/`<aside>` landmarks with accessible names, labelled icon-only buttons, an `aria-live` region for save-status, ARIA listbox/option roles on the editor's slash + mention popups, dialog roles + Esc-close + focus restore on overlays, AA-contrast theme tokens (light + dark), and a global visible `:focus-visible` ring.
- A manual screen-reader checklist (`docs/a11y-screen-reader-checklist.md`) covers what axe can't (reading order, live announcement quality, keyboard feel).
- Editor mount fix: distinct `PluginKey` per `@tiptap/suggestion` plugin (member-mention `@`, page-link `[[`, page-mention `@@`), unblocking the audit and fixing a runtime crash that landed in P10.

### Added (v0.6.0 P15 — Keyboard shortcuts + i18n)
- Typed shortcut registry (`src/lib/shortcuts/registry.ts`) with registration-time conflict detection + a pure `matchShortcut` (unit-tested), driving a global dispatcher (replacing the hand-rolled ⌘N handler), a discoverable ⌘/ overlay sheet listing every registered shortcut grouped by scope, and the ⌘K palette's Actions group — all reading the SAME registry (one source of truth).
- Global entries seeded: ⌘N New page, ⌘⇧L Toggle theme, ⌘⇧O Switch workspace, ⌘⇧F Open favorites, ⌘/ Show shortcuts.
- Dependency-light i18n: pure `t()` (flat-key + `{name}` interpolation + `Intl.PluralRules` plural + missing-key→key fallback, unit-tested), pure `resolveLocale(cookie, acceptLanguage)` (unit-tested, cookie → Accept-Language → en), an `I18nProvider`/`useT()`/`useLocale()`, flat-key JSON catalogs for `en` + `ar` (the RTL proof), a `<LocaleSwitcher>` writing the `cairn_locale` cookie, and root-layout `<html lang dir>` wiring with RTL logical-property CSS (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`) on the always-rendered app chrome.

### Added (v0.6.0 P16 — Favorites/recents + column ergonomics + block convert + multi-select)
- Migration `0020` adds a `user_page_prefs` table (`{user_id, workspace_id, page_id, favorite, favorite_order, last_visited_at}`, unique `(user_id, page_id)`, favorites + recents read indexes).
- Favorites + Recents helpers (`toggleFavorite`/`reorderFavorites`/`recordVisit`/`listFavorites`/`listRecents`, recents capped at 20, favorites never pruned) + `GET`/`POST /api/prefs/favorites`, `POST /api/prefs/favorites/reorder`, `GET /api/prefs/recents`. Favorites + Recents sidebar sections render above the page tree (in both desktop aside and mobile drawer); favorites support star toggle + native drag-and-drop reorder.
- Column ergonomics in `db_views` config jsonb (no schema): `columnWidths` / `frozenColumnIds` / `hiddenColumnIds` validated by `ViewConfigSchema`. The table view renders a `<colgroup>` for stable widths, drops hidden columns, and emits sticky `inset-inline-start` offsets (RTL-safe) for frozen columns.
- Editor `turnInto(name)` block-conversion command over a typed CONVERTIBLE map (paragraph ↔ heading/lists/blockquote/codeBlock), declines incompatible targets without mutating. Multi-block selection helpers (`blockRange`/`selectBlockRange`/`deleteBlocks`/`convertBlocks`) enabling bulk delete + bulk convert as ordinary ProseMirror transactions — a Yjs round-trip audit proves identical JSON across two Yjs-bound editors after conversion.

### Added (v0.6.0 P17 — Workspace admin console)
- Migration `0021` adds `workspaces.require_2fa` + `workspaces.home_page_id` columns + new `audit_log` and `user_totp` tables (consumed by P18 audit-log viewer + P19 TOTP 2FA, both without further migrations).
- Admin route group at `/settings/admin` (admin+ gated) with Members, Invites, Settings, and Danger sub-pages.
- Members management: `PATCH`/`DELETE /api/workspaces/[id]/members/[userId]` over `setMemberRole`/`removeMember` helpers with typed error codes (`CANNOT_SET_OWNER`, `LAST_OWNER`, `CANNOT_REMOVE_OWNER`, `CANNOT_REMOVE_SELF`); cross-workspace → 404.
- Invites: `listPendingInvites`/`revokeInvite` helpers + `GET /api/workspaces/[id]/invites` + `DELETE /api/workspaces/[id]/invites/[inviteId]` over the v0.2.0 invite path (revoke reuses `usedAt`); admin UI lists pending and shows the `/invite/<token>` link on create.
- Workspace settings: `updateWorkspaceSettings(db, …)` + `PATCH /api/workspaces/[id]/settings` for `name`/`require_2fa`/`home_page_id` (home page validated to be in the same workspace; persisted with an audit `workspace.settings_changed`).
- Owner-only lifecycle: `transferOwnership` (promote target, demote actor to admin, audited `workspace.ownership_transferred`) + `deleteWorkspace` (cascade-deletes; audited `workspace.deleted`) + `POST /api/workspaces/[id]/transfer` + `DELETE /api/workspaces/[id]` + a danger-zone UI requiring typed-name confirmation.
- `recordAudit(tx, …)` helper introduced as a stub; P18 fully wires it into every sensitive helper + ships the audit-log viewer + per-page activity feed.

### Added (v0.6.0 P18 — Audit log + per-page activity feed)
- Real append-only `recordAudit(db|tx, …)` helper returning the inserted row, called INSIDE each sensitive action's transaction so the log can never drift; strict `AuditAction` literal union (one documented vocabulary) + `assertAuditMetadataClean` defense-in-depth redaction guard rejecting any forbidden substring (AUTH_SECRET / `cairn_whsec_` / `cairn_sk_` / `token_hash` / `password_hash` / `secret_encrypted`) or secret-ish key with a long base64 value.
- Wired `recordAudit` into 16 sensitive sites: `publishPage` / `unpublishPage`, `setShareSettings` (P7), `mintKey` + `revokeKey`, `createWebhook` + `deleteWebhook`, `softDeletePage`, `archiveDatabase`, `setMemberRole` + `removeMember` (P17), `createInvite` + `revokeInvite`, `savePageAsTemplate` + `saveDatabaseAsTemplate`, `restoreVersion`. Metadata is ids/names/roles/booleans only — never secrets.
- Paginated/filterable audit query layer (`listAuditLog` + `listPageActivity`, keyset cursor) + `GET /api/admin/audit` (admin-gated, workspace-scoped, filters: action / actorId / targetType / targetId / from / to) + `GET /api/pages/[pageId]/activity` (gated `viewer+` via `requirePageAccess`).
- Admin audit viewer at `/settings/admin/audit` (filter bar + paginated table with expandable metadata) and a per-page activity feed (mounted in the page menu) that links `page.version_restored` entries to version history for content diffs.
- The v0.5.1 secret-leak suite is extended with cross-cutting assertions: no `audit_log` row's metadata and no admin viewer response leaks an API token, webhook signing secret, invite token, share password, TOTP `secret_encrypted`, recovery codes, password/token hash, or the metrics token.

### Added (v0.6.0 P19 — TOTP 2FA + recovery codes)
- Per-user TOTP enrollment (RFC 6238, otplib 13) with QR + manual key + 10 single-use recovery codes shown ONCE at `/settings/security`. The shared secret is **encrypted at rest** (AES-256-GCM with an HKDF-derived key from `AUTH_SECRET` — `src/lib/crypto/secret-box.ts`); recovery codes are **hashed at rest** (SHA-256 over a normalized form, single-use consumed atomically).
- Sign-in second-factor challenge in the Auth.js credentials `authorize`: a 2FA-enabled user must supply a valid TOTP code OR an unused recovery code; a missing/blank code with 2FA enabled fails closed (generic `CredentialsSignin` — no enumeration). `verifySecondFactor` stamps `last_used_at` on any success and persists the consumed recovery-code set in the same update.
- `require_2fa` workspace gate: when any of a signed-in user's workspaces has `require_2fa=true`, the `(app)` layout redirects to `/settings/security?enroll=required` until enrollment confirms — `src/proxy.ts` pipes the request path via `x-pathname` so the layout can read it (proxy.ts stays cookie-only by design).
- The v0.5.1 secret-leak suite is extended with TOTP coverage: the stored `user_totp` row never contains the plaintext secret or codes; the workspace-members / webhooks / admin-audit responses never contain the plaintext secret, the sealed bytea (hex or latin1), any plaintext recovery code, or any stored recovery-code hash; the enroll+confirm path emits no TOTP material via `console`.

### Added (v0.6.0 P20 — Observability: metrics + structured logging)
- `prom-client`-backed metrics registry (`src/lib/observability/metrics.ts`) with a closed set of aggregate-only metrics — `http_request_duration_seconds` + `http_requests_total` (labels: `method` / `route` / `status`), `db_query_duration_seconds`, `collab_active_connections`, `collab_doc_updates_total`, `webhook_delivery_total` + `webhook_delivery_duration_seconds`, `notifications_sent_total`. Every `labelNames` list is closed and contains **no tenant / user / page identifier**.
- `routeTemplate()` normalizer (`src/lib/observability/route-template.ts`) collapses concrete ids (UUIDs, long hex, numeric, opaque slugs) to `:id` so the `route` label stays bounded — 1000 distinct page ids collapse to a single series (cardinality guard).
- `GET /metrics` (`src/app/metrics/route.ts`, nodejs runtime): **off by default — 404 when `CAIRN_METRICS_TOKEN` is unset**, **401** with missing/wrong bearer (`crypto.timingSafeEqual`), **200** Prometheus exposition only on the right token. Reads `process.env.CAIRN_METRICS_TOKEN` directly so the toggle is per-request.
- Instrumentation: `src/proxy.ts` records every request (route TEMPLATE, never the raw pathname); `listRows` in `src/lib/databases/rows.ts` records `db_query_duration_seconds{operation="list_rows"}`; the collab process (`collab/server.ts`) maintains a per-process gauge of active connections and a doc-update counter (counters populate the collab process's own registry — cross-process aggregation is a deploy concern, not faked here).
- `pino` structured-JSON logger (`src/lib/observability/logger.ts`) with a wildcard `REDACT_PATHS` list covering `passwordHash` / `tokenHash` / `secret` / `secret_encrypted` / `recovery_codes` / `authorization` / `cookie` / `AUTH_SECRET` / `CAIRN_METRICS_TOKEN` / `sig`; the test asserts every declared secret VALUE is absent from real serialized output and `[Redacted]` appears in its place. The webhook dispatcher and notification fan-out swap their `console.*` for the logger and record `incWebhook({ event, outcome, durationSec })` / `incNotificationsSent({ channel })` with bounded label values.

### Added (v0.6.0 P21 — Quotas + scheduled backups + import/export)
- **Per-workspace storage quotas** (`workspace_quotas` table) with lazy row creation, transactional counter (`incrementStorageUsed`/`decrementStorageUsed` clamped at zero), `checkStorageQuota` enforcement at `storeUpload` BEFORE any blob is written (rejects with `QuotaExceededError` when `used + incoming > limit` — null limit = unlimited), and `reconcileQuota` recompute from the canonical `files.size` sum (CLI `reconcile [--workspace <id>]` — the counter-drift backstop).
- **Backup CLI extensions:** `--retention-days N` prunes old `cairn-backup-*` / `cairn-uploads-*` bundles in `--out` after a successful run; `--target s3` additionally mirrors the bundle into the configured `FileStorage` (S3/MinIO) under `backups/`. Scheduling mechanism is documented external cron (recommended) OR an opt-in, off-by-default, **single-instance** `CAIRN_BACKUP_INTERVAL` ticker — multi-instance double-fires; no distributed lock for v1.0.
- **Workspace export** (`cli export --workspace <id> --out <dir>`, `runWorkspaceExport`): a re-importable ZIP containing pages (JSON + Markdown), databases (JSON + CSV), file blobs from `FileStorage`, and a `manifest.json` declaring `format: 'cairn-workspace-archive@1'`. **Secrets are excluded** — no API keys, webhook secrets, TOTP material, recovery codes, or password hashes.
- **Workspace import** (`cli import --source notion|markdown-folder|workspace-archive --file <path> --workspace <id>`, `runImport`): three importer modules all routing through `buildRemap`/`rewriteRefs` (templates id-rewrite — same proven second-pass) so every intra-export id (page, database, property, view, row, parent, page link, relation/rollup config) gets a freshly-minted uuid in the destination workspace, never a colliding source id. Persisted via a direct `persistImportPayload` writer that nests pages exactly as the payload specifies. Each run opens an `import_jobs` bookkeeping row (`status: running` → `completed`/`failed`) and emits a structured `ImportReport` enumerating per-item fidelity gaps (synced blocks, unsupported db property types, Notion-hosted external file URLs). The round-trip integration test proves export → import into a fresh workspace produces the same content with new ids and no secrets.
- **PDF + per-page/per-database UI export:** the page menu adds "Export → Markdown / JSON / PDF" and the database toolbar adds "Export → CSV / JSON" buttons over `/api/pages/[pageId]/export` and `/api/databases/[databaseId]/export`. **PDF is browser-driven** — the route returns print-ready HTML with auto-open `window.print()`; users save as PDF from the browser's native print dialog. This avoids a heavy server-side Chromium/PDF dependency in the homelab image; a native server-side PDF path is deferred to a future plan.

### Added (v0.6.0 P22 — Search filters + saved searches + reminders + bulk ops + workspace-home)
- **Structured search filters:** `compileSearchFilters({author?, dateRange?, types?, scopeDatabaseId?})` AND-composes SQL fragments onto the existing FTS + trigram CTEs in `searchPages`. Author + date range ship live; `types` and `scopeDatabaseId` are accepted-but-inert (reserved for a future pages+db_rows union search; the filter vocabulary is part of saved_searches.filters jsonb so the shape is stable today). Every interpolated UUID is validated to defend the raw-SQL boundary.
- **Per-user saved searches** (`saved_searches` table from P21): `createSavedSearch` / `listSavedSearches` / `updateSavedSearch` / `deleteSavedSearch` with owner-scoped predicates (cross-user mutation rejects). REST endpoints at `GET`/`POST /api/search/saved` and `PATCH`/`DELETE /api/search/saved/[savedSearchId]`. UI: a "Saved searches" cmdk group + "Save this search" footer in the search palette and a sidebar list (clickable to re-run, delete-with-confirm). `/api/search` now accepts `author` / `from` / `to` / `types` / `scopeDatabaseId` query params and forwards them through the compiler.
- **Reminder materialization + scan:** `materializeReminders(db, {workspaceId, databaseId, rowId})` reads each `date`-typed property's `config.reminder.leadTime` and upserts a `reminders` row at `remind_at = dateValue - leadTime` (idempotent per `(row_id, property_id)`; clearing the date deletes the reminder). `scanReminders(db, now)` fires polled in-app notifications via the v0.3.0 path (new `notifications.type = 'reminder'` literal, no migration — column is plain text) and stamps `fired_at` so a row never double-fires; served by P21's partial index `reminders(remind_at) WHERE fired_at IS NULL`. A `pnpm cli reminders:scan` subcommand wires it. **Single-instance ceiling:** two instances scanning concurrently can double-fire (same ceiling as the backup ticker and single-instance collab — no distributed lock for v1.0).
- **Bulk operations:** `bulkTrashPages` / `bulkRestorePages` / `bulkMovePages` run a per-item soft-delete / restore / parent-move over a selection inside one transaction. Each item attempts independently; the response carries `{succeeded[], failed:[{id, reason}]}` (partial-failure report). Role checked once up front (editor+); per-item workspace ownership enforced in the SQL predicate so cross-workspace ids can't slip through. Exposed at `POST /api/bulk` with a Zod-validated `{op, ids[], params?}` body. UI multi-select bar and `bulkDuplicate` / `bulkTagRows` deferred — they require invasive selection-state wiring into the existing components and deep integration with the per-item duplicate/cell helpers.
- **Workspace-home landing:** `resolveLandingPage(db, {workspaceId, userId})` returns `workspaces.home_page_id` if set AND the page is live + in-workspace, else the oldest live page, else null. The `(app)` dashboard route now `redirect()`s to `/pages/<id>` when a landing resolves, falling back to the empty-state CTA otherwise.

## [0.5.1] - 2026-05-21

### Security (v0.5.1)
- Adversarial security-regression suite (`tests/security/`): table-driven cross-workspace isolation (→404), RBAC ceilings, file-URL HMAC forge/expiry, public-sharing leakage, collab-token forgery, API-key scope/expiry/revoke (v0.5.0-gated), SQL-injection inertness, public-render XSS safety, secret non-leakage.
- Secure-by-default response headers (CSP + nosniff/frame-DENY/referrer/permissions-policy/HSTS), with a locked-down policy for the public `/p/` path.
- In-process token-bucket rate limiting on login, signup, and `/api/collab/token` (keyed by ip + identifier, trust-proxy-aware).
- CI `security` job: `pnpm audit --audit-level=high` (time-boxed ignore list), `gitleaks` secret scan, and the `tests/security` suite; `scripts/smoke-security.sh` live-stack smoke.
- `SECURITY.md` (STRIDE-lite threat model, controls table, residual risks, vuln-reporting) + README security section.

## [0.5.0] - 2026-05-21

### Added (v0.5.0 Plan 5 — Backup CLI & release)
- Backup/restore CLI built into the server image (`node dist/server/cli.js backup|restore`): `pg_dump`/`pg_restore` (custom format) of the database plus a tar of the local uploads tree, written as a timestamped bundle + manifest. The `restore` command is destructive and gated behind an interactive confirmation prompt and a `--force` flag; passwords are passed via `PGPASSWORD`, never on the argv.
- S3 backend awareness: with `FILE_BACKEND=s3` the CLI backs up the database only and notes that buckets are backed up out-of-band.
- README "Operations" section documenting backup/restore usage, the `pg_dump`/`pg_restore` version-match requirement, the S3 caveat, and the sensitive-data warning (bundles contain password & API-key hashes and files).
- Cross-feature integration smoke: mint an API key → API-create a page → assert a webhook delivery row is enqueued → snapshot a version → save and instantiate a template.
- Bumped version to 0.5.0; reused the existing private-repo-safe release workflow to publish `ghcr.io/jonathanmcohen/cairn:0.5.0`.

### Added (v0.5.0 Plan 4 — Version history + S3 backend)
- Debounced, deduped page version snapshots on save: a `PATCH /api/pages/[pageId]` with `content` snapshots into `page_versions` only when the latest version is missing or is ≥ ~60s old AND differs, so keystroke spam is debounced and identical re-saves are deduped; history is pruned to the newest 50 per page. Snapshots are best-effort and never break a save.
- Non-destructive restore: `restoreVersion` writes the chosen content back as the live page content **and** appends a new version row — history is append-only and the restore shows up as the newest entry. Restore is editor-gated (route + UI).
- A version-history panel that lists versions and diffs any two entirely client-side (JSON diff).
- An `S3Storage`/MinIO backend behind the existing `FileStorage` seam, selected by `FILE_BACKEND=local|s3` in `getStorage()`, with an optional `minio` compose profile for local/dev. The HMAC signed-URL handler is unchanged (no presigned URLs).

### Added (v0.5.0 Plan 3 — Templates)
- Capture a page subtree (its content, every descendant page, and every embedded inline database) or a standalone database (properties + views, sample rows opt-in) as a portable, workspace-free JSON template.
- Instantiate any template into any workspace: mints a fresh uuid for every captured page/database/property/view/row and rewrites every internal reference — page parent links, embedded `database`-node `databaseId`s (deep content walk), and property-id references inside view configs and relation/rollup property configs — inserting the whole graph in one transaction with no source id surviving.
- Seeded global built-in templates (Meeting notes, Weekly planner, Project tracker), re-seeded idempotently at startup and visible to every workspace.
- Save-as-template actions on pages (and databases) that capture the entity into a workspace template via the session-gated `POST /api/templates` route.
- A Templates gallery (`/templates`) listing built-in + workspace templates with a "Use template" button that instantiates into the current workspace and opens the new copy, plus delete for workspace templates.

### Added (v0.5.0 Plan 2 — Webhooks)
- HMAC-SHA256-signed outbound webhooks: every delivery carries an `X-Cairn-Signature: sha256=<hmac>` header keyed by the per-hook secret so receivers can verify authenticity.
- `page.*`/`row.*` events emitted fire-and-forget from the mutation helpers — the mutation returns without awaiting delivery, so request latency is unaffected.
- Bounded retries with exponential backoff and a visible `webhook_deliveries` log recording `event`/`status`/`last_status`/`attempts`/`delivered_at`.
- SSRF guard on outbound URLs: blocks loopback/link-local/private/reserved targets (IPv4 + IPv6, including DNS rebinding and IPv4-mapped IPv6) before any POST, with a `WEBHOOK_ALLOW_PRIVATE` escape hatch for intentional internal targets.
- Startup sweep that recovers in-flight work by re-attempting every `pending`/`failed` delivery (documented in-process ceiling — no distributed queue).
- Admin-only webhook-management settings UI: create a hook (URL + event-subscription checkboxes + show-once signing secret), toggle `active`, delete, and read a recent-delivery log.

### Added (v0.5.0 Plan 1 — Public API & keys)
- `0012` migration adding five v0.5.0 tables (API keys, webhooks, webhook deliveries, and Plan 2–4 scaffolding) plus their indexes — a single shared migration the rest of v0.5.0 builds on.
- `cairn_sk_` workspace API keys: minted server-side, sha256-hashed at rest (plaintext shown **once** and never recoverable), with an assigned role, optional expiry, and a stored display prefix.
- `/api/v1` HTTP API for pages, databases, and database rows (full CRUD) authenticated via `Authorization: Bearer cairn_sk_…`, resolving to an `AuthContext` so existing role/workspace checks apply unchanged; cross-workspace ids return 404.
- Cursor-paginated list endpoints (`?cursor=&limit=`, max 100, `{ data, nextCursor }` envelope) and a uniform `{ error: { code, message } }` error shape across all `/api/v1` responses.
- Per-key in-memory token-bucket rate limiting (documented single-instance ceiling, returns `429 rate_limited`).
- Admin-only API-key management settings UI (list by prefix/role/last-used/expiry, create with show-once token, revoke) plus a hand-written README API reference.

## [0.4.0] - 2026-05-21

### Added (v0.4.0 Plan 5 — Polish & release)
- Cross-feature integration smoke (Testcontainers): one database exercising a formula property, a relation to a second database, a rollup over that relation, and a calendar view on a date property — asserting `listRows` returns correct computed formula + rollup values, resolved relation labels, dangling-id filtering, and that calendar/timeline view configs are accepted.
- README: formula/relation/rollup property types and calendar/timeline views, with a prominent note that formula/rollup values cannot be filtered or sorted (computed post-SQL) and that reverse relations are not yet supported.
- Bumped version to 0.4.0; reused the existing private-repo-safe release workflow to publish `ghcr.io/jonathanmcohen/cairn:0.4.0`.

### Added (v0.4.0 Plan 4 — Calendar + timeline views)
- `0011` migration: extended the `view_type` enum with `calendar` and `timeline`.
- Pure calendar month-grid + day-bucketing helper; calendar view places rows by a date property, click a day to add a row prefilled with that date.
- Read-only timeline view positioning rows by a single date or start/end pair via CSS (drag-to-reschedule deferred).
- Calendar/timeline view config requires a date property (validated like kanban `groupBy`).
- View switcher gains Calendar and Timeline entries with a required date-property picker.

### Added (v0.4.0 Plan 3 — Rollups)
- Pure rollup aggregation module (`count`/`sum`/`avg`/`min`/`max`/`earliest`/`latest`).
- Rollup property config schema with relation + target-property validation.
- `listRows` rollup pass aggregates target cells through a relation (batched, no N+1).
- Property-panel rollup config UI (relation + target-property + fn selectors).

### Added (v0.4.0 Plan 2 — Relations)
- Relation property config schema with same-workspace target-database validation.
- Relation cells coerced to a deduped `string[]` of related-row ids; ids validated against live target-db rows on write (batched).
- `listRows` resolves relation cells to ids + labels and drops dangling ids (batched, no N+1).
- Relation cell row-picker editor (add/remove related rows) and property-panel relation type with a same-workspace target-database picker.

### Added (v0.4.0 Plan 1 — Formulas)
- `0011` migration: extended the `property_type` enum with `formula`, `relation`, and `rollup`.
- Formula tokenizer + recursive-descent parser → AST; function table (`if`/`concat`/`length`/`round`/`abs`/`min`/`max`/`sum`/`now`/`dateDiff`).
- Formula evaluator + `computeFormula` entrypoint (errors surface as `{__error}`, never throw).
- `listRows` formula post-fetch pass computes formula cells from sibling values (never stored).
- Property-panel formula editor (live error hint) + read-only computed-cell display.
- Allowed the new formula/relation/rollup property types in the create-property route schema.

## [0.3.0] - 2026-05-21

### Added (v0.3.0 Plan 6 — Notifications & release)
- `0010` migration: `notifications` table (per-user, workspace-scoped, `mention` | `comment_reply`).
- Notification helpers (`notifyMentions`, `notifyCommentReply`) fired on comment create; dedupe + skip-self.
- Notifications feed API (`GET /api/notifications` with `unreadOnly` + pagination; `POST /api/notifications/read`).
- Notification bell: polls unread every ~30s, unread-count badge, dropdown linking to each page/comment.
- Release workflow now builds + publishes the `cairn-collab` image alongside `cairn` (multi-arch, private-repo-safe).
- Bumped version to 0.3.0.

### Added (v0.3.0 Plan 5 — @mentions)
- `GET /api/workspaces/members?q=` — member-search (ILIKE name/email), viewer+, workspace-scoped, for mention autocomplete.
- `@`-mention autocomplete in the editor and comment composer via `@tiptap/extension-mention` (suggestion-based, mirrors the slash menu). Mentions are stored as `@[Name](userId)` tokens.
- `extractMentions()` helper; comment creation parses out and returns the mentioned userIds.
- Mention rendering: styled inert link in the editor; styled plain text on read-only/public pages (no profile page yet).
- (Mention → notification creation is wired in Plan 6, which consumes the `mentionedUserIds` returned from comment creation.)

### Added (v0.3.0 Plan 4 — Comments)
- `0009` migration: `comments` table (workspace→cascade, page→cascade, author→restrict; `body`, nullable jsonb `anchor`, `resolved_at`, timestamps; indexed on page + workspace).
- Comment anchor model: `null` = page-level, `{ blockId }` = block-anchored (scroll-to + highlight), `{ from, to }` = ProseMirror range (stored; visual range-highlight deferred to v0.3.x).
- `src/lib/comments/*` helpers: `createComment` (page+workspace scoped, validated anchor), `listComments` (created_at order, includes resolved), `resolveComment`/`reopenComment`, `deleteComment` (author or admin+).
- API: `POST`/`GET /api/pages/[pageId]/comments` (editor+ / viewer+), `PATCH`/`DELETE /api/comments/[commentId]` (resolve-reopen editor+, delete author-or-admin).
- Comment sidebar panel with a page-header toggle: list/add page-level threads, resolve/reopen, delete; clicking a block-anchored comment scrolls to its block.

### Added (v0.3.0 Plan 2 — Collaborative editing)
- Live multiplayer editing: the page editor binds a Yjs `Y.Doc` synced through `cairn-collab` (Hocuspocus) via `useCollabDoc`; `Collaboration` + `CollaborationCursor` replace local history when a doc is supplied.
- Collab server materializes the merged Yjs doc back into `pages.content` (debounced + flushed on last disconnect), so search/export/public-render keep reading `pages.content`; the existing FTS trigger refreshes `content_text`/`content_tsv`.
- Read-only viewers connect with a viewer-role token and a non-editable editor that writes no awareness.

### Added (v0.3.0 Plan 3 — Presence)
- Live remote cursors with name labels and a deterministic per-user color (`userColor(userId)` → stable HSL) via TipTap `CollaborationCursor`, fed the signed-in user's identity from the session.
- "Who's here" avatar stack in the page header showing connected collaborators (`PresenceAvatars`).
- `useCollabPresence(provider)` hook deriving the live remote-user list from Yjs awareness, plus a unit-tested `awarenessToUsers` transform that dedupes a user across multiple tabs and excludes the local client.

### Changed
- Retired the v0.1.0 debounced content PATCH and its 409 conflict path on the collaborative editing path (Yjs is conflict-free; the collab server is the writer). Title/icon/cover metadata PATCH is unchanged.

### Added (v0.3.0 Plan 1 — Collab infrastructure)
- `0008` migration: `page_yjs` table (page_id PK → pages cascade, `state` bytea, `updated_at`) for Yjs document persistence.
- Shared collab token lib (`src/lib/collab/token.ts`): HMAC-signed compact token (userId/pageId/role/exp ~5 min), mint + constant-time verify, reusing the `AUTH_SECRET` signing approach.
- `GET /api/collab/token?pageId=`: `requirePageAccess`-gated, returns a page+role-scoped token and the browser `COLLAB_URL`.
- `cairn-collab` service: a standalone Hocuspocus server (`collab/server.ts` + `Dockerfile.collab`) persisting Yjs docs to `page_yjs` and authorizing connections via the shared token (`authorizeCollab`).
- docker-compose wiring for `cairn-collab` (shares DB + `AUTH_SECRET`, WS port published) and `COLLAB_URL` on the `cairn` service.
- `yjsStateToProseDoc` materializer stub (wired to write `pages.content` in Plan 2).
- Optional `COLLAB_URL` env (default `ws://localhost:1234`).

## [0.2.0] - 2026-05-21

### Added (v0.2.0 Plan 4 — Polish & release)
- Cross-feature end-to-end smoke covering OAuth provider listing, multi-workspace create/switch/scoping, invite-accept as an existing user, leave-workspace (incl. sole-owner rejection), and publish → anonymous `/p/<slug>` (image + read-only database) → unpublish.
- README: OAuth login, multiple workspaces, and public sharing features; OAuth setup (env vars + callback URLs); Sharing note.
- Bumped version to 0.2.0; reused the existing private-repo-safe release workflow to publish `ghcr.io/jonathanmcohen/cairn:0.2.0`.

### Added (v0.2.0 Plan 1 — OAuth & user model)
- `0007` migration: `users.email_verified` + `users.image`, `pages.published` + `pages.public_slug`.
- Google + GitHub OAuth providers, enabled only when their env vars are set; "Continue with …" buttons appear conditionally on login/signup.
- Invite-gated OAuth sign-in: links to an existing account by verified email, consumes a matching invite for newcomers, otherwise denies (with an access-denied notice).
- Dropped the v0.1.0 Drizzle-adapter `any` cast now that the users table carries the adapter's expected columns.
- docker-compose passes through `AUTH_GOOGLE_*` / `AUTH_GITHUB_*`.

### Added (v0.2.0 Plan 2 — Multi-workspace switching)
- Active workspace resolved from an httpOnly `cairn_ws` cookie in `getAuthContext`, re-validated against live membership on every call (forged/stale cookie falls back to the oldest membership).
- `POST /api/workspaces` — any authenticated user creates a workspace and becomes its owner; the new workspace is set active.
- `POST /api/workspaces/switch` — set the active workspace for a workspace the caller is a member of.
- `POST /api/workspaces/[id]/leave` — leave a workspace; rejected for the sole owner (no transfer/delete in v0.2.0).
- `POST /api/invites/accept` — a logged-in user accepts an invite (email must match), joining with the invited role.
- Sidebar workspace switcher (switch / create / invite) and an `/invite/[token]` landing page.
- "No workspace" empty state for a logged-in user with no memberships, instead of redirecting to login.

### Added (v0.2.0 Plan 3 — Public sharing)
- Publish/unpublish a page to an anonymous, link-only read-only surface at `/p/<slug>` (editor+). `public_slug` is minted as `<slugified-title>-<6 hex>` on first publish, stays stable across re-publishes, and is retained when unpublished.
- `POST /api/pages/[id]/publish` (returns `{ slug, url }`) and `POST /api/pages/[id]/unpublish`.
- `/p/<slug>` server-renders read-only TipTap (`editable: false`, same extension set); resolves only `published = true AND deleted_at IS NULL`; emits `<meta name="robots" content="noindex">`.
- Embedded images/files on public pages are re-signed server-side at render time (fresh 1-hour HMAC `/api/files/<id>` URLs derived from each node's stored `fileId`).
- Embedded databases render read-only on the public page via `GET /api/public/databases/[id]`, authorized by the containing page's publication (no session, no write surface).
- Middleware allowlists `/p/` and `/api/public` (Cairn's first unauthenticated content paths).
- "Publish to web" / "Unpublish" + copy-public-link in the page overflow menu.

## [0.1.0] - 2026-05-20

### Added (Plan 6 — Release polish)
- Floating drag handle UI for per-block actions (move up/down, duplicate, delete).
- GitHub Actions release workflow: tag-triggered, multi-arch (amd64+arm64), publishes to ghcr.io, generates SBOM + provenance attestations, creates a GitHub Release.
- SECURITY.md and CONTRIBUTING.md.
- Polished README with feature list, configuration table, and image badges.
- CLAUDE.md project guide.

### Added (Plan 5 — Databases)
- 5 new tables (`databases`, `db_properties`, `db_rows`, `db_cells`, `db_views`) + property/view type enums.
- Server helpers: create/get database, property CRUD with type-specific config validation, row+cell CRUD with type coercion, view CRUD.
- Filter compilation (AND of conditions, 8 ops across 7 property types) and multi-column sort compilation.
- API under `/api/databases/...` for databases, properties, rows (filter/sort query), and views.
- TipTap `database` node inserted via slash menu, rendered as a React node view.
- Table view (inline cell editing), kanban view (drag-to-reclassify), gallery view (cards).
- View switcher with add-view, property panel with add-property.

### Added (Plan 4 — Files & markdown)
- `files` table, `pages.cover_url` column, signed file URL helpers.
- `POST /api/upload` (role+size+mime gated) and `GET /api/files/[id]?sig=&exp=` (HMAC-streamed).
- Image and file attachment blocks in the editor; drag/drop + paste image support.
- Cover image picker on the page route.
- Markdown export per page (`.md`) and per subtree (`.zip`).
- Markdown import via overflow menu and via pasting raw markdown into the editor.

### Added (Plan 3 — Search & trash)
- Postgres full-text search with `pg_trgm` trigram fallback for typo-tolerant title matching.
- `searchPages` helper returning snippets (`ts_headline`) and breadcrumbs.
- `GET /api/search` route (viewer+, workspace-scoped).
- ⌘K command palette with debounced query, arrow nav, breadcrumb path display.
- Trash bin: `listTrash`, `restorePage` (cascade-aware via `deleted_root`), `hardDeletePage`.
- Trash API: `GET /api/trash`, `POST /api/pages/[pageId]/restore`, `DELETE /api/trash/[pageId]`.
- `/trash` route with Restore + Delete-forever actions.
- `autoPurge` with `pg_try_advisory_xact_lock` and 1-hour throttle; fired opportunistically from trash and pages routes.
- `system_meta` key/value table for cross-process flags (currently: `last_purge_at`).

### Added (Plan 2 — Pages & block editor)
- Pages table with FTS columns/trigger and self-referential parent.
- Page CRUD APIs (create, read, update, soft-delete, move) with role gates and workspace scoping.
- Cycle detection on page move; cascade soft-delete with `deleted_root` flag.
- Recursive sidebar page tree (server-rendered) with new-page button.
- Empty-state CTA on the dashboard.
- Page route with inline title rename and emoji icon picker.
- TipTap editor (paragraph, H1/H2/H3, bullet/numbered/task lists, blockquote, code with syntax highlight, callout in 4 colors, divider).
- Slash command menu for block insertion.
- Debounced autosave (800 ms) with optimistic UI and stale-write conflict notice.
- ⌘N keyboard shortcut to create a new page.
- React `cache()` wrap on `getAuthContext` to dedupe per-request DB hits.
- Fixed Next.js `typedRoutes` deprecation.

### Added (Plan 1 — Foundation)
- Multi-tenant workspace model with email/password authentication.
- First-user bootstrap (creates workspace, becomes owner) and invite-token signup for subsequent users.
- Roles: owner, admin, editor, viewer (enforced via `requireRole` helper).
- Admin-only invite token issuance API.
- Health endpoint at `/api/health` with database probe and version reporting.
- Light/dark/system theme with toggle.
- Authenticated dashboard shell with sidebar (workspace name, version footer).
- Dockerfile (multi-stage) and docker-compose for app + postgres.
- GitHub Actions CI: lint, typecheck, test with Postgres service container, build smoke.
- Repository scaffolding: Biome (lint/format), Vitest with testcontainers, Drizzle ORM with migrations applied at startup.
