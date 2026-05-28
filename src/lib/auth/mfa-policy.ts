/**
 * v0.9.0 G1 P8 — admin-enforce gate.
 *
 * If any workspace the user belongs to has `require_mfa = true` AND the user
 * has no enrolled method from that workspace's `methods` allow-list, sign-in
 * is blocked. The gate runs after password verification in the Credentials
 * authorize callback (src/lib/auth/config.ts).
 *
 * Empty `methods` is treated as the default `['totp', 'webauthn']`
 * (defense-in-depth — the API forbids empty arrays, but a stale row from
 * an upgrade path could exist).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type MfaCheckResult =
  | { ok: true }
  | { ok: false; code: 'mfa-enrollment-required'; status: 403; workspaceIds: string[] };

const DEFAULT_METHODS = ['totp', 'webauthn'] as const;

export async function checkMfaEnrollmentForSignIn(
  db: Db,
  input: { userId: string },
): Promise<MfaCheckResult> {
  const memberWorkspaces = await db
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, input.userId));
  if (memberWorkspaces.length === 0) return { ok: true };

  const ids = memberWorkspaces.map((r) => r.workspaceId);
  const policies = await db
    .select()
    .from(schema.workspaceMfaPolicies)
    .where(
      and(
        inArray(schema.workspaceMfaPolicies.workspaceId, ids),
        eq(schema.workspaceMfaPolicies.requireMfa, true),
      ),
    );
  if (policies.length === 0) return { ok: true };

  // Enrolled methods (read once, even when there are many policies).
  const [totpRow] = await db
    .select()
    .from(schema.userTotp)
    .where(eq(schema.userTotp.userId, input.userId))
    .limit(1);
  const enrolledTotp = totpRow?.enabledAt != null;
  const [webauthnRow] = await db
    .select({ id: schema.userWebauthnCredentials.id })
    .from(schema.userWebauthnCredentials)
    .where(eq(schema.userWebauthnCredentials.userId, input.userId))
    .limit(1);
  const enrolledWebauthn = Boolean(webauthnRow);

  const failing = policies.filter((p) => {
    const methods = p.methods && p.methods.length > 0 ? p.methods : [...DEFAULT_METHODS];
    const acceptedTotp = methods.includes('totp') && enrolledTotp;
    const acceptedWebauthn = methods.includes('webauthn') && enrolledWebauthn;
    return !acceptedTotp && !acceptedWebauthn;
  });
  if (failing.length === 0) return { ok: true };
  return {
    ok: false,
    code: 'mfa-enrollment-required',
    status: 403,
    workspaceIds: failing.map((p) => p.workspaceId),
  };
}
