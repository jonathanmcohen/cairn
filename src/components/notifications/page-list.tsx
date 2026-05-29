'use client';

import { Check } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type SerializedNotification = {
  id: string;
  type: 'mention' | 'comment_reply' | 'reminder';
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

type FilterState = {
  type?: string[];
  status?: 'read' | 'unread' | 'all';
  dateFrom?: string; // ISO
  dateTo?: string; // ISO
};

type Initial = {
  notifications: SerializedNotification[];
  nextCursor: string | null;
};

const ALL_TYPES = ['mention', 'comment_reply'] as const;

function hrefFor(n: SerializedNotification): Route {
  const pageId = typeof n.payload.pageId === 'string' ? n.payload.pageId : undefined;
  const commentId = typeof n.payload.commentId === 'string' ? n.payload.commentId : undefined;
  if (!pageId) return '/notifications' as Route;
  if (!commentId) return `/pages/${pageId}` as Route;
  return `/pages/${pageId}#comment-${commentId}` as Route;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function describe(type: SerializedNotification['type']): string {
  if (type === 'mention') return 'Mentioned you in a comment';
  if (type === 'comment_reply') return 'Replied to your comment';
  return 'Reminder';
}

function buildQuery(filter: FilterState, cursor?: string | null): string {
  const params = new URLSearchParams();
  if (filter.type) for (const t of filter.type) params.append('type', t);
  if (filter.status) params.set('status', filter.status);
  if (filter.dateFrom) params.set('dateFrom', filter.dateFrom);
  if (filter.dateTo) params.set('dateTo', filter.dateTo);
  if (cursor) params.set('cursor', cursor);
  params.set('limit', '25');
  return params.toString();
}

type FeedResponse = {
  notifications: SerializedNotification[];
  nextCursor?: string;
};

/**
 * Server-rendered initial list + client-side filter form + load-more.
 * Filter changes drive `router.replace` so refreshing / sharing the URL
 * preserves them, and each filter mutation resets the keyset cursor to start
 * pagination over from page 1 of the new filter.
 */
export function NotificationsPageList({
  initial,
  initialFilter,
}: {
  initial: Initial;
  initialFilter: FilterState;
}): React.ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const statusId = useId();
  const fromId = useId();
  const toId = useId();
  const [items, setItems] = useState<SerializedNotification[]>(initial.notifications);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [filter, setFilter] = useState<FilterState>(initialFilter);
  const [, startTransition] = useTransition();
  const [loadingMore, setLoadingMore] = useState(false);

  const applyFilter = useCallback(
    (next: FilterState) => {
      setFilter(next);
      setCursor(null);
      const query = buildQuery(next);
      startTransition(() => {
        router.replace(`${pathname}?${query}` as Route, { scroll: false });
      });
      void (async () => {
        const res = await fetch(`/api/notifications?${query}`, { credentials: 'include' });
        if (!res.ok) return;
        const body = (await res.json()) as FeedResponse;
        setItems(body.notifications ?? []);
        setCursor(body.nextCursor ?? null);
      })();
    },
    [pathname, router],
  );

  const onLoadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/notifications?${buildQuery(filter, cursor)}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const body = (await res.json()) as FeedResponse;
      setItems((prev) => [...prev, ...(body.notifications ?? [])]);
      setCursor(body.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, filter, loadingMore]);

  const onMarkRead = useCallback(async (id: string) => {
    const res = await fetch(`/api/notifications/${id}/read`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return;
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
  }, []);

  return (
    <>
      <fieldset className="mb-4 flex flex-wrap items-end gap-3 rounded border p-3">
        <legend className="px-1 font-medium text-muted-foreground text-xs">Filter</legend>

        <div>
          <label htmlFor={statusId} className="block text-xs">
            Status
          </label>
          <Select
            value={filter.status ?? 'all'}
            onValueChange={(next) =>
              applyFilter({ ...filter, status: next as FilterState['status'] })
            }
          >
            <SelectTrigger id={statusId} aria-label="Status" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="read">Read</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <span className="block text-xs">Type</span>
          <div className="flex gap-1">
            {ALL_TYPES.map((t) => {
              const selected = filter.type?.includes(t) ?? false;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    const next = new Set(filter.type ?? []);
                    if (next.has(t)) next.delete(t);
                    else next.add(t);
                    applyFilter({
                      ...filter,
                      type: next.size === 0 ? undefined : Array.from(next),
                    });
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm transition-colors',
                    selected
                      ? 'border-transparent bg-primary text-primary-foreground'
                      : 'border-input bg-background text-muted-foreground hover:bg-accent',
                  )}
                >
                  {t === 'mention' ? 'Mentions' : 'Replies'}
                </button>
              );
            })}
          </div>
        </div>

        <DateField
          id={fromId}
          label="From"
          value={filter.dateFrom?.slice(0, 10) ?? ''}
          onChange={(next) =>
            applyFilter({
              ...filter,
              dateFrom: next ? new Date(`${next}T00:00:00Z`).toISOString() : undefined,
            })
          }
        />

        <DateField
          id={toId}
          label="To"
          value={filter.dateTo?.slice(0, 10) ?? ''}
          onChange={(next) =>
            applyFilter({
              ...filter,
              dateTo: next ? new Date(`${next}T00:00:00Z`).toISOString() : undefined,
            })
          }
        />
      </fieldset>

      <ul className="divide-y rounded border">
        {items.map((n) => (
          <li key={n.id} className="flex items-start gap-2 p-3 hover:bg-accent">
            <Link href={hrefFor(n)} className="flex-1 truncate">
              <span className="block truncate">{describe(n.type)}</span>
              <span className="text-muted-foreground text-xs">{relativeTime(n.createdAt)}</span>
            </Link>
            {n.readAt == null && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Mark as read"
                onClick={() => void onMarkRead(n.id)}
                className="h-11 w-11"
              >
                <Check aria-hidden="true" className="h-4 w-4" />
              </Button>
            )}
          </li>
        ))}
        {items.length === 0 && (
          <li className="p-8 text-center text-muted-foreground text-sm">
            No notifications match the current filter.
          </li>
        )}
      </ul>

      {cursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={() => void onLoadMore()}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </>
  );
}
