import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from './page-yjs';
import { users } from './users';

/**
 * v0.10.3 CFG-2 — instance-global S3-compatible object-storage configuration,
 * surfaced into the admin Settings UI instead of env-only. Single row, keyed
 * `id = 'singleton'`, so the PK alone enforces "at most one config". DB values
 * override `S3_*` / `FILE_BACKEND` env; the env migrates into this row on first
 * boot (see lib/files/storage-config.ts).
 *
 * `secret_key_encrypted` is a secret-box envelope (AES-256-GCM + HKDF from
 * AUTH_SECRET) — never the plaintext, never returned to the client.
 *
 * `provider` is informational (`s3` | `r2` | `minio` | `b2`) — every provider
 * speaks the S3 API; it only labels the row for the admin.
 *
 * Each consumer (file uploads, workspace backups, SIEM s3 archive) opts in via
 * its own boolean, default OFF. The route enforces the gate: a consumer toggle
 * may only flip TRUE once a config row with a secret key exists (i.e. after a
 * successful Test connection in the UI).
 */
export const instanceStorageConfig = pgTable('instance_storage_config', {
  id: text('id').primaryKey().default('singleton'),
  provider: text('provider').notNull().default('s3'),
  endpoint: text('endpoint').notNull(),
  region: text('region').notNull().default('us-east-1'),
  bucket: text('bucket').notNull(),
  accessKey: text('access_key'),
  secretKeyEncrypted: bytea('secret_key_encrypted'),
  pathPrefix: text('path_prefix'),
  publicBucket: boolean('public_bucket').notNull().default(false),
  uploadsEnabled: boolean('uploads_enabled').notNull().default(false),
  backupsEnabled: boolean('backups_enabled').notNull().default(false),
  siemEnabled: boolean('siem_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export type InstanceStorageConfig = typeof instanceStorageConfig.$inferSelect;
export type NewInstanceStorageConfig = typeof instanceStorageConfig.$inferInsert;
