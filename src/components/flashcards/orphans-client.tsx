'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/empty-state/empty-state';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n/provider';
import type { CardState, OrphanCardDto } from './types';

type PageHit = { id: string; title: string; icon: string | null };

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

/**
 * /flashcards/orphans client (v0.10.2 F1 Task C). Lists orphaned cards and
 * drives the three resolutions per card (and as a bulk action over the
 * selection):
 *   - Reattach   → opens a page picker (search-as-you-type against
 *                  /api/workspaces/pages), then POSTs the Task B bulk
 *                  `reattach` action; the card re-enters the due queue.
 *   - Keep       → POSTs the Task C bulk `keepStandalone` action; the orphan
 *                  flag is cleared and the card studies with no source page.
 *   - Delete     → POSTs the Task B bulk `delete` action (hard + audited).
 *
 * After every resolution the resolved rows are removed from the local list
 * (they are no longer orphaned), so the surface always reflects the open work.
 */
export function FlashcardsOrphansClient({ initialOrphans }: { initialOrphans: OrphanCardDto[] }) {
  const t = useT();
  const [orphans, setOrphans] = useState<OrphanCardDto[]>(initialOrphans);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerFor, setPickerFor] = useState<string[] | null>(null);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const allSelected = orphans.length > 0 && orphans.every((c) => selected.has(c.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(orphans.map((c) => c.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const remove = useCallback((ids: string[]) => {
    setOrphans((prev) => prev.filter((c) => !ids.includes(c.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  async function postBulk(payload: Record<string, unknown>): Promise<Response> {
    return fetch('/api/flashcards/manage/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function doReattach(cardIds: string[], pageId: string) {
    const res = await postBulk({ action: 'reattach', cardIds, pageId });
    if (res.ok) {
      toast.success(t('flashcards.orphans.toast.reattached'));
      remove(cardIds);
    } else {
      toast.error(t('flashcards.orphans.toast.reattachFailed'));
    }
    setPickerFor(null);
  }

  async function doKeep(cardIds: string[]) {
    const res = await postBulk({ action: 'keepStandalone', cardIds });
    if (res.ok) {
      toast.success(t('flashcards.orphans.toast.kept'));
      remove(cardIds);
    } else {
      toast.error(t('flashcards.orphans.toast.keepFailed'));
    }
  }

  async function doDelete(cardIds: string[]) {
    const res = await postBulk({ action: 'delete', cardIds });
    if (res.ok) {
      toast.success(t('flashcards.orphans.toast.deleted', { count: cardIds.length }));
      remove(cardIds);
    } else {
      toast.error(t('flashcards.orphans.toast.deleteFailed'));
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-2" data-testid="flashcards-orphans">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-semibold">{t('flashcards.orphans.title')}</h1>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href={'/flashcards' as Route}>{t('flashcards.orphans.back')}</Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('flashcards.orphans.intro')}</p>

      {/* Bulk action bar */}
      {selectedIds.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded border bg-accent/50 p-2"
          data-testid="flashcards-orphans-bulk-bar"
        >
          <span className="text-sm font-medium">
            {t('flashcards.orphans.bulk.selected', { count: selectedIds.length })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPickerFor(selectedIds)}
          >
            {t('flashcards.orphans.action.reattach')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void doKeep(selectedIds)}
          >
            {t('flashcards.orphans.action.keep')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => void doDelete(selectedIds)}
          >
            {t('flashcards.orphans.action.delete')}
          </Button>
        </div>
      ) : null}

      {orphans.length === 0 ? (
        <EmptyState
          headline={t('flashcards.orphans.empty.headline')}
          guidance={t('flashcards.orphans.empty.guidance')}
        />
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm" data-testid="flashcards-orphans-table">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={t('flashcards.orphans.selectAll')}
                    checked={allSelected}
                    onChange={toggleAll}
                    className="size-4"
                  />
                </th>
                <th className="px-2 py-2 font-medium">{t('flashcards.orphans.col.front')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.orphans.col.back')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.orphans.col.deck')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.orphans.col.tags')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.orphans.col.orphanedAt')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.orphans.col.state')}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {orphans.map((c) => (
                <tr
                  key={c.id}
                  className="border-b align-top last:border-0"
                  data-testid="flashcards-orphans-row"
                  data-card-id={c.id}
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={t('flashcards.orphans.selectRow')}
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      className="size-4"
                    />
                  </td>
                  <td
                    className="max-w-48 truncate px-2 py-2"
                    data-testid="cell-front"
                    title={c.front}
                  >
                    {c.front}
                  </td>
                  <td
                    className="max-w-48 truncate px-2 py-2"
                    data-testid="cell-back"
                    title={c.back}
                  >
                    {c.back}
                  </td>
                  <td className="px-2 py-2" data-testid="cell-deck">
                    {c.deckName ?? '—'}
                  </td>
                  <td className="px-2 py-2" data-testid="cell-tags">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((tag) => (
                        <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-2" data-testid="cell-orphaned-at">
                    {fmtDate(c.sourceOrphanedAt)}
                  </td>
                  <td className="px-2 py-2" data-testid="cell-state">
                    {stateLabel(t, c.state)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="orphan-reattach"
                        onClick={() => setPickerFor([c.id])}
                      >
                        {t('flashcards.orphans.action.reattach')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="orphan-keep"
                        onClick={() => void doKeep([c.id])}
                      >
                        {t('flashcards.orphans.action.keep')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        data-testid="orphan-delete"
                        onClick={() => void doDelete([c.id])}
                      >
                        {t('flashcards.orphans.action.delete')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pickerFor ? (
        <PagePickerDialog
          count={pickerFor.length}
          onCancel={() => setPickerFor(null)}
          onPick={(pageId) => void doReattach(pickerFor, pageId)}
        />
      ) : null}
    </div>
  );
}

function stateLabel(t: ReturnType<typeof useT>, state: CardState): string {
  return t(`flashcards.manage.state.${state}`);
}

/**
 * Search-as-you-type page picker. Debounced GET to /api/workspaces/pages?q=
 * (the same endpoint the editor's [[ page-link suggestion uses). On pick, hands
 * the chosen page id back so the orphan(s) reattach to a real, workspace-scoped
 * page — no paste-the-id.
 */
function PagePickerDialog({
  count,
  onCancel,
  onPick,
}: {
  count: number;
  onCancel: () => void;
  onPick: (pageId: string) => void;
}) {
  const t = useT();
  const fieldId = useId();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PageHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const res = await fetch(`/api/workspaces/pages?q=${encodeURIComponent(query)}`);
          if (!res.ok) {
            if (!cancelled) setHits([]);
            return;
          }
          const body = (await res.json()) as { pages?: PageHit[] };
          if (!cancelled) setHits(body.pages ?? []);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query]);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent data-testid="orphan-page-picker">
        <DialogHeader>
          <DialogTitle>{t('flashcards.orphans.picker.title', { count })}</DialogTitle>
          <DialogDescription>{t('flashcards.orphans.picker.hint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Input
            id={fieldId}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('flashcards.orphans.picker.searchPlaceholder')}
            data-testid="orphan-page-picker-input"
          />
          <ul
            className="max-h-64 divide-y overflow-y-auto rounded border"
            data-testid="orphan-page-picker-results"
          >
            {hits.length === 0 ? (
              <li className="px-3 py-3 text-center text-sm text-muted-foreground">
                {loading
                  ? t('flashcards.orphans.picker.loading')
                  : t('flashcards.orphans.picker.noResults')}
              </li>
            ) : (
              hits.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    data-testid="orphan-page-picker-option"
                    onClick={() => onPick(p.id)}
                  >
                    {p.icon ? <span aria-hidden="true">{p.icon}</span> : null}
                    <span className="truncate">
                      {p.title?.trim() || t('flashcards.orphans.picker.untitled')}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
