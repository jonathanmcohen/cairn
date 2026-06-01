import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { OidcForm } from '@/components/admin/sso/oidc-form';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export default async function EditOidcConfigPage(props: { params: Promise<{ idpId: string }> }) {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) redirect('/');
  const { idpId } = await props.params;
  const [row] = await getDb()
    .select()
    .from(schema.idpConfigurations)
    .where(
      and(
        eq(schema.idpConfigurations.id, idpId),
        eq(schema.idpConfigurations.workspaceId, ctx.workspaceId),
        eq(schema.idpConfigurations.type, 'oidc'),
      ),
    )
    .limit(1);
  if (!row) notFound();
  const meta = (row.metadata ?? {}) as Record<string, string>;
  const attr = (row.attributeMap ?? {}) as Record<string, string>;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">Edit OIDC provider</h1>
      <OidcForm
        idpId={idpId}
        initial={{
          name: row.name,
          issuer: meta.issuer ?? '',
          clientId: meta.clientId ?? '',
          clientSecret: '',
          emailClaim: attr.email ?? 'email',
          nameClaim: attr.name ?? 'name',
          enabled: row.enabled,
        }}
      />
    </div>
  );
}
