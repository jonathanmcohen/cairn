import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { type ApiKeyRow, ApiKeysManager } from '@/components/settings/api-keys-manager';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';

export default async function ApiKeysSettingsPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');
  // Key management is admin-only (matches the workspace-admin-configured spec).
  if (!hasMinRole(ctx.role, 'admin')) redirect('/');

  // Never select tokenHash — the plaintext is unrecoverable by design.
  const rows = await getDb()
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      tokenPrefix: schema.apiKeys.tokenPrefix,
      role: schema.apiKeys.role,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      expiresAt: schema.apiKeys.expiresAt,
      createdAt: schema.apiKeys.createdAt,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.apiKeys.createdAt));

  const initialKeys: ApiKeyRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    tokenPrefix: r.tokenPrefix,
    role: r.role,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-3xl font-semibold">API keys</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Keys authenticate requests to the <code>/api/v1</code> HTTP API via{' '}
        <code>Authorization: Bearer cairn_sk_…</code>. A key acts with the role you assign and on
        behalf of its creator. The full token is shown only once when created.
      </p>
      <ApiKeysManager initialKeys={initialKeys} />
    </div>
  );
}
