'use client';
import { Bell } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const POLL_MS = 30_000;

type FeedNotification = {
  id: string;
  type: 'mention' | 'comment_reply';
  payload: { pageId: string; commentId: string; actorId: string };
  readAt: string | null;
  createdAt: string;
};

type Feed = {
  notifications: FeedNotification[];
  unreadCount: number;
};

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

function describe(type: FeedNotification['type']): string {
  return type === 'mention' ? 'mentioned you in a comment' : 'replied to a comment';
}

function hrefFor(n: FeedNotification): Route {
  return `/pages/${n.payload.pageId}#comment-${n.payload.commentId}` as Route;
}

export function NotificationBell() {
  const [items, setItems] = useState<FeedNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?unreadOnly=true&limit=20', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const feed = (await res.json()) as Feed;
      setItems(feed.notifications);
      setUnread(feed.unreadCount);
    } catch {
      // network blip — keep last known state; the next poll retries.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Close on outside click / Escape.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function markAllRead() {
    setUnread(0);
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      // ignore — re-fetch reconciles the badge.
    }
    void refresh();
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) void markAllRead();
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
      >
        <span className="relative">
          <Bell aria-hidden="true" className="h-5 w-5" />
          {unread > 0 && (
            <span
              role="img"
              aria-label={`${unread} unread`}
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </span>
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-80 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <p className="px-2 py-1.5 text-sm font-semibold">Notifications</p>
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No notifications</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={hrefFor(n)}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex flex-col gap-0.5 rounded-xs px-2 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <span>Someone {describe(n.type)}</span>
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(n.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
