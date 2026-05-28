/**
 * v0.9.0 G1 P8 — assertion ceremony helpers + sign-count anti-cloning.
 *
 * Mocks @simplewebauthn/server to verify the DB-side behavior:
 *   - allowList scoped by user (excludes other users' credentials)
 *   - rejects unknown credential ids
 *   - bumps sign_count + last_used_at on successful verify
 *   - returns generic error on verifier throw (no detail leak)
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';

const FAKE_CREDENTIAL_ID = 'fake-credential-id-base64url';

vi.mock('@simplewebauthn/server', async () => {
  const actual =
    await vi.importActual<typeof import('@simplewebauthn/server')>('@simplewebauthn/server');
  return {
    ...actual,
    generateAuthenticationOptions: vi.fn(async () => ({
      challenge: 'fake-assert-challenge',
      timeout: 60000,
      rpId: 'rp-id.test',
      allowCredentials: [],
      userVerification: 'preferred' as const,
    })),
    verifyAuthenticationResponse: vi.fn(async () => ({
      verified: true,
      authenticationInfo: {
        newCounter: 42,
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

describe('webauthn — assertion ceremony', () => {
  it('beginAssertion limits allowCredentials to the calling user', async () => {
    const _userA = await seedUserWithCredential({
      email: 'a@e.com',
      credentialId: 'cred-a',
      signCount: 0,
    });
    const userB = await seedUserWithCredential({
      email: 'b@e.com',
      credentialId: 'cred-b',
      signCount: 0,
    });
    const { beginAssertion } = await import('@/lib/auth/webauthn');
    await beginAssertion({ userId: userB, db });
    // The fake itself returns an empty allowCredentials, so just verify the
    // helper ran cleanly (no throw + we observe the call shape).
    const server = await import('@simplewebauthn/server');
    expect(vi.mocked(server.generateAuthenticationOptions)).toHaveBeenCalled();
    const args = vi.mocked(server.generateAuthenticationOptions).mock.calls.at(-1)?.[0];
    expect(args?.rpID).toBe('rp-id.test');
    // allowCredentials should contain only cred-b's id, never cred-a's.
    const ids = (args?.allowCredentials ?? []).map((c) => c.id);
    expect(ids).toEqual(['cred-b']);
  });

  it('a successful assertion bumps sign_count to the new counter + sets last_used_at', async () => {
    const userId = await seedUserWithCredential({
      email: 'u@e.com',
      credentialId: FAKE_CREDENTIAL_ID,
      signCount: 0,
    });
    const { finishAssertion } = await import('@/lib/auth/webauthn');
    const result = await finishAssertion({
      userId,
      response: { id: FAKE_CREDENTIAL_ID } as never,
      expectedChallenge: 'fake-assert-challenge',
      db,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.credentialId).toBe(FAKE_CREDENTIAL_ID);
    const [row] = await db
      .select()
      .from(schema.userWebauthnCredentials)
      .where(eq(schema.userWebauthnCredentials.credentialId, FAKE_CREDENTIAL_ID));
    expect(Number(row?.signCount)).toBe(42);
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it('rejects an assertion against an unknown credential id with generic error', async () => {
    const userId = await seedUserWithCredential({
      email: 'u@e.com',
      credentialId: FAKE_CREDENTIAL_ID,
      signCount: 0,
    });
    const { finishAssertion } = await import('@/lib/auth/webauthn');
    const result = await finishAssertion({
      userId,
      response: { id: 'unknown-credential' } as never,
      expectedChallenge: 'fake-assert-challenge',
      db,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('unknown credential');
  });

  it('rejects an assertion targeting another user', async () => {
    await seedUserWithCredential({
      email: 'a@e.com',
      credentialId: FAKE_CREDENTIAL_ID,
      signCount: 0,
    });
    const userB = await seedUserWithCredential({
      email: 'b@e.com',
      credentialId: 'b-cred',
      signCount: 0,
    });
    const { finishAssertion } = await import('@/lib/auth/webauthn');
    const result = await finishAssertion({
      userId: userB,
      response: { id: FAKE_CREDENTIAL_ID } as never,
      expectedChallenge: 'fake-assert-challenge',
      db,
    });
    expect(result.ok).toBe(false);
  });

  it('verifier throw maps to generic verification-failed (no leak)', async () => {
    const userId = await seedUserWithCredential({
      email: 'u@e.com',
      credentialId: FAKE_CREDENTIAL_ID,
      signCount: 0,
    });
    const server = await import('@simplewebauthn/server');
    vi.mocked(server.verifyAuthenticationResponse).mockRejectedValueOnce(
      new Error('sign-count regression detected (sensitive detail)'),
    );
    const { finishAssertion } = await import('@/lib/auth/webauthn');
    const result = await finishAssertion({
      userId,
      response: { id: FAKE_CREDENTIAL_ID } as never,
      expectedChallenge: 'fake-assert-challenge',
      db,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('verification failed');
  });
});
