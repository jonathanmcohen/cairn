import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  beginEnrollment,
  confirmEnrollment,
  countRemainingRecoveryCodes,
  regenerateRecoveryCodes,
  verifySecondFactor,
} from '@/lib/auth/two-factor';
import { startPostgres, stopPostgres } from '../../helpers/db';

const KEY = 's'.repeat(48);
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();
const codeFor = (secret: string) => generateSync({ secret, crypto, base32 });

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE users, user_totp RESTART IDENTITY CASCADE`;
});

async function makeUser(email = 'u@x.com') {
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: 'U' })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u;
}

async function enroll(email = 'u@x.com') {
  const u = await makeUser(email);
  const out = await beginEnrollment(db, { userId: u.id, account: u.email, key: KEY });
  await confirmEnrollment(db, { userId: u.id, token: codeFor(out.secret), key: KEY });
  return { u, out };
}

describe('countRemainingRecoveryCodes', () => {
  it('returns 0 when 2FA is not enrolled', async () => {
    const u = await makeUser();
    expect(await countRemainingRecoveryCodes(db, u.id)).toBe(0);
  });

  it('returns 10 right after enrollment and drops as codes are consumed', async () => {
    const { u, out } = await enroll();
    expect(await countRemainingRecoveryCodes(db, u.id)).toBe(10);
    const recovery = out.recoveryCodes[0];
    if (!recovery) throw new Error('no recovery code');
    expect(await verifySecondFactor(db, { userId: u.id, code: recovery, key: KEY })).toBe(true);
    expect(await countRemainingRecoveryCodes(db, u.id)).toBe(9);
  });
});

describe('regenerateRecoveryCodes', () => {
  it('returns null when 2FA is not enabled (cannot regenerate)', async () => {
    const u = await makeUser();
    expect(await regenerateRecoveryCodes(db, u.id)).toBeNull();
  });

  it('replaces the whole set with 10 fresh codes, invalidating the old ones', async () => {
    const { u, out } = await enroll();
    const oldCode = out.recoveryCodes[0];
    if (!oldCode) throw new Error('no recovery code');

    const fresh = await regenerateRecoveryCodes(db, u.id);
    expect(fresh).not.toBeNull();
    expect(fresh).toHaveLength(10);
    expect(await countRemainingRecoveryCodes(db, u.id)).toBe(10);

    // Old codes no longer verify.
    expect(await verifySecondFactor(db, { userId: u.id, code: oldCode, key: KEY })).toBe(false);
    // A new code verifies once.
    const newCode = fresh?.[0];
    if (!newCode) throw new Error('no fresh code');
    expect(await verifySecondFactor(db, { userId: u.id, code: newCode, key: KEY })).toBe(true);
    expect(await countRemainingRecoveryCodes(db, u.id)).toBe(9);
  });

  it('never persists fresh codes in plaintext', async () => {
    const { u } = await enroll();
    const fresh = await regenerateRecoveryCodes(db, u.id);
    const [row] = await db.select().from(schema.userTotp).where(eq(schema.userTotp.userId, u.id));
    for (const code of fresh ?? []) {
      expect(JSON.stringify(row?.recoveryCodes)).not.toContain(code);
    }
  });
});
