import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const ctx = await requireRole('admin').catch(() => null);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await getDb()
    .select({
      id: schema.idpConfigurations.id,
      type: schema.idpConfigurations.type,
      name: schema.idpConfigurations.name,
      enabled: schema.idpConfigurations.enabled,
      createdAt: schema.idpConfigurations.createdAt,
    })
    .from(schema.idpConfigurations)
    .where(eq(schema.idpConfigurations.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.idpConfigurations.createdAt));
  return NextResponse.json({ items: rows });
}
