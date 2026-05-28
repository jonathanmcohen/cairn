/**
 * v0.9.0 G1 P8 — WebAuthn registration + assertion ceremony helpers.
 *
 * Wraps @simplewebauthn/server with a Cairn-specific contract:
 *   - Reads CAIRN_RP_ID / CAIRN_RP_NAME / CAIRN_RP_ORIGIN from env() (lazy).
 *   - Excludes already-enrolled credentials on register.
 *   - Persists the credential row inside the transaction the caller drives.
 *   - Bumps sign_count + last_used_at on every successful assertion (anti-cloning).
 *
 * The cryptographic verifiers stay in @simplewebauthn/server — this module is
 * purely DB + env plumbing.
 */

import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';

type Db = PostgresJsDatabase<typeof schema>;

export class WebAuthnNotConfiguredError extends Error {
  constructor() {
    super('WebAuthn is not configured (CAIRN_RP_ID / CAIRN_RP_ORIGIN unset)');
  }
}

/** Read + assert RP env at call time so dev/tooling builds don't error early. */
export function requireRpEnv(): { rpId: string; rpName: string; rpOrigin: string } {
  const e = env();
  if (!e.CAIRN_RP_ID || !e.CAIRN_RP_ORIGIN) throw new WebAuthnNotConfiguredError();
  return { rpId: e.CAIRN_RP_ID, rpName: e.CAIRN_RP_NAME, rpOrigin: e.CAIRN_RP_ORIGIN };
}

export type BeginRegistrationInput = {
  userId: string;
  userName: string;
  userDisplayName: string;
  db?: Db;
};

export type BeginRegistrationOutput = {
  options: PublicKeyCredentialCreationOptionsJSON;
  expectedChallenge: string;
};

export async function beginRegistration(
  input: BeginRegistrationInput,
): Promise<BeginRegistrationOutput> {
  const { rpId, rpName } = requireRpEnv();
  const db = input.db ?? getDb();
  const existing = await db
    .select({
      credentialId: schema.userWebauthnCredentials.credentialId,
      transports: schema.userWebauthnCredentials.transports,
    })
    .from(schema.userWebauthnCredentials)
    .where(eq(schema.userWebauthnCredentials.userId, input.userId));
  const options = await generateRegistrationOptions({
    rpID: rpId,
    rpName,
    userID: new TextEncoder().encode(input.userId),
    userName: input.userName,
    userDisplayName: input.userDisplayName,
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    attestationType: 'none',
  });
  return { options, expectedChallenge: options.challenge };
}

export type FinishRegistrationInput = {
  userId: string;
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  nickname: string | null;
  db?: Db;
};

export type FinishRegistrationResult =
  | { ok: true; credentialId: string }
  | { ok: false; error: string };

export async function finishRegistration(
  input: FinishRegistrationInput,
): Promise<FinishRegistrationResult> {
  const { rpId, rpOrigin } = requireRpEnv();
  const db = input.db ?? getDb();
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: rpOrigin,
      expectedRPID: rpId,
      requireUserVerification: false,
    });
  } catch (err) {
    // Surface a generic error to the API boundary; details to logs only
    // (retro §5 — never let the verifier exception message leak to clients).
    console.error('[webauthn] verifyRegistrationResponse threw', err);
    return { ok: false, error: 'verification failed' };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: 'verification failed' };
  }
  const info = verification.registrationInfo;
  // Race-safe upsert: a re-register with the same credential id (rare; happens
  // when a user enrolls the same key twice or rapid double-submits) replaces
  // rather than throwing on the unique constraint.
  await db
    .insert(schema.userWebauthnCredentials)
    .values({
      userId: input.userId,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey),
      signCount: info.credential.counter,
      transports: info.credential.transports ?? null,
      aaguid:
        info.aaguid && info.aaguid !== '00000000-0000-0000-0000-000000000000' ? info.aaguid : null,
      nickname: input.nickname,
    })
    .onConflictDoUpdate({
      target: schema.userWebauthnCredentials.credentialId,
      set: {
        userId: input.userId,
        publicKey: Buffer.from(info.credential.publicKey),
        signCount: info.credential.counter,
        transports: info.credential.transports ?? null,
        nickname: input.nickname,
      },
    });
  return { ok: true, credentialId: info.credential.id };
}

export type BeginAssertionInput = { userId: string; db?: Db };
export type BeginAssertionOutput = {
  options: PublicKeyCredentialRequestOptionsJSON;
  expectedChallenge: string;
};

export async function beginAssertion(input: BeginAssertionInput): Promise<BeginAssertionOutput> {
  const { rpId } = requireRpEnv();
  const db = input.db ?? getDb();
  const allowList = await db
    .select({
      credentialId: schema.userWebauthnCredentials.credentialId,
      transports: schema.userWebauthnCredentials.transports,
    })
    .from(schema.userWebauthnCredentials)
    .where(eq(schema.userWebauthnCredentials.userId, input.userId));
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials: allowList.map((c) => ({
      id: c.credentialId,
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    userVerification: 'preferred',
  });
  return { options, expectedChallenge: options.challenge };
}

export type FinishAssertionInput = {
  userId: string;
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  db?: Db;
};

export type FinishAssertionResult =
  | { ok: true; credentialId: string }
  | { ok: false; error: string };

export async function finishAssertion(input: FinishAssertionInput): Promise<FinishAssertionResult> {
  const { rpId, rpOrigin } = requireRpEnv();
  const db = input.db ?? getDb();
  const [cred] = await db
    .select()
    .from(schema.userWebauthnCredentials)
    .where(eq(schema.userWebauthnCredentials.credentialId, input.response.id))
    .limit(1);
  if (!cred || cred.userId !== input.userId) {
    return { ok: false, error: 'unknown credential' };
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: rpOrigin,
      expectedRPID: rpId,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(cred.publicKey),
        counter: Number(cred.signCount),
        transports: (cred.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
      },
      requireUserVerification: false,
    });
  } catch (err) {
    console.error('[webauthn] verifyAuthenticationResponse threw', err);
    return { ok: false, error: 'verification failed' };
  }
  if (!verification.verified) return { ok: false, error: 'verification failed' };

  await db
    .update(schema.userWebauthnCredentials)
    .set({
      signCount: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    })
    .where(eq(schema.userWebauthnCredentials.credentialId, cred.credentialId));
  return { ok: true, credentialId: cred.credentialId };
}

/** True iff the user has at least one registered passkey. */
export async function userHasWebauthnCredential(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.userWebauthnCredentials.id })
    .from(schema.userWebauthnCredentials)
    .where(eq(schema.userWebauthnCredentials.userId, userId))
    .limit(1);
  return Boolean(row);
}
