'use client';

import { Bell } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { NotificationDrawer } from './drawer';

const POLL_MS = 30_000;

const fetcher = async (url: string): Promise<{ unreadCount: number }> => {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error(`unread-count: ${res.status}`);
  return res.json();
};

/**
 * Global-header notification bell. SWR polls /unread-count every 30s and
 * revalidates on window focus (the cheap-count endpoint from P15 Task 2 —
 * no row payloads). Click opens the focus-trapped drawer.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data, mutate } = useSWR<{ unreadCount: number }>(
    '/api/notifications/unread-count',
    fetcher,
    { refreshInterval: POLL_MS, revalidateOnFocus: true },
  );
  const unread = data?.unreadCount ?? 0;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        // WCAG 2.5.5: 44×44 touch target on the header bell.
        className="relative h-11 w-11"
      >
        <Bell aria-hidden="true" className="h-5 w-5" />
        {unread > 0 && (
          <span
            role="img"
            aria-label={`${unread} unread`}
            className="-right-0.5 -top-0.5 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground leading-none"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>
      <NotificationDrawer open={open} onOpenChange={setOpen} onMarked={() => void mutate()} />
    </>
  );
}
