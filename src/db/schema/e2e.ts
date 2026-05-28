import {
  bigint,
  customType,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

// Postgres bytea — Drizzle has no first-class bytea, use customType.
const bytea = customType<{ data: Buffer; default: false; notNull: true }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Per-user X25519 keypair. `public_key` is the raw 32-byte X25519 public key.
 * `encrypted_private_key` is the X25519 private key sealed by AES-256-GCM under
 * a passphrase-derived KEK (scrypt(passphrase, kdf_salt, kdf_iters) -> 32B key);
 * the sealed blob is `iv(12) || ciphertext(32) || tag(16)` = 60 bytes.
 *
 * The server never possesses the unwrapped private key — it stores ciphertext
 * and lets the client unlock it client-side at sign-in (or step-up) time.
 */
export const userKeypairs = pgTable('user_keypairs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  publicKey: bytea('public_key').notNull(),
  encryptedPrivateKey: bytea('encrypted_private_key').notNull(),
  kdfSalt: bytea('kdf_salt').notNull(),
  kdfIters: integer('kdf_iters').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-(page, member) wrapped DEK. Used by P6 selective encryption.
 * `wrapped_dek` = ephemeral_pub(32) || iv(12) || ciphertext(32) || tag(16) = 92 bytes.
 */
export const pageEncryptionKeys = pgTable(
  'page_encryption_keys',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    memberUserId: uuid('member_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    wrappedDek: bytea('wrapped_dek').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.pageId, t.memberUserId] }),
  }),
);

/**
 * Per-(workspace, member) wrapped workspace-key. Used by P7 workspace-wide mode.
 * Same envelope shape as pageEncryptionKeys.wrappedDek.
 */
export const workspaceEncryptionKeys = pgTable(
  'workspace_encryption_keys',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberUserId: uuid('member_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    wrappedWsk: bytea('wrapped_wsk').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Unused now — P7 increments on rekey events so clients can detect a key change.
    keyVersion: bigint('key_version', { mode: 'number' }).notNull().default(1),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId, t.memberUserId] }),
  }),
);

export type UserKeypair = typeof userKeypairs.$inferSelect;
export type NewUserKeypair = typeof userKeypairs.$inferInsert;
export type PageEncryptionKey = typeof pageEncryptionKeys.$inferSelect;
export type NewPageEncryptionKey = typeof pageEncryptionKeys.$inferInsert;
export type WorkspaceEncryptionKey = typeof workspaceEncryptionKeys.$inferSelect;
export type NewWorkspaceEncryptionKey = typeof workspaceEncryptionKeys.$inferInsert;
