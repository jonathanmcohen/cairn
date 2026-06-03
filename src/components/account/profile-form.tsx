'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.9.9 K4 #198 — editable display-name form. PATCHes /api/users/me and shows
 * an inline success/error message. The display name was previously read-only.
 */
export function ProfileForm({ initialName }: { initialName: string }) {
  const t = useT();
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setStatus('saved');
        router.refresh();
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-muted-foreground text-sm">
          {t('profile.displayName')}
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-sm rounded border px-2 py-1"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? t('profile.saving') : t('profile.save')}
        </Button>
        {status === 'saved' ? (
          <span role="status" className="text-green-700 text-sm">
            {t('profile.saved')}
          </span>
        ) : null}
        {status === 'error' ? (
          <span role="alert" className="text-red-700 text-sm">
            {t('profile.saveError')}
          </span>
        ) : null}
      </div>
    </form>
  );
}
