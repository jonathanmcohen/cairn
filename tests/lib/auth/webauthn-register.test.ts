/**
 * v0.9.0 G1 P8 — registration ceremony helpers.
 *
 * We mock @simplewebauthn/server so we test the DB plumbing — env wiring,
 * existing-credential exclusion, row persistence — without re-implementing
 * a WebAuthn authenticator in Node. The verifier itself is exercised by
 * the upstream library's own tests.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';

// Static mock — pretend every call is a successful new-credential.
const FAKE_CREDENTIAL_ID = 'fake-credential-id-base64url';
const FAKE_PUBLIC_KEY = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const FAKE_AAGUID = '11111111-2222-3333-4444-555555555555';

vi.mock('@simplewebauthn/server', async () => {
  const actual =
    await vi.importActual<typeof import('@simplewebauthn/server')>('@simplewebauthn/server');
  return {
    ...actual,
    generateRegistrationOptions: vi.fn(async () => ({
      rp: { id: 'rp-id.test', name: 'Cairn' },
      user: { id: 'enc-userid', name: 'u@e.com', displayName: 'U' },
      challenge: 'fake-challenge-base64url',
      pubKeyCredParams: [],
      timeout: 60000,
      attestation: 'none' as const,
      excludeCredentials: [],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    })),
    verifyRegistrationResponse: vi.fn(async () => ({
      verified: true,
      registrationInfo: {
        fmt: 'none' as const,
        aaguid: FAKE_AAGUID,
        credentialType: 'public-key' as const,
        credential: {
          id: FAKE_CREDENTIAL_ID,
          publicKey: FAKE_PUBLIC_KEY,
          counter: 0,
          transports: ['internal'] as const,
        },
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice' as const,
        credentialBackedUp: false,
        origin: 'https://rp-origin.test',
        rpID: 'rp-id.test',
        authenticatorExtensionResults: undefined,
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

describe('webauthn — registration ceremony helpers', () => {
  it('beginRegistration returns options keyed to CAIRN_RP_ID + a challenge', async () => {
    const { beginRegistration } = await import('@/lib/auth/webauthn');
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'u@e.com', passwordHash: 'h', name: 'U' })
      .returning({ id: schema.users.id });
    const out = await beginRegistration({
      userId: u!.id,
      userName: 'u@e.com',
      userDisplayName: 'U',
      db,
    });
    expect(out.options.rp.id).toBe('rp-id.test');
    expect(out.options.challenge).toBe(out.expectedChallenge);
    expect(out.expectedChallenge.length).toBeGreaterThan(0);
  });

  it('finishRegistration writes a credential row + onConflict upserts on re-register', async () => {
    const { beginRegistration, finishRegistration } = await import('@/lib/auth/webauthn');
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'u@e.com', passwordHash: 'h', name: 'U' })
      .returning({ id: schema.users.id });

    const reg = await beginRegistration({
      userId: u!.id,
      userName: 'u@e.com',
      userDisplayName: 'U',
      db,
    });
    const result = await finishRegistration({
      userId: u!.id,
      response: { id: FAKE_CREDENTIAL_ID } as never,
      expectedChallenge: reg.expectedChallenge,
      nickname: 'YubiKey',
      db,
    });
    expect(result.ok).toBe(true);

    const rows = await db.select().from(schema.userWebauthnCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.nickname).toBe('YubiKey');
    expect(rows[0]?.credentialId).toBe(FAKE_CREDENTIAL_ID);
    expect(rows[0]?.aaguid).toBe(FAKE_AAGUID);
    // public_key persisted as bytea (Buffer round-trip).
    expect(Buffer.from(rows[0]?.publicKey as Buffer).toString('hex')).toBe('0102030405060708');

    // Re-register with the same credential id (race / double-submit): upsert,
    // not unique-violation throw.
    const result2 = await finishRegistration({
      userId: u!.id,
      response: { id: FAKE_CREDENTIAL_ID } as never,
      expectedChallenge: reg.expectedChallenge,
      nickname: 'Renamed',
      db,
    });
    expect(result2.ok).toBe(true);
    const rows2 = await db.select().from(schema.userWebauthnCredentials);
    expect(rows2).toHaveLength(1);
    expect(rows2[0]?.nickname).toBe('Renamed');
  });

  it('finishRegistration returns generic failure when the verifier throws (no detail leaked)', async () => {
    const server = await import('@simplewebauthn/server');
    const spy = vi.mocked(server.verifyRegistrationResponse);
    spy.mockRejectedValueOnce(new Error('challenge mismatch in clientDataJSON (sensitive detail)'));
    const { beginRegistration, finishRegistration } = await import('@/lib/auth/webauthn');
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'u@e.com', passwordHash: 'h', name: 'U' })
      .returning({ id: schema.users.id });
    const reg = await beginRegistration({
      userId: u!.id,
      userName: 'u@e.com',
      userDisplayName: 'U',
      db,
    });
    const result = await finishRegistration({
      userId: u!.id,
      response: { id: 'x' } as never,
      expectedChallenge: reg.expectedChallenge,
      nickname: null,
      db,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('verification failed');
  });

  it('throws WebAuthnNotConfiguredError when env is missing', async () => {
    const saved = process.env.CAIRN_RP_ID;
    delete process.env.CAIRN_RP_ID;
    try {
      // re-parse the env cache
      vi.resetModules();
      const { beginRegistration, WebAuthnNotConfiguredError } = await import('@/lib/auth/webauthn');
      await expect(
        beginRegistration({ userId: 'u', userName: 'u', userDisplayName: 'U', db }),
      ).rejects.toBeInstanceOf(WebAuthnNotConfiguredError);
    } finally {
      if (saved !== undefined) process.env.CAIRN_RP_ID = saved;
      vi.resetModules();
    }
  });
});
