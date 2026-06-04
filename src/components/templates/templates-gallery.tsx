'use client';

import { Database, FileText } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TemplatePreviewDialog } from '@/components/templates/template-preview-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { TemplateVisibility } from '@/db/schema';
import { useT } from '@/lib/i18n/provider';

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
  const t = useT();
  const [templates, setTemplates] = useState<TemplateCard[]>(initialTemplates);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

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
              {rows.map((tpl) => (
                <Card key={tpl.id} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-base">{tpl.name}</CardTitle>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span
                        data-testid={
                          tpl.kind === 'database' ? 'tpl-kind-database' : 'tpl-kind-page'
                        }
                        className="inline-flex items-center gap-1 font-medium text-foreground"
                      >
                        {tpl.kind === 'database' ? (
                          <Database aria-hidden className="size-3.5" />
                        ) : (
                          <FileText aria-hidden className="size-3.5" />
                        )}
                        {tpl.kind === 'database'
                          ? t('templates.kind.database')
                          : t('templates.kind.page')}
                      </span>
                      {tpl.builtIn ? (
                        <span className="text-muted-foreground">{t('templates.builtIn')}</span>
                      ) : null}
                      {activeWorkspaceId && tpl.workspaceId === activeWorkspaceId ? (
                        <span className="text-muted-foreground">
                          {t('templates.inThisWorkspace')}
                        </span>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="mt-auto flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start px-1 text-muted-foreground"
                      onClick={() => setPreviewId(tpl.id)}
                    >
                      {t('templates.preview.open')}
                    </Button>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy === tpl.id}
                        onClick={() => void onUse(tpl.id)}
                      >
                        {busy === tpl.id ? 'Working…' : 'Use template'}
                      </Button>
                      {tpl.builtIn ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={busy === tpl.id}
                          onClick={() => void onDelete(tpl.id)}
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

      {previewId ? (
        <TemplatePreviewDialog
          templateId={previewId}
          name={templates.find((x) => x.id === previewId)?.name ?? ''}
          open
          onOpenChange={(o) => {
            if (!o) setPreviewId(null);
          }}
        />
      ) : null}
    </div>
  );
}
