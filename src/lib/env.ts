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
