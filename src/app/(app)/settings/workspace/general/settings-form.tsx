'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';

type Initial = {
  name: string;
  requireTwofa: boolean;
  homePageId: string | null;
};

export function SettingsForm({
  workspaceId,
  initial,
  pages,
}: {
  workspaceId: string;
  initial: Initial;
  pages: { id: string; title: string }[];
}) {
  const router = useRouter();
  const nameId = useId();
  const twofaId = useId();
  const homePageId = useId();

  const [name, setName] = useState(initial.name);
  const [requireTwofa, setRequireTwofa] = useState(initial.requireTwofa);
  const [homePage, setHomePage] = useState<string>(initial.homePageId ?? '');
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
      } = {
        name: name.trim(),
        requireTwofa,
        homePageId: homePage === '' ? null : homePage,
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
      {error ? (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}
      {saved ? (
        <div
          role="status"
          className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900"
        >
          Settings saved.
        </div>
      ) : null}

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
        <select
          id={homePageId}
          value={homePage}
          onChange={(e) => setHomePage(e.target.value)}
          className="rounded border px-2 py-1"
        >
          <option value="">(none)</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          The page members land on after sign-in. Leave as "(none)" to use the default.
        </p>
      </div>

      <div className="flex items-start gap-2">
        <input
          id={twofaId}
          type="checkbox"
          checked={requireTwofa}
          onChange={(e) => setRequireTwofa(e.target.checked)}
          className="mt-1"
        />
        <div className="flex flex-col">
          <label htmlFor={twofaId} className="text-sm font-medium">
            Require two-factor authentication
          </label>
          <p className="text-xs text-muted-foreground">
            Persists the flag now; enforcement at sign-in ships with TOTP support in a later
            release.
          </p>
        </div>
      </div>

      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}
