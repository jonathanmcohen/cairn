# Changelog

All notable changes to Cairn will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## [Unreleased]

## [0.6.0] - Unreleased

> Large consolidated release closing Notion-parity gaps across content/databases, sharing/collaboration, and mobile/accessibility. Migrations `0013`–`0019`. Built area-by-area (plans P1–P23); entries below are grouped by plan.

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
