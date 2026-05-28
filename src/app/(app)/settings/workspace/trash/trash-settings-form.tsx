'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * v0.9.0 G2 P13 — Trash retention + empty-trash admin form.
 *
 * Two stacked panels:
 *   1. Retention-days input + Save button → PATCH /api/workspace/trash-settings
 *   2. Empty-trash-now confirm flow → POST /api/workspace/trash-empty (gated
 *      behind typing the literal string "empty trash" to confirm; matches the
 *      project's existing confirm-by-typing pattern in danger zone, since no
 *      shadcn AlertDialog is bundled).
 */
export function TrashSettingsForm({
  initialRetentionDays,
  envDefault,
}: {
  initialRetentionDays: number;
  envDefault: number;
}) {
  const router = useRouter();
  const retentionId = useId();
  const confirmId = useId();

  const [retention, setRetention] = useState<number>(initialRetentionDays);
  const [saving, setSaving] = useState(false);

  const [confirmText, setConfirmText] = useState('');
  const [purging, setPurging] = useState(false);
  const canPurge = confirmText.trim().toLowerCase() === 'empty trash' && !purging;

  async function onSaveRetention(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(retention) || retention < 0 || retention > 3650) {
      toast.error('Retention must be between 0 and 3650 days.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/workspace/trash-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retentionDays: retention }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Save failed: ${body.error ?? res.status}`);
        return;
      }
      toast.success('Trash retention saved.');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function onEmptyTrash(e: React.FormEvent) {
    e.preventDefault();
    if (!canPurge) return;
    setPurging(true);
    try {
      const res = await fetch('/api/workspace/trash-empty', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Empty trash failed: ${body.error ?? res.status}`);
        return;
      }
      const body = (await res.json()) as { purgedCount: number };
      toast.success(
        `Emptied trash (${body.purgedCount} root page${body.purgedCount === 1 ? '' : 's'}).`,
      );
      setConfirmText('');
      router.refresh();
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={onSaveRetention} className="rounded-md border p-4">
        <Label htmlFor={retentionId} className="mb-1 block text-sm font-medium">
          Days to retain trashed pages before auto-purge
        </Label>
        <Input
          id={retentionId}
          type="number"
          min={0}
          max={3650}
          value={retention}
          onChange={(e) => setRetention(Number(e.target.value))}
          placeholder={`Default: ${envDefault}`}
          className="mb-3 max-w-xs"
        />
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save retention'}
        </Button>
      </form>

      <form
        onSubmit={onEmptyTrash}
        className="rounded-md border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30"
      >
        <h2 className="mb-2 text-base font-semibold text-red-900 dark:text-red-200">
          Empty trash now
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Permanently deletes every page currently in this workspace's trash, regardless of age,
          along with any attached files. This cannot be undone.
        </p>
        <Label htmlFor={confirmId} className="mb-1 block text-sm font-medium">
          Type <code>empty trash</code> to confirm
        </Label>
        <Input
          id={confirmId}
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
          className="mb-3 max-w-xs"
        />
        <Button type="submit" variant="destructive" disabled={!canPurge}>
          {purging ? 'Purging…' : 'Empty trash now'}
        </Button>
      </form>
    </div>
  );
}
