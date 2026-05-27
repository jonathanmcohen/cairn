import { z } from 'zod';

const Schema = z.object({
  DATABASE_URL: z.url().or(z.string().regex(/^postgres(ql)?:\/\//)),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars'),
  NEXTAUTH_URL: z.url(),
  CAIRN_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
  // 0 disables auto-purge (matches workspaces.trash_retention_days=0 semantics).
  CAIRN_TRASH_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(30),
  CAIRN_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  COLLAB_URL: z.string().default('ws://localhost:1234'),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  FILE_BACKEND: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CAIRN_DIGEST_INTERVAL: z.coerce.number().int().nonnegative().default(0),
  CAIRN_METRICS_TOKEN: z
    .string()
    .min(16, 'CAIRN_METRICS_TOKEN must be at least 16 chars')
    .optional(),
  CAIRN_EMBEDDING_URL: z.url().optional(),
  CAIRN_EMBEDDING_MODEL: z.string().optional(),
  CAIRN_EMBEDDING_API_KEY: z.string().optional(),
  CAIRN_BACKFILL_EMBEDDINGS: z.coerce.boolean().optional(),
  CAIRN_GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  CAIRN_GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  CAIRN_CONNECTOR_CSV_PATH: z.string().optional(),
  NEXT_PUBLIC_CAIRN_OFFLINE_DOC_LIMIT_MB: z.coerce.number().int().positive().default(256),
  // v0.8.0 G7 P20 — operator opt-in: when set, the build inlines this key so
  // the <CoverPicker> can render the Unsplash tab. Leaving it unset hides the
  // tab. The key is intentionally exposed in the browser bundle (it's an
  // Unsplash "Client-ID" — public by design); the SERVER-side equivalent stays
  // in FORBIDDEN_KEYS so no Cairn route ever proxies it.
  NEXT_PUBLIC_CAIRN_UNSPLASH_ACCESS_KEY: z.string().optional(),
  // v0.9.0 G1 P5 — server-side deploy guard for E2E encryption (G1 P5-P7).
  // When false (default), admin UIs (P6/P7) hide the encryption toggle. Once a
  // workspace has flipped on encryption, page-level crypto operations continue
  // to function regardless — this gates only the opt-in surface for fresh
  // self-host adopters.
  CAIRN_ENABLE_E2E_ENCRYPTION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // v0.9.0 G1 P6 — public mirror of CAIRN_ENABLE_E2E_ENCRYPTION, inlined into
  // the client bundle so the page-action menu can conditionally render the
  // "Encrypt page" item without a round-trip. The SERVER-side value above
  // stays the source of truth; this is purely a build-time UI toggle.
  NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // v0.9.0 G1 P8 — WebAuthn relying-party identifiers.
  // CAIRN_RP_ID is the REGISTRABLE DOMAIN (e.g. "cairn.example.com"); credentials
  // bind to this value forever, so changing it after enrollment invalidates EVERY
  // passkey. CAIRN_RP_ORIGIN is the full origin (scheme + host + port). They are
  // optional at parse time so dev/tooling builds without WebAuthn still validate;
  // the WebAuthn ceremonies enforce presence at call time (`requireRpEnv`).
  CAIRN_RP_ID: z.string().min(1).optional(),
  CAIRN_RP_NAME: z.string().default('Cairn'),
  CAIRN_RP_ORIGIN: z.url().optional(),
  // v0.9.0 G3 P15 — optional self-hosted PlantUML render server. When unset,
  // both the server-side renderer (SSR shared pages) and the client editor
  // fall back to `https://www.plantuml.com/plantuml`. The PUBLIC variant is
  // inlined into the browser bundle so the editor's <img> view can hit the
  // operator's server directly; the SERVER variant is for future SSR hooks.
  // Operators self-hosting MUST set both to the same URL.
  CAIRN_PLANTUML_SERVER: z.url().optional(),
  NEXT_PUBLIC_CAIRN_PLANTUML_SERVER: z.url().optional(),
  // v0.9.0 G5 P30 — federated search peer-fanout shared secret. Server-only.
  // Empty string (default) disables cross-instance federation; the local
  // membership + admin cross-workspace scopes still work without it.
  // Operators set this to the SAME value on every Cairn instance that
  // participates in the federation mesh; per-peer rotation is achieved by
  // updating both sides simultaneously.
  CAIRN_FEDERATION_SHARED_SECRET: z.string().default(''),
  // v0.9.0 G7 P36 — chat bridge (Slack + Discord). All OPTIONAL; the bridge is
  // workspace-opt-in and never auto-engaged. Operators paste an incoming-
  // webhook URL into the admin UI; per-workspace secrets live in
  // `webhooks.platform_metadata` (jsonb). These env vars only matter if the
  // operator later wires real OAuth installs (deferred to P37).
  CAIRN_SLACK_CLIENT_ID: z.string().optional(),
  CAIRN_SLACK_CLIENT_SECRET: z.string().optional(),
  CAIRN_SLACK_SIGNING_SECRET: z.string().optional(),
  CAIRN_DISCORD_CLIENT_ID: z.string().optional(),
  CAIRN_DISCORD_CLIENT_SECRET: z.string().optional(),
  CAIRN_DISCORD_BOT_TOKEN: z.string().optional(),
  // v0.9.0 G8 P42 — release-watch daemon. Polls a GitHub-shaped releases
  // feed on a cron and notifies every owner/admin when a newer stable tag
  // ships. Auto-apply is OFF by default — the admin /settings/admin/upgrade
  // button is the only path that actually invokes `applyUpgrade`.
  //
  // CAIRN_RELEASE_FEED_URL  GitHub releases endpoint (or any JSON array of
  //                          { tag_name, html_url, draft, prerelease }).
  //                          Defaults to the upstream Cairn repo.
  // CAIRN_RELEASE_WATCH_ENABLED  When false, the cron registration is
  //                              skipped at boot — air-gapped deploys
  //                              should set this off.
  CAIRN_RELEASE_FEED_URL: z
    .url()
    .default('https://api.github.com/repos/jonathanmcohen/cairn/releases'),
  CAIRN_RELEASE_WATCH_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // v0.9.0 G8 P43 — at-rest encryption envelope for backup archives.
  // Optional. When set (≥ 8 chars), the backup CLI wraps the pg_dump output in
  // an AES-256-GCM envelope (Argon2id-derived key, random per-archive nonce,
  // GCM auth tag). When unset, behaviour is identical to v0.5 P5 (raw dump).
  // The passphrase is the ONLY thing that can decrypt archives — there is no
  // recovery path if lost. The 8-char floor is a sanity check; operators
  // SHOULD use much longer values stored in a secret manager. See
  // docs/operations.md § "Encrypted backup passphrase rotation".
  CAIRN_BACKUP_ENCRYPTION_PASSPHRASE: z.string().min(8).optional(),
});

export type Env = z.infer<typeof Schema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  const result = Schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return result.data;
}

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
