import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { auth } from '@/lib/auth/config';
import { duplicatePublicPage } from '@/lib/pages/duplicate';

type RouteCtx = { params: Promise<{ pageId: string }> };

/**
 * Public "Duplicate to my workspace" action. Anonymous visitors are bounced to
 * sign-in (returning here afterward). Signed-in users get the subtree deep-copied
 * into their first writable (owner/admin/editor) workspace, then are sent to the
 * new private copy. The duplicability gate lives in `duplicatePublicPage`.
 */
export async function POST(_req: Request, { params }: RouteCtx): Promise<Response> {
  const { pageId } = await params;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    const next = encodeURIComponent(`/api/pages/${pageId}/duplicate-public`);
    redirect(`/login?next=${next}` as Route);
  }

  const db = getDb();
  const [membership] = await db
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.userId, userId),
        inArray(schema.workspaceMembers.role, ['owner', 'admin', 'editor']),
      ),
    )
    .orderBy(asc(schema.workspaceMembers.joinedAt))
    .limit(1);

  if (!membership) {
    redirect('/' as Route);
  }

  const newId = await duplicatePublicPage(db, {
    sourcePageId: pageId,
    intoWorkspaceId: membership.workspaceId,
    actorUserId: userId,
  });

  redirect(`/pages/${newId}` as Route);
}
