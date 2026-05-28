/**
 * v0.9.0 G2 P14 — Lock controls for the page header.
 *
 * Two surfaces:
 *   - `<LockToggle>` — shown when the page is unlocked, lets an editor lock it
 *     (indefinite / 1h / 24h via a tiny popover menu).
 *   - `<UnlockButton>` — shown inside the locked banner; the locker (self) or
 *     an admin (override) can clear the lock.
 *
 * Both call the lock route then `router.refresh()` so the server-rendered
 * banner state stays consistent without a hard reload.
 */
'use client';

import { Lock, LockOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';

async function postLock(pageId: string, hours?: number): Promise<void> {
  const lockedUntil = hours ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null;
  const res = await fetch(`/api/pages/${pageId}/lock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lockedUntil }),
  });
  if (!res.ok) {
    throw new Error(`Lock failed: ${res.status}`);
  }
}

async function deleteLock(pageId: string, adminOverride: boolean): Promise<void> {
  const res = await fetch(`/api/pages/${pageId}/lock`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adminOverride }),
  });
  if (!res.ok) {
    throw new Error(`Unlock failed: ${res.status}`);
  }
}

type LockToggleProps = {
  pageId: string;
};

export function LockToggle({ pageId }: LockToggleProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function lockFor(hours?: number) {
    start(async () => {
      try {
        await postLock(pageId, hours);
        setOpen(false);
        router.refresh();
      } catch (err) {
        console.error(err);
      }
    });
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Lock page"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
      >
        <Lock className="h-4 w-4" aria-hidden />
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Lock page menu"
          className="absolute right-0 z-50 mt-1 min-w-44 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
          <button
            role="menuitem"
            type="button"
            className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
            disabled={pending}
            onClick={() => lockFor()}
          >
            Lock indefinitely
          </button>
          <button
            role="menuitem"
            type="button"
            className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
            disabled={pending}
            onClick={() => lockFor(1)}
          >
            Lock for 1 hour
          </button>
          <button
            role="menuitem"
            type="button"
            className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
            disabled={pending}
            onClick={() => lockFor(24)}
          >
            Lock for 24 hours
          </button>
        </div>
      )}
    </div>
  );
}

type UnlockButtonProps = {
  pageId: string;
  isAdminOverride: boolean;
  className?: string;
};

export function UnlockButton({ pageId, isAdminOverride, className }: UnlockButtonProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      className={className}
      onClick={() =>
        start(async () => {
          try {
            await deleteLock(pageId, isAdminOverride);
            router.refresh();
          } catch (err) {
            console.error(err);
          }
        })
      }
    >
      <LockOpen className="mr-1 h-4 w-4" aria-hidden />
      {isAdminOverride ? 'Override unlock' : 'Unlock'}
    </Button>
  );
}
