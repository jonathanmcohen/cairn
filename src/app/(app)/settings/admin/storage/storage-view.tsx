'use client';

import { useId, useState } from 'react';
import { StorageUsageCard } from '@/components/settings/storage-usage-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.10.0 D6 — admin storage-quota controls. The shared <StorageUsageCard/>
 * renders the meter; this view adds the limit editor (numeric input + MB/GB
 * unit toggle + Set / Clear buttons → PATCH /api/admin/storage-quota) and the
 * "Reconcile now" drift backstop (POST .../reconcile). Every mutation bumps
 * `refreshKey` so the card refetches — limit changes take effect on the next
 * upload, no restart, and this page mirrors that immediately.
 *
 * The unit picker is two aria-pressed toggle buttons, not a dropdown — the
 * repo bans raw native pickers and a two-option Radix Select is heavier than
 * the problem warrants.
 */

type Notice = 'saved' | 'cleared' | 'reconciled' | 'invalid' | 'error';

const UNIT_BYTES = { mb: 1024 * 1024, gb: 1024 * 1024 * 1024 } as const;
type Unit = keyof typeof UNIT_BYTES;

export function StorageView() {
  const t = useT();
  const inputId = useId();
  const [refreshKey, setRefreshKey] = useState(0);
  const [limitValue, setLimitValue] = useState('');
  const [unit, setUnit] = useState<Unit>('mb');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function patchLimit(limitBytes: number | null): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/storage-quota', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limitBytes }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
      setNotice(limitBytes === null ? 'cleared' : 'saved');
      setRefreshKey((k) => k + 1);
    } catch {
      setNotice('error');
    } finally {
      setBusy(false);
    }
  }

  function onSetLimit(): void {
    const value = Number(limitValue);
    if (!Number.isFinite(value) || value <= 0) {
      setNotice('invalid');
      return;
    }
    void patchLimit(Math.round(value * UNIT_BYTES[unit]));
  }

  async function onReconcile(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/storage-quota/reconcile', { method: 'POST' });
      if (!res.ok) throw new Error(`reconcile failed: ${res.status}`);
      setNotice('reconciled');
      setRefreshKey((k) => k + 1);
    } catch {
      setNotice('error');
    } finally {
      setBusy(false);
    }
  }

  const noticeText =
    notice === 'saved'
      ? t('admin.storage.noticeSaved')
      : notice === 'cleared'
        ? t('admin.storage.noticeCleared')
        : notice === 'reconciled'
          ? t('admin.storage.noticeReconciled')
          : notice === 'invalid'
            ? t('admin.storage.noticeInvalid')
            : notice === 'error'
              ? t('admin.storage.noticeError')
              : null;

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{t('admin.storage.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.storage.description')}</p>
      </header>

      <div className="space-y-6">
        <StorageUsageCard refreshKey={refreshKey} />

        <section className="rounded border bg-card p-4">
          <h2 className="text-sm font-medium">{t('admin.storage.limitHeading')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('admin.storage.limitHint')}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Label htmlFor={inputId} className="mb-1 block text-xs">
                {t('admin.storage.limitLabel')}
              </Label>
              <Input
                id={inputId}
                type="number"
                min={1}
                step="any"
                inputMode="decimal"
                value={limitValue}
                disabled={busy}
                onChange={(e) => setLimitValue(e.target.value)}
                data-testid="storage-limit-input"
              />
            </div>
            {/* Two self-labelled toggle buttons (aria-pressed) — no grouping
                role needed, and the repo bans raw native pickers. */}
            <div className="flex items-center gap-1">
              {(['mb', 'gb'] as const).map((u) => (
                <Button
                  key={u}
                  type="button"
                  size="sm"
                  variant={unit === u ? 'default' : 'outline'}
                  aria-pressed={unit === u}
                  disabled={busy}
                  className="min-h-11"
                  data-testid={`storage-unit-${u}`}
                  onClick={() => setUnit(u)}
                >
                  {u === 'mb' ? t('admin.storage.unitMb') : t('admin.storage.unitGb')}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              className="min-h-11"
              disabled={busy}
              data-testid="storage-set-limit"
              onClick={onSetLimit}
            >
              {t('admin.storage.setLimit')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              data-testid="storage-clear-limit"
              onClick={() => void patchLimit(null)}
            >
              {t('admin.storage.clearLimit')}
            </Button>
          </div>
        </section>

        <section className="rounded border bg-card p-4">
          <h2 className="text-sm font-medium">{t('admin.storage.reconcileHeading')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('admin.storage.reconcileHint')}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3 min-h-11"
            disabled={busy}
            data-testid="storage-reconcile"
            onClick={() => void onReconcile()}
          >
            {t('admin.storage.reconcileNow')}
          </Button>
        </section>

        {noticeText ? (
          <p
            role="status"
            data-testid="storage-notice"
            className={`text-sm ${notice === 'error' || notice === 'invalid' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {noticeText}
          </p>
        ) : null}
      </div>
    </div>
  );
}
