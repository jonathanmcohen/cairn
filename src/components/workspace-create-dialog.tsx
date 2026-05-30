'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { IconPicker } from '@/components/icon-picker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n/provider';

export function WorkspaceCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset fields each time the modal opens.
  useEffect(() => {
    if (open) {
      setName('');
      setIcon(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 120 && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, icon }),
      });
      if (!res.ok) {
        throw new Error(t('workspaceSwitcher.createError'));
      }
      onOpenChange(false);
      // The route already set the active-workspace cookie; refresh + go to '/'
      // so resolveLandingPage lands on the new workspace's home page.
      router.refresh();
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workspaceSwitcher.createError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('workspaceSwitcher.modalClose')}>
        <DialogHeader>
          <DialogTitle>{t('workspaceSwitcher.modalTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('workspaceSwitcher.iconLabel')}
              </span>
              <IconPicker value={icon} onChange={setIcon} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor={nameId} className="text-xs font-medium text-muted-foreground">
                {t('workspaceSwitcher.nameLabel')}
              </label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('workspaceSwitcher.namePlaceholder')}
                maxLength={120}
                autoFocus
                required
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t('workspaceSwitcher.modalCancel')}
            </Button>
            <Button type="submit" className="min-h-11" disabled={!canSubmit}>
              {busy ? t('workspaceSwitcher.creating') : t('workspaceSwitcher.modalCreate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
