import { notFound } from 'next/navigation';
import { FullPageDatabase } from '@/components/databases/full-page-database';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { getDatabaseWithMeta } from '@/lib/databases/get';

export default async function DatabasePage({
  params,
}: {
  params: Promise<{ databaseId: string }>;
}) {
  const { databaseId } = await params;
  const ctx = await requireRole('viewer');
  // Cross-workspace access returns 404 (not 403) to avoid leaking existence,
  // matching requirePageAccess. getDatabaseWithMeta returns null when the
  // database belongs to another workspace.
  const meta = await getDatabaseWithMeta(getDb(), {
    databaseId,
    workspaceId: ctx.workspaceId,
  });
  if (!meta) notFound();
  return <FullPageDatabase databaseId={databaseId} />;
}
