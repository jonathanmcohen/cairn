import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { openSecret } from '@/lib/crypto/secret-box';
import { LocalDiskStorage } from '@/lib/files/storage';
import {
  getEffectiveStorageConfig,
  getStorageConfigForDisplay,
  getStorageFor,
  migrateEnvStorageConfigOnce,
  StorageOptInError,
  saveStorageConfig,
  setConsumerOptIn,
  testStorageConnection,
} from '@/lib/files/storage-config';
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
  await sql`TRUNCATE instance_storage_config, users RESTART IDENTITY CASCADE`;
  // Reset S3_* / FILE_BACKEND env between tests so env-fallback is deterministic.
  for (const k of [
    'S3_ENDPOINT',
    'S3_BUCKET',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_REGION',
    'FILE_BACKEND',
  ]) {
    delete process.env[k];
  }
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const VALID = {
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

describe('instance storage config', () => {
  it('returns null when neither DB row nor S3 env is configured', async () => {
    expect(await getEffectiveStorageConfig(getDb())).toBeNull();
    const display = await getStorageConfigForDisplay(getDb());
    expect(display.configured).toBe(false);
    expect(display.source).toBe('none');
  });

  it('falls back to S3_* env when FILE_BACKEND=s3 and no DB row (source=env)', async () => {
    process.env.FILE_BACKEND = 's3';
    process.env.S3_ENDPOINT = 'https://s3.env.example';
    process.env.S3_BUCKET = 'cairn-env';
    process.env.S3_ACCESS_KEY = 'AKIAENV';
    process.env.S3_SECRET_KEY = 'envsecret';
    process.env.S3_REGION = 'eu-west-1';
    const cfg = await getEffectiveStorageConfig(getDb());
    expect(cfg?.source).toBe('env');
    expect(cfg?.endpoint).toBe('https://s3.env.example');
    expect(cfg?.bucket).toBe('cairn-env');
    expect(cfg?.region).toBe('eu-west-1');
    expect(cfg?.secretKey).toBe('envsecret');
  });

  it('does NOT fall back to env when FILE_BACKEND is not s3', async () => {
    process.env.FILE_BACKEND = 'local';
    process.env.S3_ENDPOINT = 'https://s3.env.example';
    process.env.S3_BUCKET = 'cairn-env';
    process.env.S3_ACCESS_KEY = 'AKIAENV';
    process.env.S3_SECRET_KEY = 'envsecret';
    expect(await getEffectiveStorageConfig(getDb())).toBeNull();
  });

  it('save then read-back: DB row wins, secret decrypts, display masks it, column is encrypted', async () => {
    await saveStorageConfig(getDb(), VALID, null);

    const cfg = await getEffectiveStorageConfig(getDb());
    expect(cfg?.source).toBe('db');
    expect(cfg?.endpoint).toBe('https://s3.db.example');
    expect(cfg?.secretKey).toBe('super-secret-key');

    // The stored column is an encrypted envelope, never the plaintext.
    const [row] = await getDb().select().from(schema.instanceStorageConfig);
    expect(row?.secretKeyEncrypted).not.toBeNull();
    expect(row?.secretKeyEncrypted?.toString('utf8')).not.toContain('super-secret-key');
    expect(openSecret(row?.secretKeyEncrypted as Buffer, process.env.AUTH_SECRET as string)).toBe(
      'super-secret-key',
    );

    const display = await getStorageConfigForDisplay(getDb());
    expect(display.secretKeySet).toBe(true);
    expect(display.source).toBe('db');
    expect(JSON.stringify(display)).not.toContain('super-secret-key');
  });

  it('secret key is write-once: omitting it on update keeps the stored key', async () => {
    await saveStorageConfig(getDb(), VALID, null);
    // Update without supplying the secret key.
    const { secretKey: _omit, ...withoutSecret } = VALID;
    await saveStorageConfig(getDb(), { ...withoutSecret, bucket: 'cairn-db-2' }, null);

    const cfg = await getEffectiveStorageConfig(getDb());
    expect(cfg?.bucket).toBe('cairn-db-2');
    expect(cfg?.secretKey).toBe('super-secret-key');
  });

  it('migrateEnvStorageConfigOnce inserts once, no-ops when a row exists or no env', async () => {
    // No env → no-op.
    expect(await migrateEnvStorageConfigOnce(getDb())).toBe(false);

    process.env.FILE_BACKEND = 's3';
    process.env.S3_ENDPOINT = 'https://s3.migrate.example';
    process.env.S3_BUCKET = 'cairn-migrate';
    process.env.S3_ACCESS_KEY = 'AKIAMIG';
    process.env.S3_SECRET_KEY = 'migratesecret';
    expect(await migrateEnvStorageConfigOnce(getDb())).toBe(true);

    const cfg = await getEffectiveStorageConfig(getDb());
    expect(cfg?.source).toBe('db');
    expect(cfg?.endpoint).toBe('https://s3.migrate.example');
    expect(cfg?.secretKey).toBe('migratesecret');
    expect(cfg?.uploadsEnabled).toBe(true);

    // Idempotent: a second call is a no-op.
    expect(await migrateEnvStorageConfigOnce(getDb())).toBe(false);
  });

  it('consumer opt-in gate: cannot enable a consumer without a stored config', async () => {
    // No row at all → enabling is rejected.
    await expect(setConsumerOptIn(getDb(), 'uploads', true)).rejects.toBeInstanceOf(
      StorageOptInError,
    );

    // A row WITHOUT a secret key → still rejected.
    const { secretKey: _omit, ...noSecret } = VALID;
    await saveStorageConfig(getDb(), { ...noSecret, secretKey: null }, null);
    await expect(setConsumerOptIn(getDb(), 'uploads', true)).rejects.toBeInstanceOf(
      StorageOptInError,
    );
  });

  it('saveStorageConfig rejects opting in a consumer when no secret will be stored', async () => {
    const { secretKey: _omit, ...noSecret } = VALID;
    await expect(
      saveStorageConfig(getDb(), { ...noSecret, secretKey: null, uploadsEnabled: true }, null),
    ).rejects.toBeInstanceOf(StorageOptInError);
  });

  it('consumer opt-in works once a config with a secret key exists', async () => {
    await saveStorageConfig(getDb(), VALID, null);
    await setConsumerOptIn(getDb(), 'backups', true);
    const cfg = await getEffectiveStorageConfig(getDb());
    expect(cfg?.backupsEnabled).toBe(true);
    expect(cfg?.uploadsEnabled).toBe(false);
  });

  it('getStorageFor("uploads") returns LocalDiskStorage when uploads are off', async () => {
    await saveStorageConfig(getDb(), VALID, null); // uploads opt-in stays false
    const storage = await getStorageFor(getDb(), 'uploads');
    expect(storage).toBeInstanceOf(LocalDiskStorage);
  });

  it('getStorageFor("backups"/"siem") returns null when not opted in', async () => {
    await saveStorageConfig(getDb(), VALID, null);
    expect(await getStorageFor(getDb(), 'backups')).toBeNull();
    expect(await getStorageFor(getDb(), 'siem')).toBeNull();
  });

  it('testStorageConnection returns not_configured when storage is off', async () => {
    const r = await testStorageConnection(getDb());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not_configured');
  });
});
