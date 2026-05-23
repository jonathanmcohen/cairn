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
  disableTwoFactor,
  isTwoFactorEnabled,
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

describe('two-factor enrollment', () => {
  it('begins enrollment: returns secret + URI + plaintext recovery codes, stores them protected', async () => {
    const u = await makeUser();
    const out = await beginEnrollment(db, { userId: u.id, account: u.email, key: KEY });
    expect(out.secret).toMatch(/^[A-Z2-7]+$/);
    expect(out.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
    expect(out.recoveryCodes).toHaveLength(10);

    const [row] = await db.select().from(schema.userTotp).where(eq(schema.userTotp.userId, u.id));
    expect(row?.enabledAt).toBeNull();
    const sealed = row?.secretEncrypted as Buffer;
    expect(sealed.toString('latin1')).not.toContain(out.secret);
    const stored = row?.recoveryCodes as { hash: string; usedAt: string | null }[];
    for (const code of out.recoveryCodes) {
      expect(JSON.stringify(stored)).not.toContain(code);
    }
  });

  it('confirms enrollment with a live code → enabledAt set; isTwoFactorEnabled true', async () => {
    const u = await makeUser();
    const out = await beginEnrollment(db, { userId: u.id, account: u.email, key: KEY });
    expect(await isTwoFactorEnabled(db, u.id)).toBe(false);
    const ok = await confirmEnrollment(db, {
      userId: u.id,
      token: codeFor(out.secret),
      key: KEY,
    });
    expect(ok).toBe(true);
    expect(await isTwoFactorEnabled(db, u.id)).toBe(true);
  });

  it('rejects confirmation with a bad code (stays disabled)', async () => {
    const u = await makeUser();
    await beginEnrollment(db, { userId: u.id, account: u.email, key: KEY });
    const ok = await confirmEnrollment(db, { userId: u.id, token: '000000', key: KEY });
    expect(ok).toBe(false);
    expect(await isTwoFactorEnabled(db, u.id)).toBe(false);
  });
});

describe('verifySecondFactor', () => {
  it('accepts a valid TOTP code and stamps lastUsedAt', async () => {
    const u = await makeUser();
    const out = await beginEnrollment(db, { userId: u.id, account: u.email, key: KEY });
    await confirmEnrollment(db, { userId: u.id, token: codeFor(out.secret), key: KEY });
    const ok = await verifySecondFactor(db, {
      userId: u.id,
      code: codeFor(out.secret),
      key: KEY,
    });
    expect(ok).toBe(true);
    const [row] = await db.select().from(schema.userTotp).where(eq(schema.userTotp.userId, u.id));
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it('accepts a recovery code once, then never again', async () => {
    const u = await makeUser();
    const out = await beginEnrollment(db, { userId: u.id, account: u.email, key: KEY });
    await confirmEnrollment(db, { userId: u.id, token: codeFor(out.secret), key: KEY });
    const recovery = out.recoveryCodes[0];
    if (!recovery) throw new Error('no recovery code');
    expect(await verifySecondFactor(db, { userId: u.id, code: recovery, key: KEY })).toBe(true);
    expect(await verifySecondFactor(db, { userId: u.id, code: recovery, key: KEY })).toBe(false);
  });

  it('rejects when 2FA is not enabled', async () => {
    const u = await makeUser();
    expect(await verifySecondFactor(db, { userId: u.id, code: '000000', key: KEY })).toBe(false);
  });
});

describe('disableTwoFactor', () => {
  it('removes the row → disabled', async () => {
    const u = await makeUser();
    const out = await beginEnrollment(db, { userId: u.id, account: u.email, key: KEY });
    await confirmEnrollment(db, { userId: u.id, token: codeFor(out.secret), key: KEY });
    await disableTwoFactor(db, u.id);
    expect(await isTwoFactorEnabled(db, u.id)).toBe(false);
  });
});
