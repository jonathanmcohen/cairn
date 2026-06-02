import { redirect } from 'next/navigation';
import { OidcForm } from '@/components/admin/sso/oidc-form';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export default async function NewOidcConfigPage() {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">New OIDC provider</h1>
      <OidcForm />
    </div>
  );
}
