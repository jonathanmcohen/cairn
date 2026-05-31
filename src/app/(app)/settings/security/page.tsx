import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { E2EEnrollCard } from '@/components/security/e2e-enroll-card';
import { PasskeysCard } from '@/components/security/passkeys-card';
import { SessionsCard } from '@/components/security/sessions-card';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import { auth } from '@/lib/auth/config';
import { isTwoFactorEnabled } from '@/lib/auth/two-factor';
import { env } from '@/lib/env';
import { TwoFactorCard } from './two-factor-card';

export default async function SecuritySettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const enabled = await isTwoFactorEnabled(getDb(), session.user.id);
  const e2eFlagOn = env().NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION;
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <SettingsBreadcrumb
        section={{ label: 'Security', href: '/settings/security' as Route }}
        page="Two-factor authentication"
      />
      <h1 className="font-semibold text-2xl">Security</h1>
      <TwoFactorCard initiallyEnabled={enabled} />
      <PasskeysCard />
      <SessionsCard />
      {e2eFlagOn ? <E2EEnrollCard /> : null}
    </main>
  );
}
