import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { reconcileQuota } from './quota';

export async function reconcileAll(
  workspaceId?: string,
): Promise<Array<{ workspaceId: string; storageBytesUsed: number }>> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for reconcile');
  const sql = postgres(url);
  try {
    const db = drizzle(sql, { schema });
    const ids: string[] = workspaceId
      ? [workspaceId]
      : (await db.select({ id: schema.workspaces.id }).from(schema.workspaces)).map((r) => r.id);
    const results: Array<{ workspaceId: string; storageBytesUsed: number }> = [];
    for (const id of ids) {
      const storageBytesUsed = await reconcileQuota(db, id);
      results.push({ workspaceId: id, storageBytesUsed });
    }
    return results;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
