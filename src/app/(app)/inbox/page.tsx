import { and, asc, eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { type InboxItem, InboxTriageList } from '@/components/inbox/inbox-triage-list';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext } from '@/lib/auth/require-role';
import { ensureInboxPage } from '@/lib/inbox/lazy-page';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.userId) redirect('/login');
  const db = getDb();

  // Lazy-create the inbox page on first visit so the surface always works
  // even before the user's first capture.
  const inboxPageId = await ensureInboxPage(db, {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });

  // metadata->>'inbox' = 'true' filters to still-untriaged captures.
  const rows = await db
    .select({
      id: schema.pages.id,
      title: schema.pages.title,
      metadata: schema.pages.metadata,
    })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.workspaceId, ctx.workspaceId),
        eq(schema.pages.parentId, inboxPageId),
        sql`(${schema.pages.metadata} ->> 'inbox') = 'true'`,
      ),
    )
    .orderBy(asc(schema.pages.createdAt));

  const items: InboxItem[] = rows.map((r) => {
    const meta = (r.metadata ?? {}) as { capturedAt?: string; sourceUrl?: string };
    return {
      id: r.id,
      title: r.title,
      capturedAt: meta.capturedAt ?? new Date().toISOString(),
      sourceUrl: meta.sourceUrl ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-3xl font-semibold">Inbox</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Quick captures land here. Drag a row into a folder, or mark it done to leave it in place.
      </p>
      <InboxTriageList items={items} />
    </div>
  );
}
