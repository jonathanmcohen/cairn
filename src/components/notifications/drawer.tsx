'use client';

import { Check, Loader2, X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { useFocusTrap } from '@/lib/a11y/focus-trap';

type FeedNotification = {
  id: string;
  type: 'mention' | 'comment_reply' | 'reminder';
  payload: { pageId?: string; commentId?: string; actorId?: string } & Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

type Feed = {
  notifications: FeedNotification[];
  nextCursor?: string;
  unreadCount: number;
};

const fetcher = async (url: string): Promise<Feed> => {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error(`feed: ${res.status}`);
  return res.json();
};

function hrefFor(n: FeedNotification): Route {
  const pageId = n.payload.pageId;
  const commentId = n.payload.commentId;
  // Defensive: legacy or non-comment notifications (e.g. reminders) may have no
  // pageId — fall back to /notifications so the row is still clickable.
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

function groupFor(iso: string): 'today' | 'week' | 'older' {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 24 * 60 * 60 * 1000) return 'today';
  if (ms < 7 * 24 * 60 * 60 * 1000) return 'week';
  return 'older';
}

function describe(type: FeedNotification['type']): string {
  if (type === 'mention') return 'Mentioned you';
  if (type === 'comment_reply') return 'Replied to your comment';
  return 'Reminder';
}

/**
 * Right-side focus-trapped slide-over drawer rendering the caller's
 * notifications grouped today / this-week / older. Per-row deep-link +
 * mark-read; mark-all-read footer; "See all" link to /notifications.
 *
 * Uses the project's shared `useFocusTrap` + Esc-handler pattern (mirrors
 * `sidebar-drawer.tsx` + `mint-token-dialog.tsx`) — the Radix `Dialog`
 * primitive isn't wired up in the codebase yet, so following the existing
 * a11y pattern keeps the surface consistent with the rest of v0.6 P14's
 * a11y work without dragging in a new dependency.
 */
export function NotificationDrawer({
  open,
  onOpenChange,
  onMarked,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onMarked?: () => void;
}) {
  const titleId = useId();
  const router = useRouter();
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // Fetch only while the drawer is open; SWR drops the in-flight request on
  // close. Revalidate on focus so re-opening picks up the freshest feed.
  const { data, mutate, isLoading } = useSWR<Feed>(
    open ? '/api/notifications?limit=50' : null,
    fetcher,
    { revalidateOnFocus: true },
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChange(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const items = data?.notifications ?? [];
  const groups: Record<'today' | 'week' | 'older', FeedNotification[]> = {
    today: [],
    week: [],
    older: [],
  };
  for (const n of items) {
    groups[groupFor(n.createdAt)].push(n);
  }

  async function onMarkRead(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'POST', credentials: 'include' });
      await mutate();
      onMarked?.();
      // v0.9.8 G4 (G) — refresh the server-rendered bell badge.
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function onMarkAllRead() {
    setMarkingAll(true);
    try {
      await fetch('/api/notifications/mark-all-read', { method: 'POST', credentials: 'include' });
      await mutate();
      onMarked?.();
      // v0.9.8 G4 (G) — refresh the server-rendered bell badge.
      router.refresh();
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop is click-to-dismiss only; keyboard users dismiss the focus-trapped dialog with Escape */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is click-to-dismiss only; keyboard users dismiss the focus-trapped dialog with Escape */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={() => onOpenChange(false)} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-lg"
      >
        <div className="flex items-center justify-between border-b p-4">
          <h2 id={titleId} className="font-medium text-lg">
            Notifications
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close notifications"
            onClick={() => onOpenChange(false)}
            className="h-11 w-11"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {isLoading && !data ? (
            <p className="py-12 text-center text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">You're all caught up.</p>
          ) : (
            (['today', 'week', 'older'] as const).map((key) => {
              const group = groups[key];
              if (group.length === 0) return null;
              const label = key === 'today' ? 'Today' : key === 'week' ? 'This week' : 'Older';
              return (
                <section key={key} className="mb-6">
                  <h3 className="mb-2 font-semibold text-muted-foreground text-xs uppercase">
                    {label}
                  </h3>
                  <ul className="space-y-1">
                    {group.map((n) => (
                      <li key={n.id} className="flex items-start gap-2 rounded p-2 hover:bg-accent">
                        <Link
                          href={hrefFor(n)}
                          className="flex-1 truncate"
                          onClick={() => onOpenChange(false)}
                        >
                          <span className="block truncate" title={describe(n.type)}>
                            {describe(n.type)}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {relativeTime(n.createdAt)}
                          </span>
                        </Link>
                        {n.readAt == null && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Mark as read"
                            disabled={busyId === n.id}
                            onClick={() => void onMarkRead(n.id)}
                            // WCAG 2.5.5: 44×44 touch target on the row action.
                            className="h-11 w-11"
                          >
                            {busyId === n.id ? (
                              <Loader2
                                aria-hidden="true"
                                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                              />
                            ) : (
                              <Check aria-hidden="true" className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={markingAll}
            onClick={() => void onMarkAllRead()}
          >
            {markingAll ? (
              <Loader2
                aria-hidden="true"
                className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"
              />
            ) : null}
            Mark all read
          </Button>
          <Link
            href={'/notifications' as Route}
            className="text-primary text-sm underline-offset-4 hover:underline"
            onClick={() => onOpenChange(false)}
          >
            See all
          </Link>
        </div>
      </div>
    </>
  );
}
