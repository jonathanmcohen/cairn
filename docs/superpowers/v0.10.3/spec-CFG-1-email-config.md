# CFG-1 — Instance email (SMTP) configuration UI

**Goal** — move SMTP config out of env-only into a DB-backed Settings page.
**Instance-global** (one config for the whole instance, admin-gated). DB
overrides env; existing `SMTP_*` env migrates into the row on first boot. The
password is write-once / never re-displayed, encrypted at rest. A "Send test
email" action surfaces the SMTP result verbatim. The Notifications "email
disabled" banner links here.

Scope decision (locked with user): **instance-global**, reuse the established
`secret-box` (AES-256-GCM + HKDF from `AUTH_SECRET`) for the password,
migration **0080**.

---

## Data model

New table `instance_email_config` — single row, keyed `id = 'singleton'`:

| column | type | notes |
|---|---|---|
| `id` | text PK default `'singleton'` | enforces one row |
| `host` | text NOT NULL | |
| `port` | integer NOT NULL default 587 | |
| `tls_mode` | text NOT NULL default `'starttls'` | `starttls` / `tls` / `none` |
| `username` | text NULL | SMTP auth user (null = no auth) |
| `password_encrypted` | bytea NULL | `sealSecret(pw, AUTH_SECRET)`; null = no password |
| `from_address` | text NOT NULL | |
| `reply_to` | text NULL | |
| `updated_at` | timestamptz NOT NULL default now() | |
| `updated_by` | uuid NULL → users.id on delete set null | actor |

## Library — `src/lib/email/config.ts`

- `TLS_MODES = ['starttls','tls','none']`, `type TlsMode`.
- `getEffectiveEmailConfig(db): Promise<EffectiveEmailConfig | null>` — DB row
  if present (decrypt password), else env `SMTP_*` (tlsMode derived from
  `SMTP_SECURE`), else `null`. Carries `source: 'db' | 'env'`.
- `getEmailConfigForDisplay(db): Promise<EmailConfigDisplay>` — masked: never
  returns the password, exposes `passwordSet: boolean` + `source: 'db'|'env'|'none'`.
- `saveEmailConfig(db, input, actorUserId)` — upsert singleton. Password
  write-once: `password` `undefined` = keep existing, non-empty string = encrypt
  + replace, `null` = clear. Invalidates the cached transport.
- `migrateEnvEmailConfigOnce(db): Promise<boolean>` — inserts a row from env iff
  no row exists AND `SMTP_HOST` is set. Idempotent. Called at startup.
- `sendTestEmail(db, to): Promise<{ok:true} | {ok:false; error:string}>` —
  builds the transport from effective config and sends; returns the SMTP
  error string verbatim on failure, `{ok:false, error:'not_configured'}` when
  email is off.

## Transport — `src/lib/email/transport.ts` (refactor)

`getTransport`, `emailEnabled`, `fromAddress` become **async + db-aware**
(read effective config). `tls_mode` maps to nodemailer: `tls` → `secure:true`,
`starttls` → `requireTLS:true`, `none` → `ignoreTLS:true`. Transport cached by
config fingerprint; `invalidateTransport()` on save. Call sites updated to
`await …(db)`: `notify-email.ts`, `digest.ts`, `notify-due-cli.ts`,
`flashcards/page.tsx`, `notifications/prefs/route.ts`.

## API

- `GET /api/admin/email-config` — `requireRole('admin')` → display config.
- `PUT /api/admin/email-config` — validate body, `saveEmailConfig`, audit
  `config.email_updated` (target `instance_config`). Password write-once.
- `POST /api/admin/email-config/test` — `sendTestEmail` to the caller's own
  email; returns `{ok}` + error.

## UI

- `src/app/(app)/settings/admin/email/page.tsx` — server, admin-gated,
  breadcrumb + `<EmailConfigForm initial={…} />`.
- `src/components/settings/email-config-form.tsx` — client form: host, port,
  TLS mode, username, password (placeholder shows "set" when `passwordSet`),
  from, reply-to; Save + Send-test buttons with success/error feedback.
- Nav: `settings/admin/email` under the **operations** group (`sidebar.tsx`).
- `notification-prefs.tsx` SMTP banner links to `/settings/admin/email`.
- `instrumentation-node.ts` calls `migrateEnvEmailConfigOnce` at startup.

## i18n

`settings.nav.admin.email` + `emailConfig.*` (client form) in
`messages/{en,es,ar}.json`. New server-chrome strings (page h1/description) →
`i18n-audit.baseline.json`.

## Failure modes verified (spec tests)

- env present, no DB row → `getEffectiveEmailConfig` returns env (`source:'env'`).
- save then read-back → password never returned; `passwordSet:true`.
- test-send failure → SMTP error surfaced verbatim; config not marked healthy.
- non-admin → 403 on GET/PUT/test.
- `migrateEnvEmailConfigOnce` inserts once, no-ops when a row exists / no env.

## Gate

Spec path (this file) · RED-on-main · GREEN-on-branch · live-deploy screenshot.
Branch `release/v0.10.3-item-CFG-1-email-config` → PR → squash into `release/v0.10.3`.
