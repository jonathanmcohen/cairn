'use client';

import { CornerLeftUp, FileText } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import type { FlatPageNode } from '@/lib/pages/tree';
import { cn } from '@/lib/utils';

/**
 * v0.10.3 Q-4 — destination picker for "Use template". Fetches the workspace
 * page tree (`GET /api/pages/tree`) and lets the user graft the instantiated
 * template at the sidebar root or under an existing page, then reports the
 * choice via `onPick(parentId | null)`. Unlike MoveToPicker this does no
 * mutation itself — the caller POSTs the instantiate with the chosen parent.
 */
export type TemplateDestinationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen parent (null = sidebar root). */
  onPick: (parentId: string | null) => void;
};

const ROW_CLASS =
  'flex min-h-11 w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground';

export function TemplateDestinationDialog({
  open,
  onOpenChange,
  onPick,
}: TemplateDestinationDialogProps) {
  const t = useT();
  const [nodes, setNodes] = useState<FlatPageNode[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQuery('');
    void fetch('/api/pages/tree')
      .then((res) => (res.ok ? res.json() : { nodes: [] }))
      .then((data: { nodes: FlatPageNode[] }) => {
        if (!cancelled) setNodes(data.nodes ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const destinations = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? nodes : nodes.filter((n) => n.title.toLowerCase().includes(q));
  }, [nodes, query]);

  function pick(parentId: string | null): void {
    onPick(parentId);
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[70vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg">
          <Dialog.Title className="text-sm font-medium">
            {t('templates.destination.title')}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t('templates.destination.description')}
          </Dialog.Description>
          <input
            type="text"
            // biome-ignore lint/a11y/noAutofocus: a search dialog should focus its filter input on open.
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('moveTo.searchPlaceholder')}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="-mx-1 flex flex-col overflow-y-auto">
            <button
              type="button"
              data-testid="template-dest-top-level"
              className={cn(ROW_CLASS, 'text-muted-foreground')}
              onClick={() => pick(null)}
            >
              <CornerLeftUp aria-hidden="true" className="h-4 w-4 shrink-0" />
              {t('moveTo.topLevel')}
            </button>
            <div className="my-1 h-px bg-muted" aria-hidden="true" />
            {destinations.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">{t('moveTo.empty')}</p>
            ) : (
              destinations.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  data-testid={`template-dest-${n.id}`}
                  className={ROW_CLASS}
                  style={{ paddingLeft: `${8 + n.depth * 16}px` }}
                  onClick={() => pick(n.id)}
                >
                  <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{n.title || t('moveTo.untitled')}</span>
                </button>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
