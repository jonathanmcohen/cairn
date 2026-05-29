import { eq } from 'drizzle-orm';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext } from '@/lib/auth/require-role';

export default async function AccountProfilePage() {
  const ctx = await getAuthContext();
  if (!ctx?.userId) redirect('/login');

  // The JWT session only carries the user id (see auth/config.ts — the session
  // callback copies `token.id` only), so email + display name are read from the
  // users record rather than the session/auth context.
  const [user] = await getDb()
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, ctx.userId))
    .limit(1);

  return (
    <div>
      <SettingsBreadcrumb
        section={{ label: 'Account', href: '/settings/account' as Route }}
        page="Profile"
      />
      <h1 className="mb-2 text-2xl font-semibold">Profile</h1>
      <p className="text-sm text-muted-foreground">Your account profile.</p>
      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{user?.email ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Display name</dt>
          <dd>{user?.name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">User ID</dt>
          <dd className="font-mono">{ctx.userId}</dd>
        </div>
      </dl>
    </div>
  );
}
