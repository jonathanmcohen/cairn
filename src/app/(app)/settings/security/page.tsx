import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { auth } from '@/lib/auth/config';
import { isTwoFactorEnabled } from '@/lib/auth/two-factor';
import { TwoFactorCard } from './two-factor-card';

export default async function SecuritySettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const enabled = await isTwoFactorEnabled(getDb(), session.user.id);
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="font-semibold text-2xl">Security</h1>
      <TwoFactorCard initiallyEnabled={enabled} />
    </main>
  );
}
