import { eq } from 'drizzle-orm';
import type { Route } from 'next';
import { MfaPolicyForm } from '@/components/admin/mfa-policy-form';
import { SettingsBreadcrumb } from '@/components/settings/breadcrumb';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

/**
 * v0.9.0 G1 P8 — admin MFA policy page.
 *
 * Admin-only. Renders the per-workspace MFA enforcement form.
 */
export default async function AdminMfaPolicyPage() {
  const ctx = await requireRole('admin');
  const [row] = await getDb()
    .select()
    .from(schema.workspaceMfaPolicies)
    .where(eq(schema.workspaceMfaPolicies.workspaceId, ctx.workspaceId))
    .limit(1);

  const methods = (row?.methods ?? ['totp', 'webauthn']).filter(
    (m): m is 'totp' | 'webauthn' => m === 'totp' || m === 'webauthn',
  );

  return (
    <section>
      <SettingsBreadcrumb
        section={{ label: 'Admin', href: '/settings/admin' as Route }}
        page="MFA"
      />
      <h1 className="mb-4 font-semibold text-xl">Workspace MFA policy</h1>
      <p className="mb-4 text-muted-foreground text-sm">
        When enabled, members without an enrolled method from the accepted list will be blocked at
        sign-in and redirected to the enrollment page. Members can enroll TOTP at{' '}
        <code>/settings/security</code> and passkeys at <code>/settings/security/passkeys</code>.
      </p>
      <MfaPolicyForm
        workspaceId={ctx.workspaceId}
        initial={{
          requireMfa: row?.requireMfa ?? false,
          methods: methods.length > 0 ? methods : ['totp', 'webauthn'],
        }}
      />
    </section>
  );
}
