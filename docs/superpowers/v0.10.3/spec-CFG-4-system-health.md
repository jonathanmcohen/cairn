# CFG-4 — System health dashboard

**Goal** — aggregate every instance-level "disabled / degraded / configured"
indicator scattered across the app into ONE admin **Settings → Admin → System
health** page, each rendered as a status pill with an optional **Fix** deep-link
to the settings page that resolves it. **Read-only** — no migrations, no
mutations, no secrets. This is the final CFG item and it ties together the three
configs just merged (CFG-1 email, CFG-2 object storage, CFG-3 scheduler) plus
the collab bridge and the E2E-encryption build flag.

Scope decision (locked with user): pure read-only aggregator over the existing
display helpers + env flags; **no** new query is invented for any indicator that
doesn't already have a cheap instance-level source (see "Search index, omitted"
below). Distinct from the existing readiness-probe page at
`/settings/admin/health` — this page is `/settings/admin/system-health`.

---

## Data model

**None.** No schema change, no new table, no migration. The summary is computed
on demand from the existing config tables (`instance_email_config`,
`instance_storage_config`, `cron_schedules`) via their established display
helpers, plus `process.env` / `env()` flags.

## Library — `src/lib/health/system-health.ts` (new)

Pure, db-injected, unit-testable, **secret-free**.

- `type SystemHealthPillId` — `'email' | 'storage' | 'scheduler' | 'collab' | 'e2e'`.
- `type SystemHealthStatus` — `'ok' | 'warn' | 'off'`.
  - `ok` — configured / enabled / live (success-green).
  - `warn` — degraded / paused but expected on (warning-amber).
  - `off` — intentionally disabled / not configured (muted).
- `type SystemHealthDetail` — secret-free structured context the panel turns
  into translated copy: `{kind:'source', source:'db'|'env'}` /
  `{kind:'consumers', consumers:string[]}` / `{kind:'scheduleCount', enabledCount:number}`.
- `type SystemHealthPill` — `{ id, status, statusKey, detail?, fixHref?, fixExternal? }`.
  `statusKey` is an i18n key (the lib stays copy-free); `fixHref` is a typed
  `Route` for internal links or an external docs URL when `fixExternal`.
- `getSystemHealth(db): Promise<SystemHealthSummary>` — builds the pill array
  from the sources below. NEVER returns a secret (no password, no secret key —
  only booleans, counts, sources, masked display views).

### Sources aggregated

| Pill | Source | `ok` / `warn` / `off` | Fix link |
|---|---|---|---|
| **email** | `getEmailConfigForDisplay(db)` (`configured`, `source`) | configured → ok ; else off | `/settings/admin/email` |
| **storage** | `getStorageConfigForDisplay(db)` (`configured`, `uploads/backups/siemEnabled`) | configured → ok ; else off ; consumers listed as detail | `/settings/admin/object-storage` |
| **scheduler** | `process.env.CAIRN_SCHEDULER_ENABLED === '1'` + enabled-row count from `listSchedules(db)` | enabled → ok ; else warn (paused) | `/settings/admin/schedules` |
| **collab** | `isCollabBridgeConfigured()` | configured → ok (live) ; else warn (degraded) | operations docs (external) when degraded, none when live |
| **e2e** | `env().NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION` | flag on → ok ; else off | `/settings/admin/encryption` **only when on** (mirrors the sidebar gating — the nav entry/page is hidden when the flag is off, so a Fix link would dead-end) |

`CAIRN_SCHEDULER_ENABLED` is read from `process.env` directly (not the cached
`env()`), matching the backups page's own check and the env-cache gotcha.

### Search index, omitted

The plan listed Search-index health as OPTIONAL/best-effort. It is **omitted**:
the only existing helper, `countPendingEmbeddings(db, workspaceId)`
(`src/lib/search/embedding-status.ts`), is **workspace-scoped** and walks every
page hashing `content_text` in Node — far too expensive for an instance-level
dashboard, and there is no cheap instance-wide backlog query. Surfacing it would
mean inventing one, which this read-only aggregator deliberately does not do.
Documented in the lib's module doc.

## UI

- `src/app/(app)/settings/admin/system-health/page.tsx` — Server Component,
  `requireRole('admin')`, `SettingsBreadcrumb` (Admin → System health),
  plain-English `<h1>` "System health" + description (→ baseline), renders
  `<SystemHealthPanel pills={(await getSystemHealth(getDb())).pills} />`.
- `src/components/settings/system-health-panel.tsx` — client list: one `<li>`
  per pill with a label, a status badge (semantic color **and** text word + a
  lucide icon — never color-only, a11y), an optional muted detail line, and an
  optional Fix link (internal `next/link` for `Route`, external
  `<a target=_blank rel=noreferrer>` for the docs URL).
- data-testids: `system-health-panel`, per-pill `system-health-pill-<id>` and
  `system-health-fix-<id>` (`<id>` ∈ `email|storage|scheduler|collab|e2e`).
- Nav: `admin-system-health` → `/settings/admin/system-health` under the
  **operations** group (`sidebar.tsx`), after Migrations. Does **not** clobber
  the existing readiness `admin-health` → `/settings/admin/health` entry.

## i18n

`settings.nav.admin.systemHealth` + the `systemHealth.*` block (pill labels,
statuses `configured/notConfigured/off/on/enabled/paused/live/degraded`, the
`source.db|env`, `detail.consumers/noConsumers/scheduleCount.{one,other}`, and
`fix`) added to `messages/{en,es,ar}.json` (flat dotted keys, literal unicode).
The page `<h1>` + description (server-component chrome, no server `t()`) are
spliced into `i18n-audit.baseline.json`.

## Tests

- `tests/lib/health/system-health.test.ts` (testcontainers): nothing configured
  → email off / storage off / e2e off / scheduler paused / collab degraded;
  after seeding `instance_email_config` → email configured (source=db); storage
  consumers surfaced; scheduler ok with `CAIRN_SCHEDULER_ENABLED=1`; collab live
  with `CAIRN_COLLAB_INTERNAL_URL`; **never leaks a secret** (serialized summary
  contains no password / secret-key string).
- `tests/components/system-health-panel.test.tsx` (jsdom, renderWithI18n): one
  pill per item; status text rendered (not color-only); Fix links route to the
  right hrefs (internal Route vs external docs `target=_blank`); Fix omitted
  when no `fixHref`; structured detail copy (consumers + plural job count).
- Page-level + e2e are covered by the P10 nav-enumeration spec (the new
  `/settings/admin/system-health` href added to its `UNCONDITIONAL_HREFS`).

## Gate

`pnpm typecheck` clean · `pnpm biome check` 0 errors · `pnpm i18n:check` no new
findings · new test files green via `pnpm vitest run` ·
`pnpm vitest run tests/components` green (no regression). Themed components only
(no raw `<select>`). Branch `release/v0.10.3-item-CFG-4-system-health` → PR →
squash into `release/v0.10.3`.
