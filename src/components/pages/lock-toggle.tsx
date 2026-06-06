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

import { Clock, Hourglass, Infinity as InfinityIcon, Lock, LockOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';

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
  /**
   * Optional controlled open-state (used by the shared page-action-panels
   * controller for single-open mutual exclusion). When omitted the toggle
   * self-manages its menu, so it stays usable standalone and in tests.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function LockToggle({ pageId, open: controlledOpen, onOpenChange }: LockToggleProps) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      else setInternalOpen(next);
    },
    [onOpenChange],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const amountId = useId();
  // Custom-duration inline sub-form state.
  const [customMode, setCustomMode] = useState(false);
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>('hours');

  // Reset the sub-form whenever the menu closes.
  useEffect(() => {
    if (!open) setCustomMode(false);
  }, [open]);

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
  }, [open, setOpen]);

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

  function confirmCustom() {
    const n = Number.parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    // Internal unit is fractional hours throughout.
    const hours = unit === 'minutes' ? n / 60 : unit === 'days' ? n * 24 : n;
    lockFor(hours);
  }

  const itemCls =
    'flex min-h-11 w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent';

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t('pageActions.lock.trigger')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen(!open)}
      >
        <Lock className="h-4 w-4" aria-hidden />
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={t('pageActions.lock.menuLabel')}
          className="absolute right-0 z-50 mt-1 min-w-56 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
          <button
            role="menuitem"
            type="button"
            className={itemCls}
            disabled={pending}
            onClick={() => lockFor()}
          >
            <InfinityIcon className="h-4 w-4 shrink-0" aria-hidden />
            {t('pageActions.lock.indefinite')}
          </button>
          <button
            role="menuitem"
            type="button"
            className={itemCls}
            disabled={pending}
            onClick={() => lockFor(1)}
          >
            <Clock className="h-4 w-4 shrink-0" aria-hidden />
            {t('pageActions.lock.oneHour')}
          </button>
          <button
            role="menuitem"
            type="button"
            className={itemCls}
            disabled={pending}
            onClick={() => lockFor(24)}
          >
            <Hourglass className="h-4 w-4 shrink-0" aria-hidden />
            {t('pageActions.lock.oneDay')}
          </button>
          <button
            role="menuitem"
            type="button"
            className={itemCls}
            disabled={pending}
            aria-expanded={customMode}
            onClick={() => setCustomMode((v) => !v)}
          >
            <Clock className="h-4 w-4 shrink-0" aria-hidden />
            {t('pageActions.lock.custom')}
          </button>
          {customMode && (
            <div className="mt-1 flex items-end gap-2 border-t p-2">
              <div className="flex flex-col gap-1 text-xs">
                <label htmlFor={amountId} className="text-muted-foreground">
                  {t('pageActions.lock.customAmount')}
                </label>
                <Input
                  id={amountId}
                  type="number"
                  min={1}
                  step={1}
                  value={amount}
                  aria-label={t('pageActions.lock.customAmount')}
                  className="h-9 w-20"
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <Select
                value={unit}
                onValueChange={(v) => setUnit(v as 'minutes' | 'hours' | 'days')}
              >
                <SelectTrigger className="h-9 w-24" aria-label={t('pageActions.lock.unitLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">{t('pageActions.lock.unitMinutes')}</SelectItem>
                  <SelectItem value="hours">{t('pageActions.lock.unitHours')}</SelectItem>
                  <SelectItem value="days">{t('pageActions.lock.unitDays')}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                className="h-9"
                disabled={pending}
                onClick={confirmCustom}
              >
                {t('pageActions.lock.confirm')}
              </Button>
            </div>
          )}
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
