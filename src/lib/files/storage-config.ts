import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { openSecret, sealSecret } from '@/lib/crypto/secret-box';
import { S3Storage } from './s3-storage';
import type { FileStorage } from './storage';
import { LocalDiskStorage } from './storage';

type Db = PostgresJsDatabase<typeof schema>;

// Read secrets/S3_* from process.env DIRECTLY, not the cached env(): env()
// memoizes on first call, so tests that mutate process.env (and any
// hypothetical runtime change) would otherwise see stale values. See CLAUDE.md.
function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

/** Informational provider label — every provider speaks the S3 API. */
export const STORAGE_PROVIDERS = ['s3', 'r2', 'minio', 'b2'] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

/** The three opt-in consumers gated behind a stored config + successful test. */
export const STORAGE_CONSUMERS = ['uploads', 'backups', 'siem'] as const;
export type StorageConsumer = (typeof STORAGE_CONSUMERS)[number];

const SINGLETON_ID = 'singleton';

type S3Env = {
  endpoint: string | null;
  region: string;
  bucket: string | null;
  accessKey: string | null;
  secretKey: string | null;
  backend: string;
};

function readS3Env(): S3Env {
  return {
    endpoint: process.env.S3_ENDPOINT ?? null,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? null,
    accessKey: process.env.S3_ACCESS_KEY ?? null,
    secretKey: process.env.S3_SECRET_KEY ?? null,
    backend: process.env.FILE_BACKEND ?? 'local',
  };
}

/** True iff FILE_BACKEND=s3 and the required S3_* env vars are all present. */
function envS3Configured(e: S3Env): boolean {
  return e.backend === 's3' && Boolean(e.endpoint && e.bucket && e.accessKey && e.secretKey);
}

/**
 * The effective storage config the consumers actually build a client from.
 * Carries the decrypted secret key — server-only, never serialized to the
 * client (see {@link getStorageConfigForDisplay} for the masked view).
 */
export type EffectiveStorageConfig = {
  provider: StorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string | null;
  secretKey: string | null;
  pathPrefix: string | null;
  publicBucket: boolean;
  uploadsEnabled: boolean;
  backupsEnabled: boolean;
  siemEnabled: boolean;
  source: 'db' | 'env';
};

/** Masked, client-safe view of the config — never includes the secret key. */
export type StorageConfigDisplay = {
  configured: boolean;
  source: 'db' | 'env' | 'none';
  provider: StorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  pathPrefix: string;
  publicBucket: boolean;
  secretKeySet: boolean;
  uploadsEnabled: boolean;
  backupsEnabled: boolean;
  siemEnabled: boolean;
};

export type SaveStorageConfigInput = {
  provider: StorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string | null;
  /** undefined = keep existing, non-empty string = replace, null/'' = clear. */
  secretKey?: string | null;
  pathPrefix: string | null;
  publicBucket: boolean;
  uploadsEnabled: boolean;
  backupsEnabled: boolean;
  siemEnabled: boolean;
};

function normalizeProvider(value: string): StorageProvider {
  return (STORAGE_PROVIDERS as readonly string[]).includes(value)
    ? (value as StorageProvider)
    : 's3';
}

async function readRow(db: Db): Promise<schema.InstanceStorageConfig | null> {
  const [row] = await db
    .select()
    .from(schema.instanceStorageConfig)
    .where(eq(schema.instanceStorageConfig.id, SINGLETON_ID))
    .limit(1);
  return row ?? null;
}

/** Effective config: DB row wins, else env `S3_*` (when FILE_BACKEND=s3), else null. */
export async function getEffectiveStorageConfig(db: Db): Promise<EffectiveStorageConfig | null> {
  const row = await readRow(db);
  if (row) {
    let secretKey: string | null = null;
    if (row.secretKeyEncrypted) {
      try {
        secretKey = openSecret(row.secretKeyEncrypted, authSecret());
      } catch {
        secretKey = null; // tampered / wrong key → treat as no secret
      }
    }
    return {
      provider: normalizeProvider(row.provider),
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      accessKey: row.accessKey ?? null,
      secretKey,
      pathPrefix: row.pathPrefix ?? null,
      publicBucket: row.publicBucket,
      uploadsEnabled: row.uploadsEnabled,
      backupsEnabled: row.backupsEnabled,
      siemEnabled: row.siemEnabled,
      source: 'db',
    };
  }
  const e = readS3Env();
  if (!envS3Configured(e)) return null;
  return {
    provider: 's3',
    endpoint: e.endpoint as string,
    region: e.region,
    bucket: e.bucket as string,
    accessKey: e.accessKey,
    secretKey: e.secretKey,
    pathPrefix: null,
    publicBucket: false,
    // Env-only deployments keep their pre-CFG-2 behaviour: getStorage() (the
    // legacy sync factory) already serves uploads from S3 when FILE_BACKEND=s3,
    // so we surface uploads as enabled to reflect reality. Backups/SIEM keep
    // their own env paths and are reported off here (they never read this).
    uploadsEnabled: true,
    backupsEnabled: false,
    siemEnabled: false,
    source: 'env',
  };
}

/** Masked view for the admin form. Never returns the secret key itself. */
export async function getStorageConfigForDisplay(db: Db): Promise<StorageConfigDisplay> {
  const cfg = await getEffectiveStorageConfig(db);
  if (!cfg) {
    return {
      configured: false,
      source: 'none',
      provider: 's3',
      endpoint: '',
      region: 'us-east-1',
      bucket: '',
      accessKey: '',
      pathPrefix: '',
      publicBucket: false,
      secretKeySet: false,
      uploadsEnabled: false,
      backupsEnabled: false,
      siemEnabled: false,
    };
  }
  return {
    configured: true,
    source: cfg.source,
    provider: cfg.provider,
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    accessKey: cfg.accessKey ?? '',
    pathPrefix: cfg.pathPrefix ?? '',
    publicBucket: cfg.publicBucket,
    secretKeySet: cfg.secretKey != null && cfg.secretKey !== '',
    uploadsEnabled: cfg.uploadsEnabled,
    backupsEnabled: cfg.backupsEnabled,
    siemEnabled: cfg.siemEnabled,
  };
}

export class StorageOptInError extends Error {
  constructor(
    message = 'cannot enable a consumer before a storage config with a secret key exists',
  ) {
    super(message);
    this.name = 'StorageOptInError';
  }
}

/**
 * True iff there's a stored DB row with a secret key set. This is the server
 * gate for enabling a consumer opt-in: the UI blocks the toggles before a
 * successful Test connection, and this is the simplest enforceable backstop
 * (no config / no secret ⇒ a consumer toggle may not flip TRUE).
 */
async function hasUsableStoredConfig(db: Db): Promise<boolean> {
  const row = await readRow(db);
  return Boolean(row && row.secretKeyEncrypted);
}

/**
 * Upsert the instance storage config singleton. Secret key is write-once:
 * `secretKey` undefined keeps the stored value, a non-empty string replaces it
 * (encrypted), an explicit empty string / null clears it.
 *
 * Consumer opt-ins (uploads/backups/siem) are gated: a toggle may only be set
 * TRUE when a usable stored config exists (a row with a secret key) — including
 * the secret key being set in THIS same save. Enabling any consumer without a
 * usable secret throws {@link StorageOptInError}. Clearing the secret here also
 * forces every consumer back OFF (you can't keep serving from a config whose
 * secret was just wiped).
 */
export async function saveStorageConfig(
  db: Db,
  input: SaveStorageConfigInput,
  actorUserId: string | null,
): Promise<void> {
  const existing = await readRow(db);

  let secretKeyEncrypted: Buffer | null | undefined;
  if (input.secretKey === undefined) {
    secretKeyEncrypted = existing?.secretKeyEncrypted ?? null;
  } else if (input.secretKey === null || input.secretKey === '') {
    secretKeyEncrypted = null;
  } else {
    secretKeyEncrypted = sealSecret(input.secretKey, authSecret());
  }

  const hasSecret = secretKeyEncrypted != null;

  // Gate: a consumer may only be enabled when the post-save row has a secret.
  // If no secret will be stored, every requested opt-in is rejected.
  const wantsAnyOptIn = input.uploadsEnabled || input.backupsEnabled || input.siemEnabled;
  if (wantsAnyOptIn && !hasSecret) {
    throw new StorageOptInError();
  }

  const values = {
    id: SINGLETON_ID,
    provider: input.provider,
    endpoint: input.endpoint,
    region: input.region,
    bucket: input.bucket,
    accessKey: input.accessKey,
    secretKeyEncrypted: secretKeyEncrypted ?? null,
    pathPrefix: input.pathPrefix,
    publicBucket: input.publicBucket,
    // No secret ⇒ all consumers off, regardless of what was requested.
    uploadsEnabled: hasSecret && input.uploadsEnabled,
    backupsEnabled: hasSecret && input.backupsEnabled,
    siemEnabled: hasSecret && input.siemEnabled,
    updatedAt: new Date(),
    updatedBy: actorUserId,
  };

  await db
    .insert(schema.instanceStorageConfig)
    .values(values)
    .onConflictDoUpdate({
      target: schema.instanceStorageConfig.id,
      set: {
        provider: values.provider,
        endpoint: values.endpoint,
        region: values.region,
        bucket: values.bucket,
        accessKey: values.accessKey,
        secretKeyEncrypted: values.secretKeyEncrypted,
        pathPrefix: values.pathPrefix,
        publicBucket: values.publicBucket,
        uploadsEnabled: values.uploadsEnabled,
        backupsEnabled: values.backupsEnabled,
        siemEnabled: values.siemEnabled,
        updatedAt: values.updatedAt,
        updatedBy: values.updatedBy,
      },
    });
}

/**
 * Flip a single consumer opt-in. Enabling is gated on a usable stored config
 * (a row with a secret key); disabling always succeeds. Throws
 * {@link StorageOptInError} when enabling without a usable config.
 */
export async function setConsumerOptIn(
  db: Db,
  consumer: StorageConsumer,
  enabled: boolean,
): Promise<void> {
  if (enabled && !(await hasUsableStoredConfig(db))) {
    throw new StorageOptInError();
  }
  const column =
    consumer === 'uploads'
      ? { uploadsEnabled: enabled }
      : consumer === 'backups'
        ? { backupsEnabled: enabled }
        : { siemEnabled: enabled };
  await db
    .update(schema.instanceStorageConfig)
    .set({ ...column, updatedAt: new Date() })
    .where(eq(schema.instanceStorageConfig.id, SINGLETON_ID));
}

/**
 * First-boot migration: copy the existing `S3_*` env into the DB row so the
 * admin sees today's values in the form. No-ops when a row already exists or
 * when FILE_BACKEND≠s3 / the S3_* vars aren't all set. Returns true iff a row
 * was inserted. Uploads opt-in is seeded ON because env-only deployments were
 * already serving uploads from S3 (FILE_BACKEND=s3); backups/SIEM stay OFF.
 */
export async function migrateEnvStorageConfigOnce(db: Db): Promise<boolean> {
  const existing = await readRow(db);
  if (existing) return false;
  const e = readS3Env();
  if (!envS3Configured(e)) return false;

  await db.insert(schema.instanceStorageConfig).values({
    id: SINGLETON_ID,
    provider: 's3',
    endpoint: e.endpoint as string,
    region: e.region,
    bucket: e.bucket as string,
    accessKey: e.accessKey,
    secretKeyEncrypted: e.secretKey ? sealSecret(e.secretKey, authSecret()) : null,
    pathPrefix: null,
    publicBucket: false,
    uploadsEnabled: true,
    backupsEnabled: false,
    siemEnabled: false,
  });
  return true;
}

export type TestStorageResult = { ok: true } | { ok: false; error: string };

/** Apply the configured path prefix to a key (no-op when prefix is empty). */
export function applyPathPrefix(prefix: string | null | undefined, key: string): string {
  const p = (prefix ?? '').replace(/^\/+|\/+$/g, '');
  return p ? `${p}/${key}` : key;
}

function buildS3Storage(cfg: EffectiveStorageConfig): S3Storage | null {
  if (!cfg.accessKey || !cfg.secretKey) return null;
  return new S3Storage({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
  });
}

/**
 * Real round-trip health check: PutObject then DeleteObject of a tiny fixed
 * key under the configured path prefix. Surfaces the verbatim S3 error string
 * on failure so the admin can act; `{ok:false, error:'not_configured'}` when
 * no usable config (no row/env, or no credentials) exists.
 */
export async function testStorageConnection(db: Db): Promise<TestStorageResult> {
  const cfg = await getEffectiveStorageConfig(db);
  if (!cfg) return { ok: false, error: 'not_configured' };
  const storage = buildS3Storage(cfg);
  if (!storage) return { ok: false, error: 'not_configured' };
  const key = applyPathPrefix(cfg.pathPrefix, '__cairn_conn_test');
  try {
    await storage.put(key, Buffer.from('cairn-connection-test'), 'text/plain');
    await storage.delete(key);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Storage backend for a specific consumer, honouring its opt-in toggle.
 *
 * - `uploads`: returns an S3Storage when uploads are opted in AND a usable
 *   config exists, else falls back to {@link LocalDiskStorage} so uploads NEVER
 *   break (this mirrors the legacy getStorage() local default).
 * - `backups` / `siem`: returns the S3Storage when opted in + configured, else
 *   `null` so the caller keeps its existing env/local behaviour.
 *
 * The returned S3Storage transparently applies `path_prefix` to every key.
 */
export async function getStorageFor(
  db: Db,
  consumer: StorageConsumer,
): Promise<FileStorage | null> {
  const cfg = await getEffectiveStorageConfig(db);
  const optedIn =
    cfg != null &&
    (consumer === 'uploads'
      ? cfg.uploadsEnabled
      : consumer === 'backups'
        ? cfg.backupsEnabled
        : cfg.siemEnabled);

  if (cfg && optedIn) {
    const s3 = buildS3Storage(cfg);
    if (s3) return cfg.pathPrefix ? new PrefixedStorage(s3, cfg.pathPrefix) : s3;
  }

  if (consumer === 'uploads') {
    const root = process.env.CAIRN_UPLOAD_ROOT ?? '/data/uploads';
    return new LocalDiskStorage(root);
  }
  return null;
}

/**
 * Wraps a FileStorage and transparently prefixes every key, so a consumer can
 * share one bucket with other tenants under a configured `path_prefix`.
 */
class PrefixedStorage implements FileStorage {
  constructor(
    private readonly inner: FileStorage,
    private readonly prefix: string,
  ) {}

  private k(path: string): string {
    return applyPathPrefix(this.prefix, path);
  }

  put(path: string, body: Buffer, mimeType: string): Promise<void> {
    return this.inner.put(this.k(path), body, mimeType);
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(this.k(path));
  }

  delete(path: string): Promise<void> {
    return this.inner.delete(this.k(path));
  }

  read(path: string) {
    return this.inner.read(this.k(path));
  }
}
