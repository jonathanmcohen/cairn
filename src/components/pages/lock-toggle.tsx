/**
 * v0.9.0 G2 P14 — Lock controls for the page header.
 *
 * Two surfaces:
 *   - `<LockOptions>` — the lock-duration menu (indefinite / 1h / 24h / custom),
 *     rendered inline by the "…" page menu's "Lock page" item (v0.10.2 P1 —
 *     formerly wrapped in the toolbar `<LockToggle>` popover, removed when the
 *     lock control moved into the page menu).
 *   - `<UnlockButton>` — shown inside the locked banner; the locker (self) or
 *     an admin (override) can clear the lock.
 *
 * Both call the lock route then `router.refresh()` so the server-rendered
 * banner state stays consistent without a hard reload.
 */
'use client';

import { Clock, Hourglass, Infinity as InfinityIcon, LockOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
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
import { cn } from '@/lib/utils';

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

export async function deleteLock(pageId: string, adminOverride: boolean): Promise<void> {
  const res = await fetch(`/api/pages/${pageId}/lock`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adminOverride }),
  });
  if (!res.ok) {
    throw new Error(`Unlock failed: ${res.status}`);
  }
}

type LockOptionsProps = {
  pageId: string;
  /** Called after a successful lock (e.g. close the hosting menu). */
  onLocked?: () => void;
  className?: string;
};

export function LockOptions({ pageId, onLocked, className }: LockOptionsProps) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const amountId = useId();
  // Custom-duration inline sub-form state.
  const [customMode, setCustomMode] = useState(false);
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>('hours');

  function lockFor(hours?: number) {
    start(async () => {
      try {
        await postLock(pageId, hours);
        router.refresh();
        onLocked?.();
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
    <div role="menu" aria-label={t('pageActions.lock.menuLabel')} className={cn('p-1', className)}>
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
        // flex-wrap: the form must also fit the narrow page-menu popover.
        <div className="mt-1 flex flex-wrap items-end gap-2 border-t p-2">
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
          <Select value={unit} onValueChange={(v) => setUnit(v as 'minutes' | 'hours' | 'days')}>
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
