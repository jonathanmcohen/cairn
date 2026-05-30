import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { openSecret, sealSecret } from '@/lib/crypto/secret-box';
import {
  buildOtpauthUri,
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  type StoredRecoveryCode,
  verifyTotp,
} from './totp';

type Db = PostgresJsDatabase<typeof schema>;

const RECOVERY_COUNT = 10;
const ISSUER = 'Cairn';

export type EnrollmentResult = {
  secret: string;
  otpauthUri: string;
  recoveryCodes: string[]; // plaintext — returned ONCE, never persisted in the clear
};

/**
 * Step 1 of enrollment. Mints a TOTP secret + recovery codes, stores the secret
 * ENCRYPTED (secret-box) and the recovery codes HASHED, returns plaintext ONCE.
 * Upserts so a re-begin before confirm replaces a stale pending enrollment.
 */
export async function beginEnrollment(
  db: Db,
  input: { userId: string; account: string; key: string },
): Promise<EnrollmentResult> {
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes(RECOVERY_COUNT);
  const sealed = sealSecret(secret, input.key);
  const stored: StoredRecoveryCode[] = recoveryCodes.map((code) => ({
    hash: hashRecoveryCode(code),
    usedAt: null,
  }));

  await db
    .insert(schema.userTotp)
    .values({
      userId: input.userId,
      secretEncrypted: sealed,
      recoveryCodes: stored,
      enabledAt: null,
      lastUsedAt: null,
    })
    .onConflictDoUpdate({
      target: schema.userTotp.userId,
      set: { secretEncrypted: sealed, recoveryCodes: stored, enabledAt: null, lastUsedAt: null },
    });

  return {
    secret,
    otpauthUri: buildOtpauthUri({ secret, account: input.account, issuer: ISSUER }),
    recoveryCodes,
  };
}

/** Step 2 of enrollment. Verifies a live code; on success stamps enabledAt. */
export async function confirmEnrollment(
  db: Db,
  input: { userId: string; token: string; key: string },
): Promise<boolean> {
  const row = await getRow(db, input.userId);
  if (!row) return false;
  const secret = openSecret(row.secretEncrypted as Buffer, input.key);
  if (!verifyTotp({ token: input.token, secret })) return false;
  await db
    .update(schema.userTotp)
    .set({ enabledAt: new Date() })
    .where(eq(schema.userTotp.userId, input.userId));
  return true;
}

export async function isTwoFactorEnabled(db: Db, userId: string): Promise<boolean> {
  const row = await getRow(db, userId);
  return Boolean(row?.enabledAt);
}

/**
 * Verify second factor at sign-in: valid TOTP code OR unused recovery code.
 * On recovery match the consumed set is persisted (single-use). Stamps
 * lastUsedAt on any success. Returns false if 2FA isn't enabled.
 */
export async function verifySecondFactor(
  db: Db,
  input: { userId: string; code: string; key: string },
): Promise<boolean> {
  const row = await getRow(db, input.userId);
  if (!row?.enabledAt) return false;

  const secret = openSecret(row.secretEncrypted as Buffer, input.key);
  if (verifyTotp({ token: input.code, secret })) {
    await db
      .update(schema.userTotp)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.userTotp.userId, input.userId));
    return true;
  }

  const stored = (row.recoveryCodes ?? []) as StoredRecoveryCode[];
  const result = consumeRecoveryCode(stored, input.code);
  if (!result.ok) return false;
  await db
    .update(schema.userTotp)
    .set({ recoveryCodes: result.next, lastUsedAt: new Date() })
    .where(eq(schema.userTotp.userId, input.userId));
  return true;
}

export async function disableTwoFactor(db: Db, userId: string): Promise<void> {
  await db.delete(schema.userTotp).where(eq(schema.userTotp.userId, userId));
}

/** Count unused recovery codes for a user; 0 if 2FA isn't enrolled. */
export async function countRemainingRecoveryCodes(db: Db, userId: string): Promise<number> {
  const row = await getRow(db, userId);
  if (!row) return 0;
  const stored = (row.recoveryCodes ?? []) as StoredRecoveryCode[];
  return stored.filter((c) => c.usedAt === null).length;
}

/**
 * Replace the entire recovery-code set with a fresh batch. Returns plaintext
 * ONCE (never persisted in the clear). Requires 2FA to be enabled. The previous
 * set is fully invalidated. Returns null if 2FA isn't enabled.
 */
export async function regenerateRecoveryCodes(db: Db, userId: string): Promise<string[] | null> {
  const row = await getRow(db, userId);
  if (!row?.enabledAt) return null;
  const codes = generateRecoveryCodes(RECOVERY_COUNT);
  const stored: StoredRecoveryCode[] = codes.map((code) => ({
    hash: hashRecoveryCode(code),
    usedAt: null,
  }));
  await db
    .update(schema.userTotp)
    .set({ recoveryCodes: stored })
    .where(eq(schema.userTotp.userId, userId));
  return codes;
}

/**
 * True iff the user belongs to any workspace with require_2fa=true. Used by the
 * (app) layout to force enrollment before any app content renders. Cheap join
 * with a LIMIT 1 — boolean existence check, not an enumeration.
 */
export async function userHasWorkspaceRequiring2fa(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(
      and(eq(schema.workspaceMembers.userId, userId), eq(schema.workspaces.requireTwofa, true)),
    )
    .limit(1);
  return Boolean(row);
}

async function getRow(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(schema.userTotp)
    .where(eq(schema.userTotp.userId, userId))
    .limit(1);
  return row;
}
