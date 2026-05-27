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
