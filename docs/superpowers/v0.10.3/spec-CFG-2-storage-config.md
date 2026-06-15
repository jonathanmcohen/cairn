# CFG-2 — Instance object-storage (S3) configuration UI

**Goal** — move S3-compatible object-storage config out of env-only into a
DB-backed Settings page. **Instance-global** (one config for the whole
instance, admin-gated). DB overrides `S3_*` / `FILE_BACKEND` env; existing env
migrates into the row on first boot. The secret key is write-once / never
re-displayed, encrypted at rest. A "Test connection" action does a real
PutObject + DeleteObject and surfaces the S3 result verbatim. Each consumer
(file uploads, workspace backups, SIEM s3 archive) opts in via a toggle,
default OFF until a successful test.

Scope decision (mirrors CFG-1): **instance-global**, reuse the established
`secret-box` (AES-256-GCM + HKDF from `AUTH_SECRET`) for the secret key,
migration **0081**. The new page lives at `/settings/admin/object-storage`
(nav id `admin-object-storage`, operations group) — deliberately distinct from
the existing `/settings/admin/storage` workspace storage-QUOTA page, which is
unrelated.

---

## Data model

New table `instance_storage_config` (migration `0081`) — single row, keyed
`id = 'singleton'`:

| column | type | notes |
|---|---|---|
| `id` | text PK default `'singleton'` | enforces one row |
| `provider` | text NOT NULL default `'s3'` | `s3` / `r2` / `minio` / `b2` — informational |
| `endpoint` | text NOT NULL | S3 endpoint URL |
| `region` | text NOT NULL default `'us-east-1'` | |
| `bucket` | text NOT NULL | |
| `access_key` | text NULL | |
| `secret_key_encrypted` | bytea NULL | `sealSecret(key, AUTH_SECRET)`; null = no secret |
| `path_prefix` | text NULL | optional key prefix applied to every object |
| `public_bucket` | boolean NOT NULL default false | informational flag |
| `uploads_enabled` | boolean NOT NULL default false | consumer opt-in |
| `backups_enabled` | boolean NOT NULL default false | consumer opt-in |
| `siem_enabled` | boolean NOT NULL default false | consumer opt-in |
| `updated_at` | timestamptz NOT NULL default now() | |
| `updated_by` | uuid NULL → users.id on delete set null | actor |

`db:generate` is BROKEN (snapshot collision 0063/0064) — the SQL was
hand-written and the journal entry (idx 81) appended by hand, exactly like
0080. `export * from './instance-storage-config'` added to
`src/db/schema/index.ts`.

## Library — `src/lib/files/storage-config.ts`

- `STORAGE_PROVIDERS = ['s3','r2','minio','b2']`, `type StorageProvider`.
- `STORAGE_CONSUMERS = ['uploads','backups','siem']`, `type StorageConsumer`.
- `getEffectiveStorageConfig(db): Promise<EffectiveStorageConfig | null>` — DB
  row if present (decrypt secret), else env `S3_*` (only when
  `FILE_BACKEND==='s3'` AND all of `S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY`
  present), else `null`. Carries `source: 'db' | 'env'`. Reads `process.env`
  DIRECTLY (env() cache gotcha).
- `getStorageConfigForDisplay(db): Promise<StorageConfigDisplay>` — masked:
  never returns the secret key, exposes `secretKeySet: boolean`, `source`, all
  non-secret fields, and the three opt-in booleans.
- `saveStorageConfig(db, input, actorUserId)` — upsert singleton. Secret key
  write-once: `secretKey` `undefined` = keep existing, non-empty string =
  encrypt + replace, `''`/`null` = clear. **Opt-in gate enforced here**: any
  consumer toggle may only be stored TRUE when the post-save row has a secret
  key (including a secret set in the same save) — else throws
  `StorageOptInError`. Clearing the secret forces every consumer OFF.
- `setConsumerOptIn(db, consumer, enabled)` — flip one toggle; enabling is
  gated on a usable stored config (row + secret), throws `StorageOptInError`
  otherwise; disabling always succeeds.
- `migrateEnvStorageConfigOnce(db): Promise<boolean>` — inserts a row from env
  iff no row exists AND `FILE_BACKEND=s3` + `S3_*` present. Idempotent. Seeds
  `uploads_enabled=true` (env-only deploys already served uploads from S3);
  backups/siem stay OFF. Called at startup from `instrumentation-node.ts`.
- `testStorageConnection(db): Promise<{ok:true} | {ok:false; error:string}>` —
  builds an `S3Storage` from effective config, `put`s a fixed tiny object
  (`${path_prefix}__cairn_conn_test`) then `delete`s it; returns the verbatim
  S3 error on failure, `{ok:false, error:'not_configured'}` when storage is off
  / no credentials.
- `getStorageFor(db, consumer): Promise<FileStorage | null>` — returns an
  `S3Storage` (transparently `path_prefix`-prefixed via `PrefixedStorage`) when
  that consumer is opted in AND config present. For `uploads`, falls back to
  `LocalDiskStorage` (uploads NEVER break). For `backups`/`siem`, returns
  `null` so the caller keeps its existing env/local behaviour.

**Gate choice (documented):** the simplest enforceable server rule — a consumer
toggle may only flip TRUE when a config row with a secret key exists. The UI
disables the toggles until a secret is saved; the route + library reject the
mutation otherwise. "After a successful test" is enforced in the UI flow (the
admin runs Test connection before enabling); the server backstop is the
config+secret existence check.

## API

- `GET /api/admin/object-storage-config` — `requireRole('admin')` → display config.
- `PUT /api/admin/object-storage-config` — zod-validate body, `saveStorageConfig`,
  audit `config.storage_updated` (targetType `instance_config`, **NO targetId** —
  audit_log.target_id is uuid, the singleton has no uuid identity). Secret
  write-once; opt-in gate → `StorageOptInError` mapped to `400 optin_requires_config`.
- `POST /api/admin/object-storage-config/test` — `testStorageConnection`; returns
  `{ok}` + error; `400 not_configured` when off.

## UI

- `src/app/(app)/settings/admin/object-storage/page.tsx` — server, admin-gated,
  breadcrumb + `<StorageConfigForm initial={…} />`.
- `src/components/settings/storage-config-form.tsx` — client form: provider
  (themed `<Select>`, NEVER raw `<select>`), endpoint, region, bucket, access
  key, secret key (password input, placeholder shows "saved" when
  `secretKeySet`), path prefix, public-bucket checkbox, three consumer opt-in
  checkboxes (disabled with a hint until a secret is saved/typed), Save +
  Test-connection buttons with status. `data-testid` on every field + button.
- Nav: `settings/admin/object-storage` under the **operations** group
  (`sidebar.tsx`), id `admin-object-storage`.
- `instrumentation-node.ts` calls `migrateEnvStorageConfigOnce` at startup,
  next to the CFG-1 email migrate-in.

## Consumer wiring

- Legacy sync `getStorage()` kept working (back-compat; existing callers/tests
  unchanged).
- Upload route (`src/app/api/upload/route.ts`) + file-download route
  (`src/app/api/files/[fileId]/route.ts`) now prefer
  `await getStorageFor(getDb(),'uploads')` (falls back to local). Behaviour is
  identical when no DB config + uploads opt-in off (verified by the existing
  `tests/api/upload.test.ts`, `files-get.test.ts`, `comments-file-routes.test.ts`).
- **Deferred:** workspace-archive (`src/lib/export/workspace-archive.ts`),
  trash purge, import/run, static-site export, CLI, and the SIEM s3-archive
  (`src/lib/siem/targets/s3-archive.ts`) still use their current env/local
  paths. They are left untouched to avoid breaking their suites; the opt-in
  flags (`backups_enabled`, `siem_enabled`) and `getStorageFor('backups'|'siem')`
  are exposed and ready, but the full rewire is out of scope here. Correctness
  over completeness.

## i18n

`settings.nav.admin.objectStorage` + `storageConfig.*` (client form) in
`messages/{en,es,ar}.json`. New server-chrome strings (page h1/description) →
`i18n-audit.baseline.json` (two findings hand-spliced, indent 2, trailing
newline).

## Failure modes verified (spec tests)

- env present + `FILE_BACKEND=s3`, no DB row → effective config from env
  (`source:'env'`); no fallback when `FILE_BACKEND≠s3`.
- save then read-back → secret never returned; `secretKeySet:true`; stored
  column is an encrypted envelope (`openSecret` round-trips, plaintext absent).
- secret write-once → omitting it on update keeps the stored key.
- `migrateEnvStorageConfigOnce` inserts once, no-ops when a row exists / no env.
- opt-in gate → enabling a consumer without a stored config + secret rejected
  (`StorageOptInError` / `400 optin_requires_config`).
- `getStorageFor('uploads')` returns LocalDiskStorage when uploads off;
  `getStorageFor('backups'|'siem')` returns null when not opted in.
- `testStorageConnection` returns `not_configured` when off.
- non-admin → 403 on GET/PUT/test; unauth → 401.

## Test files

- `tests/lib/files/storage-config.test.ts` (testcontainers Postgres).
- `tests/api/admin-object-storage-config.test.ts` (route, auth-mocked).
- `tests/components/storage-config-form.test.tsx` (jsdom + `renderWithI18n`).

Live-S3 happy path is exercisable via the MinIO testcontainer helper in
`tests/lib/files/s3-storage.test.ts`; the unit tests here cover the config
logic + `not_configured` path only (no live S3 dependency).

## data-testids (for the e2e / screenshot step)

Form: `storage-config-form`, `storage-config-source-env`,
`storage-config-provider`, `storage-config-endpoint`, `storage-config-region`,
`storage-config-bucket`, `storage-config-access-key`,
`storage-config-secret-key`, `storage-config-path-prefix`,
`storage-config-public-bucket`, `storage-config-optin-hint`,
`storage-config-consumer-uploads`, `storage-config-consumer-backups`,
`storage-config-consumer-siem`, `storage-config-status`, `storage-config-save`,
`storage-config-test`. Nav entry id: `admin-object-storage`.

## Gate

Spec path (this file) · GREEN-on-branch (typecheck clean, biome 0 errors,
i18n:check no new findings, new test files green). Branch
`release/v0.10.3-item-CFG-2-storage-config` → PR → squash into `release/v0.10.3`.
