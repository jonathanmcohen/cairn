import { desc, eq } from 'drizzle-orm';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { PasskeyEnrollment } from '@/components/security/passkey-enrollment';
import { PasskeyListItem } from '@/components/security/passkey-list-item';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { auth } from '@/lib/auth/config';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * v0.9.0 G1 P8 — passkey enrollment page.
 *
 * Lists the user's registered passkeys, exposes the add + remove flows.
 * Bails to a "WebAuthn not configured" notice when CAIRN_RP_ID is unset,
 * so a self-hoster who hasn't opted in sees a clean explanation instead
 * of a broken enroll button.
 */
export default async function PasskeysSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const e = env();
  if (!e.CAIRN_RP_ID || !e.CAIRN_RP_ORIGIN) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <SettingsBreadcrumb
          section={{ label: 'Security', href: '/settings/security' as Route }}
          page="Passkeys"
        />
        <h1 className="font-semibold text-2xl">Passkeys</h1>
        <div className="rounded border p-4 text-muted-foreground text-sm">
          The operator of this Cairn instance has not configured WebAuthn. Set
          <code className="mx-1 rounded bg-muted px-1">CAIRN_RP_ID</code>+
          <code className="mx-1 rounded bg-muted px-1">CAIRN_RP_ORIGIN</code> in the deployment env
          to enable passkey enrollment. See <code>docs/operations.md</code>.
        </div>
      </main>
    );
  }

  const db = getDb();
  const rows = await db
    .select({
      id: schema.userWebauthnCredentials.id,
      nickname: schema.userWebauthnCredentials.nickname,
      createdAt: schema.userWebauthnCredentials.createdAt,
      lastUsedAt: schema.userWebauthnCredentials.lastUsedAt,
    })
    .from(schema.userWebauthnCredentials)
    .where(eq(schema.userWebauthnCredentials.userId, session.user.id))
    .orderBy(desc(schema.userWebauthnCredentials.createdAt));

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <SettingsBreadcrumb
        section={{ label: 'Security', href: '/settings/security' as Route }}
        page="Passkeys"
      />
      <h1 className="font-semibold text-2xl">Passkeys</h1>
      <p className="text-muted-foreground text-sm">
        Add a hardware key, platform authenticator, or browser-managed passkey. They sign you in
        without a password and are used for step-up confirmation on destructive actions.
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">You have no passkeys yet.</p>
      ) : (
        <ul aria-label="Registered passkeys">
          {rows.map((r) => (
            <PasskeyListItem
              key={r.id}
              id={r.id}
              nickname={r.nickname}
              createdAt={r.createdAt.toISOString()}
              lastUsedAt={r.lastUsedAt ? r.lastUsedAt.toISOString() : null}
            />
          ))}
        </ul>
      )}
      <PasskeyEnrollment />
    </main>
  );
}
