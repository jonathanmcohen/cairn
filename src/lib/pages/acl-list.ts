import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type PageAclListItem = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  permission: 'view' | 'comment' | 'edit' | 'owner';
};

/**
 * List the explicit ACL grants pinned on a single page, joined to the granted
 * user's name/email/image. Ordered by user name for a stable UI. Does NOT
 * include inherited (role-based or ancestor) permissions — only rows that
 * physically exist in page_acls for this exact page.
 */
export async function listPageAcls(
  db: PostgresJsDatabase<typeof schema>,
  pageId: string,
): Promise<PageAclListItem[]> {
  const rows = await db
    .select({
      userId: schema.pageAcls.userId,
      name: schema.users.name,
      email: schema.users.email,
      image: schema.users.image,
      permission: schema.pageAcls.permission,
    })
    .from(schema.pageAcls)
    .innerJoin(schema.users, eq(schema.users.id, schema.pageAcls.userId))
    .where(eq(schema.pageAcls.pageId, pageId))
    .orderBy(asc(schema.users.name));

  return rows.flatMap((r) => {
    if (
      r.permission !== 'view' &&
      r.permission !== 'comment' &&
      r.permission !== 'edit' &&
      r.permission !== 'owner'
    ) {
      return [];
    }
    return [
      {
        userId: r.userId,
        name: r.name ?? '',
        email: r.email,
        image: r.image,
        permission: r.permission,
      },
    ];
  });
}
