import { z } from 'zod';

const Schema = z.object({
  DATABASE_URL: z.url().or(z.string().regex(/^postgres(ql)?:\/\//)),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars'),
  NEXTAUTH_URL: z.url(),
  CAIRN_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
  CAIRN_TRASH_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
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
  CAIRN_ENABLE_E2E_ENCRYPTION: z.coerce.boolean().default(false),
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
