'use client';

import { CornerLeftUp } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { parseIcon } from '@/lib/pages/icon-format';
import type { FlatPageNode } from '@/lib/pages/tree';
import { cn } from '@/lib/utils';

/**
 * v0.9.6 G6 (#124) — Move-To destination picker. A themed radix Dialog that
 * fetches the workspace page tree (`GET /api/pages/tree`), lets the user search
 * + pick a destination page (or "Top level"), then POSTs `{ newParentId }` to
 * `POST /api/pages/[id]/move` (null = top level). Mirrors the duplicate-action
 * UX in `usePageRowActions`: fire-and-refresh, the caller re-renders via
 * `onMoved` (typically `router.refresh()`).
 *
 * The source page and its descendants are excluded from the destination list so
 * the picker can never offer a cycle (the move route would 400 on it anyway).
 */
export type MoveToPickerProps = {
  open: boolean;
  /** The page being moved. */
  sourceId: string;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful move (e.g. `router.refresh`). */
  onMoved: () => void;
};

function renderIcon(stored: string | null): React.ReactNode {
  const parsed = parseIcon(stored);
  if (!parsed) return '📄';
  if (parsed.kind === 'emoji') return parsed.value;
  return <span aria-hidden="true">🖼️</span>;
}

/** Collect `sourceId` plus every descendant id so they can't be destinations. */
function subtreeIds(nodes: FlatPageNode[], sourceId: string): Set<string> {
  const childrenOf = new Map<string | null, FlatPageNode[]>();
  for (const n of nodes) {
    const bucket = childrenOf.get(n.parentId) ?? [];
    bucket.push(n);
    childrenOf.set(n.parentId, bucket);
  }
  const blocked = new Set<string>([sourceId]);
  const stack = [sourceId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    for (const child of childrenOf.get(id) ?? []) {
      if (!blocked.has(child.id)) {
        blocked.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return blocked;
}

const ROW_CLASS =
  'flex min-h-11 w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground';

export function MoveToPicker({ open, sourceId, onOpenChange, onMoved }: MoveToPickerProps) {
  const t = useT();
  const [nodes, setNodes] = useState<FlatPageNode[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  // Fetch the destination list each time the dialog opens so it reflects any
  // pages created/renamed since the last open.
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
    const blocked = subtreeIds(nodes, sourceId);
    const q = query.trim().toLowerCase();
    return nodes.filter(
      (n) => !blocked.has(n.id) && (q === '' || n.title.toLowerCase().includes(q)),
    );
  }, [nodes, sourceId, query]);

  async function move(newParentId: string | null): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pages/${sourceId}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newParentId }),
      });
      if (res.ok) {
        onMoved();
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[70vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <Dialog.Title className="text-sm font-medium">{t('moveTo.title')}</Dialog.Title>
          <Dialog.Description className="sr-only">{t('moveTo.description')}</Dialog.Description>
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
              disabled={busy}
              className={cn(ROW_CLASS, 'text-muted-foreground')}
              onClick={() => void move(null)}
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
                  disabled={busy}
                  className={ROW_CLASS}
                  style={{ paddingLeft: `${8 + n.depth * 16}px` }}
                  onClick={() => void move(n.id)}
                >
                  <span aria-hidden="true" className="shrink-0">
                    {renderIcon(n.icon)}
                  </span>
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
