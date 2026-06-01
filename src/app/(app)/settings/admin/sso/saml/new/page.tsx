import { redirect } from 'next/navigation';
import { SamlForm } from '@/components/admin/sso/saml-form';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export default async function NewSamlConfigPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">New SAML provider</h1>
      <SamlForm />
    </div>
  );
}
