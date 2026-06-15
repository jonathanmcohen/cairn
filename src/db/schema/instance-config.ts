import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from './page-yjs';
import { users } from './users';

/**
 * v0.10.3 CFG-1 — instance-global SMTP configuration, surfaced into the admin
 * Settings UI instead of env-only. Single row, keyed `id = 'singleton'`, so the
 * PK alone enforces "at most one config". DB values override `SMTP_*` env; the
 * env migrates into this row on first boot (see lib/email/config.ts).
 *
 * `password_encrypted` is a secret-box envelope (AES-256-GCM + HKDF from
 * AUTH_SECRET) — never the plaintext, never returned to the client.
 * `tls_mode` is one of 'starttls' | 'tls' | 'none' (mapped to nodemailer opts).
 */
export const instanceEmailConfig = pgTable('instance_email_config', {
  id: text('id').primaryKey().default('singleton'),
  host: text('host').notNull(),
  port: integer('port').notNull().default(587),
  tlsMode: text('tls_mode').notNull().default('starttls'),
  username: text('username'),
  passwordEncrypted: bytea('password_encrypted'),
  fromAddress: text('from_address').notNull(),
  replyTo: text('reply_to'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export type InstanceEmailConfig = typeof instanceEmailConfig.$inferSelect;
export type NewInstanceEmailConfig = typeof instanceEmailConfig.$inferInsert;
