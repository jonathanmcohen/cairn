import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { saveEmailConfig } from '@/lib/email/config';
import { saveStorageConfig } from '@/lib/files/storage-config';
import { getSystemHealth, type SystemHealthPill } from '@/lib/health/system-health';
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
  await sql`TRUNCATE instance_email_config, instance_storage_config, cron_schedules, users RESTART IDENTITY CASCADE`;
  // Deterministic env baseline: nothing configured, scheduler/collab/e2e off.
  for (const k of [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'SMTP_SECURE',
    'S3_ENDPOINT',
    'S3_BUCKET',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_REGION',
    'FILE_BACKEND',
    'CAIRN_SCHEDULER_ENABLED',
    'CAIRN_COLLAB_INTERNAL_URL',
  ]) {
    delete process.env[k];
  }
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function pill(pills: SystemHealthPill[], id: SystemHealthPill['id']): SystemHealthPill {
  const p = pills.find((x) => x.id === id);
  if (!p) throw new Error(`no pill with id ${id}`);
  return p;
}

const VALID_STORAGE = {
  provider: 's3' as const,
  endpoint: 'https://s3.db.example',
  region: 'us-east-1',
  bucket: 'cairn-db',
  accessKey: 'AKIADB',
  secretKey: 'super-secret-key',
  pathPrefix: null,
  publicBucket: false,
  uploadsEnabled: false,
  backupsEnabled: false,
  siemEnabled: false,
};

describe('getSystemHealth', () => {
  it('with nothing configured: email off, storage off, e2e off, scheduler paused, collab degraded', async () => {
    const { pills } = await getSystemHealth(getDb());

    expect(pill(pills, 'email').status).toBe('off');
    expect(pill(pills, 'email').statusKey).toBe('systemHealth.status.notConfigured');
    expect(pill(pills, 'email').fixHref).toBe('/settings/admin/email');

    expect(pill(pills, 'storage').status).toBe('off');
    expect(pill(pills, 'storage').fixHref).toBe('/settings/admin/object-storage');

    // Scheduler is "warn" (paused) — it's expected to be on, env flag unset.
    expect(pill(pills, 'scheduler').status).toBe('warn');
    expect(pill(pills, 'scheduler').statusKey).toBe('systemHealth.status.paused');
    expect(pill(pills, 'scheduler').detail).toEqual({ kind: 'scheduleCount', enabledCount: 0 });

    // Collab bridge unconfigured → degraded, Fix points at external docs.
    expect(pill(pills, 'collab').status).toBe('warn');
    expect(pill(pills, 'collab').statusKey).toBe('systemHealth.status.degraded');
    expect(pill(pills, 'collab').fixExternal).toBe(true);
    expect(String(pill(pills, 'collab').fixHref)).toContain('operations.md');

    // E2E flag off (test env default) → off, no Fix link (sidebar gating).
    expect(pill(pills, 'e2e').status).toBe('off');
    expect(pill(pills, 'e2e').fixHref).toBeUndefined();
  });

  it('after seeding an instance_email_config row → email configured (source=db)', async () => {
    await saveEmailConfig(
      getDb(),
      {
        host: 'smtp.example.com',
        port: 587,
        tlsMode: 'starttls',
        username: 'cairn',
        password: 'hunter2-the-password',
        fromAddress: 'cairn@example.com',
        replyTo: null,
      },
      null,
    );

    const { pills } = await getSystemHealth(getDb());
    expect(pill(pills, 'email').status).toBe('ok');
    expect(pill(pills, 'email').statusKey).toBe('systemHealth.status.configured');
    expect(pill(pills, 'email').detail).toEqual({ kind: 'source', source: 'db' });
  });

  it('storage configured surfaces opted-in consumers', async () => {
    await saveStorageConfig(getDb(), { ...VALID_STORAGE, backupsEnabled: true }, null);
    const { pills } = await getSystemHealth(getDb());
    const p = pill(pills, 'storage');
    expect(p.status).toBe('ok');
    expect(p.statusKey).toBe('systemHealth.status.configured');
    expect(p.detail).toEqual({ kind: 'consumers', consumers: ['backups'] });
  });

  it('scheduler enabled when CAIRN_SCHEDULER_ENABLED=1', async () => {
    process.env.CAIRN_SCHEDULER_ENABLED = '1';
    const { pills } = await getSystemHealth(getDb());
    expect(pill(pills, 'scheduler').status).toBe('ok');
    expect(pill(pills, 'scheduler').statusKey).toBe('systemHealth.status.enabled');
  });

  it('collab bridge live when CAIRN_COLLAB_INTERNAL_URL + AUTH_SECRET are set', async () => {
    process.env.CAIRN_COLLAB_INTERNAL_URL = 'http://cairn-collab:1234';
    // AUTH_SECRET is set globally for the test suite.
    const { pills } = await getSystemHealth(getDb());
    expect(pill(pills, 'collab').status).toBe('ok');
    expect(pill(pills, 'collab').statusKey).toBe('systemHealth.status.live');
    expect(pill(pills, 'collab').fixHref).toBeUndefined();
  });

  it('NEVER leaks a secret: the serialized summary contains no password/secret_key', async () => {
    // Seed both email + storage with secrets.
    await saveEmailConfig(
      getDb(),
      {
        host: 'smtp.example.com',
        port: 587,
        tlsMode: 'starttls',
        username: 'cairn',
        password: 'hunter2-the-password',
        fromAddress: 'cairn@example.com',
        replyTo: null,
      },
      null,
    );
    await saveStorageConfig(getDb(), VALID_STORAGE, null);

    const summary = await getSystemHealth(getDb());
    const json = JSON.stringify(summary);
    expect(json).not.toContain('hunter2-the-password');
    expect(json).not.toContain('super-secret-key');
    expect(json.toLowerCase()).not.toContain('password');
    expect(json.toLowerCase()).not.toContain('secretkey');
    expect(json.toLowerCase()).not.toContain('secret_key');
  });
});
