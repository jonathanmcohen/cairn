/**
 * v0.10.0 G5 — registration-lock helper (src/lib/oauth/register-lock.ts).
 *
 * Pins the security contract: locking mints a `cairn_oiat_` initial access
 * token whose PLAINTEXT is returned exactly once while ONLY the sha256-hex
 * hash lands in system_meta; verification is the shared constant-time
 * compare; unlocking deletes both keys; and both transitions write an
 * `oauth.register_lock_changed` audit row with `{ locked }` metadata only.
 * Route-level enforcement (401 without/with-wrong bearer, 201 with the real
 * one) lives in tests/api/oauth/register-flood-control.spec.ts.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  getRegisterLock,
  REGISTER_IAT_HASH_KEY,
  REGISTER_LOCK_KEY,
  setRegisterLock,
  verifyInitialAccessToken,
} from '@/lib/oauth/register-lock';
import { hashOauthToken } from '@/lib/oauth/tokens';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.AUTH_SECRET = 'z'.repeat(32);
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE system_meta, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function actor(): Promise<{ actorUserId: string; workspaceId: string }> {
  const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
  return { actorUserId: u.userId, workspaceId: u.workspaceId };
}

async function metaValue(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: schema.systemMeta.value })
    .from(schema.systemMeta)
    .where(eq(schema.systemMeta.key, key))
    .limit(1);
  return row?.value ?? null;
}

async function lockAuditRows(): Promise<Array<{ metadata: unknown; actorUserId: string | null }>> {
  return db
    .select({ metadata: schema.auditLog.metadata, actorUserId: schema.auditLog.actorUserId })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.action, 'oauth.register_lock_changed'));
}

describe('getRegisterLock', () => {
  it('defaults to open (no system_meta row)', async () => {
    expect(await getRegisterLock(db)).toEqual({ locked: false });
  });
});

describe('setRegisterLock(locked: true)', () => {
  it('mints a cairn_oiat_ token once and stores ONLY the sha256 hash', async () => {
    const a = await actor();
    const result = await setRegisterLock(db, { locked: true, ...a });

    expect(result.locked).toBe(true);
    const token = result.initialAccessToken;
    expect(token).toMatch(/^cairn_oiat_[A-Za-z0-9_-]{43}$/);

    expect(await metaValue(REGISTER_LOCK_KEY)).toBe('on');
    const storedHash = await metaValue(REGISTER_IAT_HASH_KEY);
    expect(storedHash).toBe(hashOauthToken(token as string));
    // The stored value is a 64-char hex digest, never the plaintext.
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedHash).not.toContain('cairn_oiat_');

    expect(await getRegisterLock(db)).toEqual({ locked: true });
  });

  it('writes an audit row with { locked: true } metadata only (no token material)', async () => {
    const a = await actor();
    await setRegisterLock(db, { locked: true, ...a });
    const rows = await lockAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(a.actorUserId);
    expect(rows[0]?.metadata).toEqual({ locked: true });
  });

  it('re-locking regenerates: a fresh token verifies, the old one stops working', async () => {
    const a = await actor();
    const first = await setRegisterLock(db, { locked: true, ...a });
    const second = await setRegisterLock(db, { locked: true, ...a });
    expect(second.initialAccessToken).not.toBe(first.initialAccessToken);
    expect(await verifyInitialAccessToken(db, second.initialAccessToken as string)).toBe(true);
    expect(await verifyInitialAccessToken(db, first.initialAccessToken as string)).toBe(false);
  });
});

describe('verifyInitialAccessToken', () => {
  it('accepts the minted token and rejects a wrong one', async () => {
    const a = await actor();
    const { initialAccessToken } = await setRegisterLock(db, { locked: true, ...a });
    expect(await verifyInitialAccessToken(db, initialAccessToken as string)).toBe(true);
    expect(await verifyInitialAccessToken(db, `cairn_oiat_${'x'.repeat(43)}`)).toBe(false);
    expect(await verifyInitialAccessToken(db, '')).toBe(false);
  });

  it('returns false when no hash is stored at all', async () => {
    expect(await verifyInitialAccessToken(db, `cairn_oiat_${'x'.repeat(43)}`)).toBe(false);
  });
});

describe('setRegisterLock(locked: false)', () => {
  it('deletes BOTH keys, reopens registration, and audits { locked: false }', async () => {
    const a = await actor();
    const { initialAccessToken } = await setRegisterLock(db, { locked: true, ...a });
    const result = await setRegisterLock(db, { locked: false, ...a });

    expect(result).toEqual({ locked: false });
    expect(result.initialAccessToken).toBeUndefined();
    expect(await metaValue(REGISTER_LOCK_KEY)).toBeNull();
    expect(await metaValue(REGISTER_IAT_HASH_KEY)).toBeNull();
    expect(await getRegisterLock(db)).toEqual({ locked: false });
    // With the hash gone the old token can never verify again.
    expect(await verifyInitialAccessToken(db, initialAccessToken as string)).toBe(false);

    const rows = await lockAuditRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.metadata)).toEqual([{ locked: true }, { locked: false }]);
  });
});
