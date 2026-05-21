import { z } from 'zod';

const Schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .or(z.string().regex(/^postgres(ql)?:\/\//)),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars'),
  NEXTAUTH_URL: z.string().url(),
  CAIRN_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
  CAIRN_TRASH_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  CAIRN_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
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
