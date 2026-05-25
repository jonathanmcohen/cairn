import { redirect } from 'next/navigation';
import { NotificationsPageList } from '@/components/notifications/page-list';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { listNotifications, type NotificationFilter } from '@/lib/notifications/list';

type SearchParams = Record<string, string | string[] | undefined>;

const ALLOWED_TYPES = new Set<NonNullable<NotificationFilter['type']>[number]>([
  'mention',
  'comment_reply',
  'reminder',
]);

function parseFilter(sp: SearchParams): NotificationFilter {
  const rawType = Array.isArray(sp.type) ? sp.type : sp.type ? [sp.type] : undefined;
  const type = rawType?.filter((t): t is NonNullable<NotificationFilter['type']>[number] =>
    ALLOWED_TYPES.has(t as NonNullable<NotificationFilter['type']>[number]),
  );
  const statusRaw = typeof sp.status === 'string' ? sp.status : undefined;
  const status =
    statusRaw === 'read' || statusRaw === 'unread' || statusRaw === 'all' ? statusRaw : undefined;
  const dateFrom = typeof sp.dateFrom === 'string' ? new Date(sp.dateFrom) : undefined;
  const dateTo = typeof sp.dateTo === 'string' ? new Date(sp.dateTo) : undefined;
  return {
    type: type && type.length > 0 ? type : undefined,
    status,
    dateFrom: dateFrom && !Number.isNaN(dateFrom.getTime()) ? dateFrom : undefined,
    dateTo: dateTo && !Number.isNaN(dateTo.getTime()) ? dateTo : undefined,
  };
}

export const dynamic = 'force-dynamic';

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactNode> {
  const ctx = await getAuthContext();
  if (!ctx?.userId || !ctx.workspaceId) redirect('/login');
  const sp = await searchParams;
  const filter = parseFilter(sp);
  const initial = await listNotifications(getDb(), {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    limit: 25,
    filter,
  });

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="font-semibold text-2xl">Notifications</h1>
        <p className="text-muted-foreground text-sm">
          All your inbox events. Filter and triage from here.
        </p>
      </header>
      <NotificationsPageList
        initial={{
          notifications: initial.notifications.map((n) => ({
            id: n.id,
            type: n.type as 'mention' | 'comment_reply' | 'reminder',
            payload: (n.payload ?? {}) as Record<string, unknown>,
            readAt: n.readAt ? n.readAt.toISOString() : null,
            createdAt: n.createdAt.toISOString(),
          })),
          nextCursor: initial.nextCursor,
        }}
        initialFilter={{
          type: filter.type ? [...filter.type] : undefined,
          status: filter.status,
          dateFrom: filter.dateFrom?.toISOString(),
          dateTo: filter.dateTo?.toISOString(),
        }}
      />
    </main>
  );
}
