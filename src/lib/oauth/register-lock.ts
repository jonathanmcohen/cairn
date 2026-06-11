import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { hashOauthToken, mintOauthSecret, OAUTH_PREFIX, verifyOauthToken } from './tokens';

/**
 * v0.10.0 G5 — optional admin lock on RFC 7591 dynamic client registration.
 *
 * DEFAULT IS OPEN: self-hosted MCP clients must keep self-registering with
 * zero setup. When an admin turns the lock ON, `POST /api/oauth/register`
 * requires an RFC 7591 §3.1.1 *initial access token* as a Bearer credential;
 * everything else (the registry, grants, the authorize/token endpoints) is
 * unchanged.
 *
 * State is two `system_meta` rows (instance-level KV — registration happens
 * before any workspace exists, so no migration and no workspace column):
 *
 *   oauth.register_lock      'on' | 'off' (absent ⇒ off / open)
 *   oauth.register_iat_hash  sha256-hex of the initial access token
 *
 * The token is minted as `cairn_oiat_<base64url 32B>` via the shared OAuth
 * secret helpers (src/lib/oauth/tokens.ts) — ONLY the hash is stored, the
 * plaintext is returned ONCE from `setRegisterLock` and never recoverable.
 * Re-locking while already locked is the "regenerate" path: a fresh token
 * replaces the old hash atomically. Verification is the same constant-time
 * compare every other Cairn secret uses.
 *
 * Both transitions write an `oauth.register_lock_changed` audit row with
 * metadata `{ locked }` only — the `cairn_oiat_` prefix is in
 * FORBIDDEN_SUBSTRINGS, so a leaked plaintext would trip
 * `assertAuditMetadataClean`.
 */

export const REGISTER_LOCK_KEY = 'oauth.register_lock';
export const REGISTER_IAT_HASH_KEY = 'oauth.register_iat_hash';

type Db = PostgresJsDatabase<typeof schema>;

/** Read the lock state. Absent / anything but 'on' ⇒ open (the default). */
export async function getRegisterLock(db: Db): Promise<{ locked: boolean }> {
  const [row] = await db
    .select({ value: schema.systemMeta.value })
    .from(schema.systemMeta)
    .where(eq(schema.systemMeta.key, REGISTER_LOCK_KEY))
    .limit(1);
  return { locked: row?.value === 'on' };
}

export type SetRegisterLockInput = {
  locked: boolean;
  actorUserId: string;
  /** The actor's active workspace — audit_log.workspace_id is NOT NULL. */
  workspaceId: string;
};

export type SetRegisterLockResult = {
  locked: boolean;
  /**
   * Present ONLY when turning the lock on (or re-locking to regenerate): the
   * plaintext initial access token, returned exactly once. Never stored.
   */
  initialAccessToken?: string;
};

/**
 * Turn the registration lock on/off (admin-only — callers gate via
 * requireRole). ON mints a fresh initial access token (regenerating any
 * previous one) and stores ONLY its hash; OFF deletes both keys. Both
 * transitions are audited inside the same transaction.
 */
export async function setRegisterLock(
  db: Db,
  input: SetRegisterLockInput,
): Promise<SetRegisterLockResult> {
  if (input.locked) {
    const token = mintOauthSecret(OAUTH_PREFIX.initialAccess);
    const hash = hashOauthToken(token);
    await db.transaction(async (tx) => {
      const now = new Date();
      for (const [key, value] of [
        [REGISTER_LOCK_KEY, 'on'],
        [REGISTER_IAT_HASH_KEY, hash],
      ] as const) {
        await tx
          .insert(schema.systemMeta)
          .values({ key, value, updatedAt: now })
          .onConflictDoUpdate({
            target: schema.systemMeta.key,
            set: { value, updatedAt: now },
          });
      }
      await recordAudit(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: 'oauth.register_lock_changed',
        metadata: { locked: true },
      });
    });
    return { locked: true, initialAccessToken: token };
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.systemMeta)
      .where(inArray(schema.systemMeta.key, [REGISTER_LOCK_KEY, REGISTER_IAT_HASH_KEY]));
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'oauth.register_lock_changed',
      metadata: { locked: false },
    });
  });
  return { locked: false };
}

/**
 * Constant-time check of a presented RFC 7591 §3.1.1 initial access token
 * against the stored sha256-hex hash. False when no hash is stored (lock off
 * or never enabled) — callers only invoke this while the lock is ON.
 */
export async function verifyInitialAccessToken(db: Db, presented: string): Promise<boolean> {
  const [row] = await db
    .select({ value: schema.systemMeta.value })
    .from(schema.systemMeta)
    .where(eq(schema.systemMeta.key, REGISTER_IAT_HASH_KEY))
    .limit(1);
  if (!row?.value) return false;
  return verifyOauthToken(presented, row.value);
}
