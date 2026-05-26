import { bigint, customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

const bytea = customType<{ data: Buffer; default: false; notNull: true }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * v0.9.0 G1 P8 — one row per registered passkey. Unique per credential id
 * (the WebAuthn spec guarantees credential ids are globally unique). The
 * public key + sign-count are the inputs to the assertion verifier; the
 * sign-count must monotonically advance per spec (anti-cloning).
 */
export const userWebauthnCredentials = pgTable(
  'user_webauthn_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // base64url-encoded credential id emitted by the authenticator. Unique
    // across users (WebAuthn spec: credential ids are globally unique).
    credentialId: text('credential_id').notNull().unique(),
    publicKey: bytea('public_key').notNull(),
    // Anti-cloning monotonic counter; updated on every successful assertion.
    signCount: bigint('sign_count', { mode: 'number' }).notNull().default(0),
    transports: text('transports').array(),
    aaguid: uuid('aaguid'),
    nickname: text('nickname'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('user_webauthn_credentials_user_idx').on(t.userId)],
);

export type UserWebauthnCredential = typeof userWebauthnCredentials.$inferSelect;
export type NewUserWebauthnCredential = typeof userWebauthnCredentials.$inferInsert;
