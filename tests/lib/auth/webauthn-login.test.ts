/**
 * v0.9.6 G8 — passwordless login ceremony helpers.
 *
 * Mocks @simplewebauthn/server (like webauthn-assert.test.ts) to verify the
 * DB-side behavior of beginLoginAssertion / finishLoginAssertion:
 *   - resolves the user by (lower-cased) email
 *   - builds the allow-list from that user's credentials only
 *   - unknown email / user-without-credentials → null (no enumeration)
 *   - successful verify returns the resolved userId + bumps sign_count
 *   - verifier throw → generic failure (no detail leak)
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';

const FAKE_CREDENTIAL_ID = 'login-fake-credential-id';

vi.mock('@simplewebauthn/server', async () => {
  const actual =
    await vi.importActual<typeof import('@simplewebauthn/server')>('@simplewebauthn/server');
  return {
    ...actual,
    generateAuthenticationOptions: vi.fn(async () => ({
      challenge: 'fake-login-challenge',
      timeout: 60000,
      rpId: 'rp-id.test',
      allowCredentials: [],
      userVerification: 'preferred' as const,
    })),
    verifyAuthenticationResponse: vi.fn(async () => ({
      verified: true,
      authenticationInfo: {
        newCounter: 7,
        credentialID: FAKE_CREDENTIAL_ID,
        userVerified: true,
        credentialDeviceType: 'singleDevice' as const,
        credentialBackedUp: false,
        origin: 'https://rp-origin.test',
        rpID: 'rp-id.test',
      },
    })),
  };
});

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(48);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  process.env.CAIRN_RP_ID = 'rp-id.test';
  process.env.CAIRN_RP_NAME = 'Cairn';
  process.env.CAIRN_RP_ORIGIN = 'https://rp-origin.test';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE user_webauthn_credentials, users RESTART IDENTITY CASCADE`;
});

async function seedUserWithCredential(opts: {
  email: string;
  credentialId: string;
  signCount: number;
}): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({ email: opts.email, passwordHash: 'h', name: opts.email })
    .returning({ id: schema.users.id });
  await db.insert(schema.userWebauthnCredentials).values({
    userId: u!.id,
    credentialId: opts.credentialId,
    publicKey: Buffer.from([1, 2, 3, 4]),
    signCount: opts.signCount,
    transports: ['internal'],
    nickname: 'k',
  });
  return u!.id;
}

describe('webauthn — login ceremony', () => {
  it('beginLoginAssertion limits allowCredentials to the resolved user', async () => {
    await seedUserWithCredential({ email: 'a@e.com', credentialId: 'cred-a', signCount: 0 });
    await seedUserWithCredential({ email: 'b@e.com', credentialId: 'cred-b', signCount: 0 });
    const { beginLoginAssertion } = await import('@/lib/auth/webauthn');
    const out = await beginLoginAssertion({ email: 'B@e.com', db });
    expect(out).not.toBeNull();
    const server = await import('@simplewebauthn/server');
    const args = vi.mocked(server.generateAuthenticationOptions).mock.calls.at(-1)?.[0];
    expect((args?.allowCredentials ?? []).map((c) => c.id)).toEqual(['cred-b']);
  });

  it('beginLoginAssertion returns null for an unknown email (no enumeration)', async () => {
    const { beginLoginAssertion } = await import('@/lib/auth/webauthn');
    const out = await beginLoginAssertion({ email: 'nobody@e.com', db });
    expect(out).toBeNull();
  });

  it('beginLoginAssertion returns null for a user with no passkeys', async () => {
    await db.insert(schema.users).values({ email: 'np@e.com', passwordHash: 'h', name: 'np' });
    const { beginLoginAssertion } = await import('@/lib/auth/webauthn');
    const out = await beginLoginAssertion({ email: 'np@e.com', db });
    expect(out).toBeNull();
  });

  it('finishLoginAssertion returns the resolved userId + bumps sign_count', async () => {
    const userId = await seedUserWithCredential({
      email: 'u@e.com',
      credentialId: FAKE_CREDENTIAL_ID,
      signCount: 0,
    });
    const { finishLoginAssertion } = await import('@/lib/auth/webauthn');
    const result = await finishLoginAssertion({
      response: { id: FAKE_CREDENTIAL_ID } as never,
      expectedChallenge: 'fake-login-challenge',
      db,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.userId).toBe(userId);
    const [row] = await db
      .select()
      .from(schema.userWebauthnCredentials)
      .where(eq(schema.userWebauthnCredentials.credentialId, FAKE_CREDENTIAL_ID));
    expect(Number(row?.signCount)).toBe(7);
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it('finishLoginAssertion rejects an unknown credential id', async () => {
    await seedUserWithCredential({
      email: 'u@e.com',
      credentialId: FAKE_CREDENTIAL_ID,
      signCount: 0,
    });
    const { finishLoginAssertion } = await import('@/lib/auth/webauthn');
    const result = await finishLoginAssertion({
      response: { id: 'who-dis' } as never,
      expectedChallenge: 'fake-login-challenge',
      db,
    });
    expect(result.ok).toBe(false);
  });

  it('verifier throw maps to generic failure (no leak)', async () => {
    await seedUserWithCredential({
      email: 'u@e.com',
      credentialId: FAKE_CREDENTIAL_ID,
      signCount: 0,
    });
    const server = await import('@simplewebauthn/server');
    vi.mocked(server.verifyAuthenticationResponse).mockRejectedValueOnce(
      new Error('sensitive sign-count detail'),
    );
    const { finishLoginAssertion } = await import('@/lib/auth/webauthn');
    const result = await finishLoginAssertion({
      response: { id: FAKE_CREDENTIAL_ID } as never,
      expectedChallenge: 'fake-login-challenge',
      db,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('verification failed');
  });
});
