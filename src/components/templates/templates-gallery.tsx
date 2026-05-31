'use client';

import { ChevronRight, Database, FileText } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { TemplateVisibility } from '@/db/schema';

export type TemplateCard = {
  id: string;
  name: string;
  kind: 'page' | 'database';
  builtIn: boolean;
  /** v0.9 G4 P25 — sharing tier. Defaults to 'workspace' for legacy rows. */
  visibility?: TemplateVisibility;
  /** Workspace that owns the template. Null = built-in / global. */
  workspaceId?: string | null;
};

type InstantiateResponse = { rootPageId: string | null; rootDatabaseId: string | null };

const BUILT_IN_DESCRIPTIONS: Record<string, string> = {
  'Welcome to Cairn': 'A small starter set: a home page, a tasks page, and a notes scratchpad.',
  'Meeting notes': 'A blank meeting page with attendees, agenda, and action-items sections.',
  'Weekly planner': 'A week-at-a-glance page with this-week, goals, and follow-ups headers.',
};

// v0.9 G4 P25 — gallery groups by visibility tier. Render order:
//   workspace (most relevant)
//   public    (gallery's reason for being)
//   private   (creator-only — least surfaced)
const VISIBILITY_ORDER: TemplateVisibility[] = ['workspace', 'public', 'private'];

export type TemplatesGalleryProps = {
  initialTemplates: TemplateCard[];
  /** Active workspace id — used to label "In this workspace" vs "Shared". */
  activeWorkspaceId?: string;
};

export function TemplatesGallery({ initialTemplates, activeWorkspaceId }: TemplatesGalleryProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<TemplateCard[]>(initialTemplates);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const ok = await confirm({
      title: 'Delete this template? This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
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

  // v0.9 G4 P25 — group rows by visibility. Built-ins keep their pre-existing
  // workspace-style placement; group them under 'public' since they're global.
  const grouped = new Map<TemplateVisibility, TemplateCard[]>();
  for (const v of VISIBILITY_ORDER) grouped.set(v, []);
  for (const t of templates) {
    const tier = (
      t.builtIn ? 'public' : (t.visibility ?? 'workspace')
    ) satisfies TemplateVisibility;
    grouped.get(tier)?.push(t);
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* P08 #37 — discoverable "Save as template" CTA. The save flow needs a
          source page, so the gallery (which has no current page) guides the
          user to the per-page menu rather than launching the dialog blind. */}
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Create your own template</p>
        <p className="mt-1">
          Open any page, click the <span className="font-medium">⋯</span> menu, and choose{' '}
          <span className="font-medium">“Save as template…”</span> to add it here.
        </p>
      </div>

      {VISIBILITY_ORDER.map((v) => {
        const rows = grouped.get(v) ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={v} aria-labelledby={`tpl-section-${v}`}>
            <h2
              id={`tpl-section-${v}`}
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {v}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
              {rows.map((t) => (
                <Card key={t.id} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded border border-transparent bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                        {t.kind === 'database' ? (
                          <Database aria-hidden className="size-3" />
                        ) : (
                          <FileText aria-hidden className="size-3" />
                        )}
                        {t.kind}
                      </span>
                      {t.builtIn ? (
                        <span className="rounded border border-transparent bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                          Built-in
                        </span>
                      ) : null}
                      {activeWorkspaceId && t.workspaceId === activeWorkspaceId ? (
                        <span className="rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          In this workspace
                        </span>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="mt-auto flex flex-col gap-2">
                    {t.builtIn && BUILT_IN_DESCRIPTIONS[t.name] ? (
                      <details className="group text-xs text-muted-foreground">
                        <summary className="flex cursor-pointer list-none select-none items-center gap-1 [&::-webkit-details-marker]:hidden">
                          <ChevronRight
                            aria-hidden
                            className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
                          />
                          Preview
                        </summary>
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
          </section>
        );
      })}
    </div>
  );
}
