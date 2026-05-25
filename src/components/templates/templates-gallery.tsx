'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type TemplateCard = {
  id: string;
  name: string;
  kind: 'page' | 'database';
  builtIn: boolean;
};

type InstantiateResponse = { rootPageId: string | null; rootDatabaseId: string | null };

const BUILT_IN_DESCRIPTIONS: Record<string, string> = {
  'Welcome to Cairn': 'A small starter set: a home page, a tasks page, and a notes scratchpad.',
  'Meeting notes': 'A blank meeting page with attendees, agenda, and action-items sections.',
  'Weekly planner': 'A week-at-a-glance page with this-week, goals, and follow-ups headers.',
};

export function TemplatesGallery({ initialTemplates }: { initialTemplates: TemplateCard[] }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateCard[]>(initialTemplates);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onlyBuiltIns = templates.every((t) => t.builtIn);

  async function onUse(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${id}/instantiate`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as InstantiateResponse;
      // "Use template" instantiates into the current workspace; navigate to the
      // freshly minted root page (database-kind templates land on their host page).
      if (data.rootPageId) {
        router.push(`/pages/${data.rootPageId}` as Route);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to use template');
      setBusy(null);
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {onlyBuiltIns ? (
        <p className="text-sm text-muted-foreground">
          Save a page or database as a template to see it here.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <Card key={t.id} className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-base">{t.name}</CardTitle>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                  {t.kind}
                </span>
                {t.builtIn ? (
                  <span className="rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    Built-in
                  </span>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="mt-auto flex flex-col gap-2">
              {t.builtIn && BUILT_IN_DESCRIPTIONS[t.name] ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">Preview</summary>
                  <p className="mt-1">{BUILT_IN_DESCRIPTIONS[t.name]}</p>
                </details>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy === t.id}
                  onClick={() => void onUse(t.id)}
                >
                  {busy === t.id ? 'Working…' : 'Use template'}
                </Button>
                {t.builtIn ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busy === t.id}
                    onClick={() => void onDelete(t.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
