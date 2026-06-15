import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { openSecret } from '@/lib/crypto/secret-box';
import {
  getEffectiveEmailConfig,
  getEmailConfigForDisplay,
  migrateEnvEmailConfigOnce,
  saveEmailConfig,
} from '@/lib/email/config';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
const ORIGINAL_ENV = { ...process.env };

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE instance_email_config, users RESTART IDENTITY CASCADE`;
  // Reset SMTP_* env between tests so env-fallback assertions are deterministic.
  for (const k of [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'SMTP_SECURE',
  ]) {
    delete process.env[k];
  }
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('instance email config', () => {
  it('returns null when neither DB row nor SMTP env is configured', async () => {
    expect(await getEffectiveEmailConfig(getDb())).toBeNull();
    const display = await getEmailConfigForDisplay(getDb());
    expect(display.configured).toBe(false);
    expect(display.source).toBe('none');
  });

  it('falls back to SMTP_* env when no DB row exists (source=env)', async () => {
    process.env.SMTP_HOST = 'smtp.env.example';
    process.env.SMTP_PORT = '2525';
    process.env.SMTP_USER = 'envuser';
    process.env.SMTP_PASS = 'envpass';
    process.env.SMTP_FROM = 'from@env.example';
    const cfg = await getEffectiveEmailConfig(getDb());
    expect(cfg?.source).toBe('env');
    expect(cfg?.host).toBe('smtp.env.example');
    expect(cfg?.port).toBe(2525);
    expect(cfg?.from).toBe('from@env.example');
  });

  it('save then read-back: DB row wins, password decrypts, display masks it', async () => {
    await saveEmailConfig(
      getDb(),
      {
        host: 'smtp.db.example',
        port: 587,
        tlsMode: 'starttls',
        username: 'dbuser',
        password: 'super-secret-pw',
        fromAddress: 'noreply@db.example',
        replyTo: null,
      },
      null,
    );

    const cfg = await getEffectiveEmailConfig(getDb());
    expect(cfg?.source).toBe('db');
    expect(cfg?.host).toBe('smtp.db.example');
    expect(cfg?.pass).toBe('super-secret-pw');

    // The stored column is an encrypted envelope, never the plaintext.
    const [row] = await getDb().select().from(schema.instanceEmailConfig);
    expect(row?.passwordEncrypted).not.toBeNull();
    expect(row?.passwordEncrypted?.toString('utf8')).not.toContain('super-secret-pw');
    expect(openSecret(row?.passwordEncrypted as Buffer, process.env.AUTH_SECRET as string)).toBe(
      'super-secret-pw',
    );

    const display = await getEmailConfigForDisplay(getDb());
    expect(display.passwordSet).toBe(true);
    expect(display.source).toBe('db');
    expect(JSON.stringify(display)).not.toContain('super-secret-pw');
  });

  it('password is write-once: omitting it on update keeps the stored password', async () => {
    await saveEmailConfig(
      getDb(),
      {
        host: 'h',
        port: 587,
        tlsMode: 'starttls',
        username: 'u',
        password: 'first-pw',
        fromAddress: 'f@x.test',
        replyTo: null,
      },
      null,
    );
    // Update without supplying password.
    await saveEmailConfig(
      getDb(),
      {
        host: 'h2',
        port: 465,
        tlsMode: 'tls',
        username: 'u',
        fromAddress: 'f@x.test',
        replyTo: null,
      },
      null,
    );
    const cfg = await getEffectiveEmailConfig(getDb());
    expect(cfg?.host).toBe('h2');
    expect(cfg?.tlsMode).toBe('tls');
    expect(cfg?.pass).toBe('first-pw');
  });

  it('migrateEnvEmailConfigOnce inserts once, no-ops when a row exists or no env', async () => {
    // No env → no-op.
    expect(await migrateEnvEmailConfigOnce(getDb())).toBe(false);

    process.env.SMTP_HOST = 'smtp.migrate.example';
    process.env.SMTP_USER = 'migrateuser';
    process.env.SMTP_PASS = 'migratepw';
    expect(await migrateEnvEmailConfigOnce(getDb())).toBe(true);

    const cfg = await getEffectiveEmailConfig(getDb());
    expect(cfg?.source).toBe('db');
    expect(cfg?.host).toBe('smtp.migrate.example');
    expect(cfg?.pass).toBe('migratepw');

    // Idempotent: a second call is a no-op.
    expect(await migrateEnvEmailConfigOnce(getDb())).toBe(false);
  });
});
