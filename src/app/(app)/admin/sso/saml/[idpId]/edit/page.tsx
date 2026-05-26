import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { SamlForm } from '@/components/admin/sso/saml-form';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export default async function EditSamlConfigPage(props: { params: Promise<{ idpId: string }> }) {
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
        eq(schema.idpConfigurations.type, 'saml'),
      ),
    )
    .limit(1);
  if (!row) notFound();
  const meta = (row.metadata ?? {}) as {
    idp?: { entityId?: string; ssoUrl?: string; x509Cert?: string };
  };
  const attr = (row.attributeMap ?? {}) as Record<string, string>;
  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">Edit SAML provider</h1>
      <SamlForm
        idpId={idpId}
        metadataUrl={`${origin.replace(/\/$/, '')}/api/sso/saml/metadata/${idpId}`}
        initial={{
          name: row.name,
          idpEntityId: meta.idp?.entityId ?? '',
          ssoUrl: meta.idp?.ssoUrl ?? '',
          x509Cert: '',
          emailAttr: attr.email ?? 'email',
          nameAttr: attr.name ?? 'name',
          enabled: row.enabled,
        }}
      />
    </div>
  );
}
