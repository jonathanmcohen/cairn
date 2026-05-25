import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getAuthContext } from '@/lib/auth/require-role';

export default async function AccountProfilePage() {
  const ctx = await getAuthContext();
  if (!ctx?.userId) redirect('/login');

  return (
    <div>
      <SettingsBreadcrumb
        section={{ label: 'Account', href: '/settings/account' as Route }}
        page="Profile"
      />
      <h1 className="mb-2 text-2xl font-semibold">Profile</h1>
      <p className="text-sm text-muted-foreground">
        Your account profile. Email and display name come from your authentication provider.
      </p>
      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">User ID</dt>
          <dd className="font-mono">{ctx.userId}</dd>
        </div>
      </dl>
    </div>
  );
}
