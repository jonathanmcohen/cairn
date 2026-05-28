/**
 * v0.9.0 G1 P8 — admin-enforce sign-in gate.
 *
 * checkMfaEnrollmentForSignIn returns ok=true unless at least one of the
 * user's member workspaces has require_mfa=true AND the user lacks any
 * enrolled method allowed by that workspace's `methods` list.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { checkMfaEnrollmentForSignIn } from '@/lib/auth/mfa-policy';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

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
  await sql`TRUNCATE workspace_mfa_policies, user_webauthn_credentials, user_totp, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

describe('checkMfaEnrollmentForSignIn', () => {
  it('passes when the user belongs to no workspace', async () => {
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'orphan@e.com', passwordHash: 'h', name: 'O' })
      .returning({ id: schema.users.id });
    const out = await checkMfaEnrollmentForSignIn(db, { userId: u!.id });
    expect(out).toEqual({ ok: true });
  });

  it('passes when no member workspace requires MFA', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const out = await checkMfaEnrollmentForSignIn(db, { userId: u.userId });
    expect(out).toEqual({ ok: true });
  });

  it('rejects when a member workspace requires MFA and user has no method', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db.insert(schema.workspaceMfaPolicies).values({
      workspaceId: u.workspaceId,
      requireMfa: true,
      methods: ['totp', 'webauthn'],
    });
    const out = await checkMfaEnrollmentForSignIn(db, { userId: u.userId });
    expect(out).toMatchObject({ ok: false, code: 'mfa-enrollment-required', status: 403 });
    if (!out.ok) expect(out.workspaceIds).toEqual([u.workspaceId]);
  });

  it('passes when user has TOTP enrolled and policy accepts TOTP', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db.insert(schema.workspaceMfaPolicies).values({
      workspaceId: u.workspaceId,
      requireMfa: true,
      methods: ['totp', 'webauthn'],
    });
    await db.insert(schema.userTotp).values({
      userId: u.userId,
      secretEncrypted: Buffer.from([1, 2]),
      recoveryCodes: [],
      enabledAt: new Date(),
    });
    const out = await checkMfaEnrollmentForSignIn(db, { userId: u.userId });
    expect(out).toEqual({ ok: true });
  });

  it('passes when user has WebAuthn enrolled and policy accepts WebAuthn', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db.insert(schema.workspaceMfaPolicies).values({
      workspaceId: u.workspaceId,
      requireMfa: true,
      methods: ['webauthn'],
    });
    await db.insert(schema.userWebauthnCredentials).values({
      userId: u.userId,
      credentialId: 'cred-x',
      publicKey: Buffer.from([1]),
      signCount: 0,
      nickname: 'k',
    });
    const out = await checkMfaEnrollmentForSignIn(db, { userId: u.userId });
    expect(out).toEqual({ ok: true });
  });

  it('rejects when policy restricts to webauthn and user has only TOTP', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db.insert(schema.workspaceMfaPolicies).values({
      workspaceId: u.workspaceId,
      requireMfa: true,
      methods: ['webauthn'],
    });
    await db.insert(schema.userTotp).values({
      userId: u.userId,
      secretEncrypted: Buffer.from([1, 2]),
      recoveryCodes: [],
      enabledAt: new Date(),
    });
    const out = await checkMfaEnrollmentForSignIn(db, { userId: u.userId });
    expect(out).toMatchObject({ ok: false, code: 'mfa-enrollment-required' });
  });

  it('passes when TOTP exists but is NOT confirmed (enabledAt is null)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db.insert(schema.workspaceMfaPolicies).values({
      workspaceId: u.workspaceId,
      requireMfa: true,
      methods: ['totp'],
    });
    await db.insert(schema.userTotp).values({
      userId: u.userId,
      secretEncrypted: Buffer.from([1, 2]),
      recoveryCodes: [],
      enabledAt: null, // pending — not enrolled
    });
    const out = await checkMfaEnrollmentForSignIn(db, { userId: u.userId });
    expect(out).toMatchObject({ ok: false, code: 'mfa-enrollment-required' });
  });
});
