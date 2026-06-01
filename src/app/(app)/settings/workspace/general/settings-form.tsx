'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { IconPicker } from '@/components/icon-picker';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';
import { useT } from '@/lib/i18n/provider';

type Initial = {
  name: string;
  requireTwofa: boolean;
  homePageId: string | null;
  icon: string | null;
};

export function SettingsForm({
  workspaceId,
  initial,
  pages,
  twofaEnforcementAvailable = false,
}: {
  workspaceId: string;
  initial: Initial;
  pages: { id: string; title: string }[];
  twofaEnforcementAvailable?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const nameId = useId();
  const twofaId = useId();
  const homePageId = useId();

  const [name, setName] = useState(initial.name);
  const [requireTwofa, setRequireTwofa] = useState(initial.requireTwofa);
  const [homePage, setHomePage] = useState<string>(initial.homePageId ?? '');
  const [icon, setIcon] = useState<string | null>(initial.icon);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      const body: {
        name: string;
        requireTwofa: boolean;
        homePageId: string | null;
        icon: string | null;
      } = {
        name: name.trim(),
        requireTwofa,
        homePageId: homePage === '' ? null : homePage,
        icon,
      };
      const res = await fetch(`/api/workspaces/${workspaceId}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? `Failed to save (${res.status})`);
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-lg flex-col gap-4">
      {error ? <StatusBanner variant="error">{error}</StatusBanner> : null}
      {saved ? <StatusBanner variant="success">{t('workspaceSettings.saved')}</StatusBanner> : null}

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t('workspaceSettings.icon.label')}</span>
        <IconPicker value={icon} onChange={setIcon} />
        <p className="text-xs text-muted-foreground">{t('workspaceSettings.icon.hint')}</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-sm font-medium">
          Workspace name
        </label>
        <input
          id={nameId}
          type="text"
          required
          minLength={1}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border px-2 py-1"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={homePageId} className="text-sm font-medium">
          Home page
        </label>
        <Select
          value={homePage === '' ? 'none' : homePage}
          onValueChange={(next) => setHomePage(next === 'none' ? '' : next)}
        >
          <SelectTrigger id={homePageId} aria-label="Home page" className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">(none)</SelectItem>
            {pages.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The page members land on after sign-in. Leave as "(none)" to use the default.
        </p>
      </div>

      {twofaEnforcementAvailable ? (
        <div className="flex items-start gap-2">
          <input
            id={twofaId}
            type="checkbox"
            checked={requireTwofa}
            onChange={(e) => setRequireTwofa(e.target.checked)}
            className="mt-1 size-5"
          />
          <div className="flex flex-col">
            <label htmlFor={twofaId} className="text-sm font-medium">
              Require two-factor authentication
            </label>
            <p className="text-xs text-muted-foreground">Members must complete 2FA at sign-in.</p>
          </div>
        </div>
      ) : null}

      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}
