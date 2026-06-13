'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { usePrompt } from '@/components/ui/input-dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';
import type { CardState, DeckDto, ManageCardDto } from './types';

const STATES: CardState[] = ['new', 'learning', 'review', 'suspended'];
const UNDO_MS = 10_000;
const ALL = '__all__';
const NONE = '__none__';

type DeleteSnapshot = unknown[];

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export function FlashcardsManageClient({
  initialCards,
  initialDecks,
}: {
  initialCards: ManageCardDto[];
  initialDecks: DeckDto[];
}) {
  const t = useT();
  const prompt = usePrompt();
  const searchId = useId();

  const [cards, setCards] = useState<ManageCardDto[]>(initialCards);
  const [decks, setDecks] = useState<DeckDto[]>(initialDecks);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Filters.
  const [deckFilter, setDeckFilter] = useState<string>(ALL);
  const [tagFilter, setTagFilter] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>(ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL); // all | exists | orphaned
  const [search, setSearch] = useState<string>('');

  // Dialogs.
  const [editing, setEditing] = useState<ManageCardDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; bulk: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (deckFilter !== ALL) params.set('deck', deckFilter);
    if (tagFilter.trim()) params.set('tag', tagFilter.trim());
    if (stateFilter !== ALL) params.set('state', stateFilter);
    if (sourceFilter === 'exists') params.set('sourcePageExists', 'true');
    if (sourceFilter === 'orphaned') params.set('sourcePageExists', 'false');
    if (search.trim()) params.set('search', search.trim());
    const res = await fetch(`/api/flashcards/manage?${params.toString()}`);
    if (!res.ok) return;
    const body = (await res.json()) as { cards: ManageCardDto[] };
    setCards(body.cards);
    // Drop selections that fell out of the filtered set.
    setSelected((prev) => {
      const next = new Set<string>();
      for (const c of body.cards) if (prev.has(c.id)) next.add(c.id);
      return next;
    });
  }, [deckFilter, tagFilter, stateFilter, sourceFilter, search]);

  // Re-fetch whenever a filter changes (debounced for the free-text inputs).
  // `refresh` is the sole dependency; it's memoized over every filter via
  // useCallback, so a new identity (filter change) re-runs this effect.
  useEffect(() => {
    const id = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(id);
  }, [refresh]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const c of cards) for (const tag of c.tags) s.add(tag);
    return [...s].sort();
  }, [cards]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const allSelected = cards.length > 0 && cards.every((c) => selected.has(c.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(cards.map((c) => c.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function postBulk(payload: Record<string, unknown>): Promise<Response> {
    return fetch('/api/flashcards/manage/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // ---- Bulk actions -------------------------------------------------------

  async function bulkMoveToDeck(deckId: string | null) {
    if (selectedIds.length === 0) return;
    const res = await postBulk({ action: 'moveToDeck', cardIds: selectedIds, deckId });
    if (res.ok) {
      toast.success(t('flashcards.manage.toast.moved'));
      await refresh();
    }
  }

  async function bulkAddTag() {
    if (selectedIds.length === 0) return;
    const tag = await prompt({
      title: t('flashcards.manage.bulk.addTag'),
      label: t('flashcards.manage.tagLabel'),
    });
    if (!tag?.trim()) return;
    const res = await postBulk({ action: 'addTags', cardIds: selectedIds, tags: [tag.trim()] });
    if (res.ok) {
      toast.success(t('flashcards.manage.toast.tagged'));
      await refresh();
    }
  }

  async function bulkRemoveTag() {
    if (selectedIds.length === 0) return;
    const tag = await prompt({
      title: t('flashcards.manage.bulk.removeTag'),
      label: t('flashcards.manage.tagLabel'),
    });
    if (!tag?.trim()) return;
    const res = await postBulk({ action: 'removeTags', cardIds: selectedIds, tags: [tag.trim()] });
    if (res.ok) {
      toast.success(t('flashcards.manage.toast.tagged'));
      await refresh();
    }
  }

  async function bulkSuspend(suspend: boolean) {
    if (selectedIds.length === 0) return;
    const res = await postBulk({
      action: suspend ? 'suspend' : 'unsuspend',
      cardIds: selectedIds,
    });
    if (res.ok) {
      toast.success(
        suspend ? t('flashcards.manage.toast.suspended') : t('flashcards.manage.toast.unsuspended'),
      );
      await refresh();
    }
  }

  async function bulkReset() {
    if (selectedIds.length === 0) return;
    const res = await postBulk({ action: 'reset', cardIds: selectedIds });
    if (res.ok) {
      toast.success(t('flashcards.manage.toast.reset'));
      await refresh();
    }
  }

  async function bulkReattach() {
    if (selectedIds.length === 0) return;
    const pageId = await prompt({
      title: t('flashcards.manage.bulk.reattach'),
      label: t('flashcards.manage.reattachLabel'),
      description: t('flashcards.manage.reattachHint'),
    });
    if (!pageId?.trim()) return;
    const res = await postBulk({ action: 'reattach', cardIds: selectedIds, pageId: pageId.trim() });
    if (res.ok) {
      toast.success(t('flashcards.manage.toast.reattached'));
      await refresh();
    } else {
      toast.error(t('flashcards.manage.toast.reattachFailed'));
    }
  }

  async function newDeck() {
    const name = await prompt({
      title: t('flashcards.manage.deck.create'),
      label: t('flashcards.manage.deck.nameLabel'),
    });
    if (!name?.trim()) return;
    const res = await fetch('/api/flashcards/decks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      const body = (await res.json()) as { deck: DeckDto };
      setDecks((prev) => [...prev, body.deck].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(t('flashcards.manage.toast.deckCreated'));
    } else if (res.status === 409) {
      toast.error(t('flashcards.manage.toast.deckExists'));
    }
  }

  // Delete with 10s undo. The delete response hands back a snapshot (card +
  // review rows); the undo toast POSTs it back to `restore` so the card returns
  // with its SM-2 review history intact.
  async function doDelete(ids: string[]) {
    setDeleteTarget(null);
    const res = await postBulk({ action: 'delete', cardIds: ids });
    if (!res.ok) {
      toast.error(t('flashcards.manage.toast.deleteFailed'));
      return;
    }
    const body = (await res.json()) as { snapshot: DeleteSnapshot };
    setCards((prev) => prev.filter((c) => !ids.includes(c.id)));
    setSelected(new Set());
    toast.success(t('flashcards.manage.toast.deleted', { count: ids.length }), {
      duration: UNDO_MS,
      action: {
        label: t('flashcards.manage.undo'),
        onClick: () => {
          void (async () => {
            const undo = await postBulk({ action: 'restore', snapshot: body.snapshot });
            if (undo.ok) {
              toast.success(t('flashcards.manage.toast.restored'));
              await refresh();
            }
          })();
        },
      },
    });
  }

  function exportCsv() {
    const params = new URLSearchParams({ format: 'csv' });
    if (selectedIds.length > 0) params.set('ids', selectedIds.join(','));
    if (deckFilter !== ALL) params.set('deck', deckFilter);
    if (tagFilter.trim()) params.set('tag', tagFilter.trim());
    if (stateFilter !== ALL) params.set('state', stateFilter);
    if (sourceFilter === 'exists') params.set('sourcePageExists', 'true');
    if (sourceFilter === 'orphaned') params.set('sourcePageExists', 'false');
    if (search.trim()) params.set('search', search.trim());
    window.location.href = `/api/flashcards/manage?${params.toString()}`;
  }

  // ---- Render -------------------------------------------------------------

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-semibold">{t('flashcards.manage.title')}</h1>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void newDeck()}>
            {t('flashcards.manage.deck.create')}
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={'/flashcards/study' as Route}>{t('flashcards.study.link')}</Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded border bg-card p-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {t('flashcards.manage.filter.deck')}
          </Label>
          <Select value={deckFilter} onValueChange={setDeckFilter}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('flashcards.manage.filter.allDecks')}</SelectItem>
              {decks.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {t('flashcards.manage.filter.state')}
          </Label>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('flashcards.manage.filter.allStates')}</SelectItem>
              {STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`flashcards.manage.state.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {t('flashcards.manage.filter.tag')}
          </Label>
          <Select
            value={tagFilter || NONE}
            onValueChange={(v) => setTagFilter(v === NONE ? '' : v)}
          >
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder={t('flashcards.manage.filter.allTags')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('flashcards.manage.filter.allTags')}</SelectItem>
              {allTags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {t('flashcards.manage.filter.source')}
          </Label>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('flashcards.manage.filter.allSources')}</SelectItem>
              <SelectItem value="exists">{t('flashcards.manage.filter.hasSource')}</SelectItem>
              <SelectItem value="orphaned">{t('flashcards.manage.filter.orphaned')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={searchId} className="text-xs text-muted-foreground">
            {t('flashcards.manage.filter.search')}
          </Label>
          <Input
            id={searchId}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('flashcards.manage.filter.searchPlaceholder')}
            className="h-8 min-w-40"
          />
        </div>

        <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
          {t('flashcards.manage.export')}
        </Button>
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded border bg-accent/50 p-2"
          data-testid="flashcards-bulk-bar"
        >
          <span className="text-sm font-medium">
            {t('flashcards.manage.bulk.selected', { count: selectedIds.length })}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline">
                {t('flashcards.manage.bulk.moveToDeck')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {decks.map((d) => (
                <DropdownMenuItem key={d.id} onSelect={() => void bulkMoveToDeck(d.id)}>
                  {d.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void bulkMoveToDeck(null)}>
                {t('flashcards.manage.bulk.noDeck')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" variant="outline" size="sm" onClick={() => void bulkAddTag()}>
            {t('flashcards.manage.bulk.addTag')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void bulkRemoveTag()}>
            {t('flashcards.manage.bulk.removeTag')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void bulkSuspend(true)}>
            {t('flashcards.manage.bulk.suspend')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void bulkSuspend(false)}>
            {t('flashcards.manage.bulk.unsuspend')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void bulkReset()}>
            {t('flashcards.manage.bulk.reset')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void bulkReattach()}>
            {t('flashcards.manage.bulk.reattach')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget({ ids: selectedIds, bulk: selectedIds.length > 1 })}
          >
            {t('flashcards.manage.bulk.delete')}
          </Button>
        </div>
      ) : null}

      {/* Table */}
      {cards.length === 0 ? (
        <p className="rounded border bg-card p-8 text-center text-muted-foreground">
          {t('flashcards.manage.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm" data-testid="flashcards-manage-table">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={t('flashcards.manage.selectAll')}
                    checked={allSelected}
                    onChange={toggleAll}
                    className="size-4"
                  />
                </th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.front')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.back')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.deck')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.tags')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.source')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.due')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.state')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.interval')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.ease')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.reps')}</th>
                <th className="px-2 py-2 font-medium">{t('flashcards.manage.col.lastReviewed')}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr
                  key={c.id}
                  className="border-b align-top last:border-0"
                  data-testid="flashcards-manage-row"
                  data-card-id={c.id}
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={t('flashcards.manage.selectRow')}
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      className="size-4"
                    />
                  </td>
                  <td
                    className="px-2 py-2 max-w-48 truncate"
                    data-testid="cell-front"
                    title={c.front}
                  >
                    {c.front}
                  </td>
                  <td
                    className="px-2 py-2 max-w-48 truncate"
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
                  <td className="px-2 py-2" data-testid="cell-source">
                    {c.sourceOrphanedAt ? (
                      <span className="text-warning" title={t('flashcards.manage.orphaned')}>
                        {t('flashcards.manage.orphanedShort')}
                      </span>
                    ) : c.pageId ? (
                      <Link
                        href={`/pages/${c.pageId}` as Route}
                        className="text-primary underline"
                        data-testid="cell-source-link"
                      >
                        {c.pageTitle?.trim() || t('flashcards.manage.sourcePage')}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-2 py-2" data-testid="cell-due">
                    {fmtDate(c.dueAt)}
                  </td>
                  <td className="px-2 py-2" data-testid="cell-state">
                    {t(`flashcards.manage.state.${c.state}`)}
                  </td>
                  <td className="px-2 py-2" data-testid="cell-interval">
                    {c.interval}
                  </td>
                  <td className="px-2 py-2" data-testid="cell-ease">
                    {c.ease.toFixed(2)}
                  </td>
                  <td className="px-2 py-2" data-testid="cell-reps">
                    {c.reps}
                  </td>
                  <td className="px-2 py-2" data-testid="cell-last">
                    {fmtDate(c.lastReviewedAt)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <RowActions
                      card={c}
                      decks={decks}
                      onEdit={() => setEditing(c)}
                      onChanged={refresh}
                      onDelete={() => setDeleteTarget({ ids: [c.id], bulk: false })}
                      onReattach={() => void rowReattach(c.id, prompt, t, refresh)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <EditCardDialog
          card={editing}
          decks={decks}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}

      {deleteTarget ? (
        <TypedDeleteDialog
          count={deleteTarget.ids.length}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void doDelete(deleteTarget.ids)}
        />
      ) : null}
    </div>
  );
}

async function rowReattach(
  cardId: string,
  prompt: ReturnType<typeof usePrompt>,
  t: ReturnType<typeof useT>,
  refresh: () => Promise<void>,
) {
  const pageId = await prompt({
    title: t('flashcards.manage.action.reattach'),
    label: t('flashcards.manage.reattachLabel'),
    description: t('flashcards.manage.reattachHint'),
  });
  if (!pageId?.trim()) return;
  const res = await fetch('/api/flashcards/manage/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'reattach', cardIds: [cardId], pageId: pageId.trim() }),
  });
  if (res.ok) {
    toast.success(t('flashcards.manage.toast.reattached'));
    await refresh();
  } else {
    toast.error(t('flashcards.manage.toast.reattachFailed'));
  }
}

function RowActions({
  card,
  decks,
  onEdit,
  onChanged,
  onDelete,
  onReattach,
}: {
  card: ManageCardDto;
  decks: DeckDto[];
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onDelete: () => void;
  onReattach: () => void;
}) {
  const t = useT();

  async function patch(payload: Record<string, unknown>) {
    const res = await fetch(`/api/flashcards/${card.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) await onChanged();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" data-testid="row-actions-trigger">
          {t('flashcards.manage.action.menu')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>{t('flashcards.manage.action.edit')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {decks.map((d) => (
          <DropdownMenuItem
            key={d.id}
            disabled={card.deckId === d.id}
            onSelect={() => void patch({ deckId: d.id })}
          >
            {t('flashcards.manage.action.moveTo', { deck: d.name })}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {card.suspendedAt ? (
          <DropdownMenuItem onSelect={() => void patch({ suspended: false })}>
            {t('flashcards.manage.action.unsuspend')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void patch({ suspended: true })}>
            {t('flashcards.manage.action.suspend')}
          </DropdownMenuItem>
        )}
        {card.sourceOrphanedAt ? (
          <DropdownMenuItem onSelect={onReattach}>
            {t('flashcards.manage.action.reattach')}
          </DropdownMenuItem>
        ) : null}
        {card.pageId && !card.sourceOrphanedAt ? (
          <DropdownMenuItem asChild>
            <Link href={`/pages/${card.pageId}` as Route}>
              {t('flashcards.manage.action.openSource')}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive"
          onSelect={onDelete}
          data-testid="row-action-delete"
        >
          {t('flashcards.manage.action.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EditCardDialog({
  card,
  decks,
  onClose,
  onSaved,
}: {
  card: ManageCardDto;
  decks: DeckDto[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const frontId = useId();
  const backId = useId();
  const tagsId = useId();
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [deckId, setDeckId] = useState<string>(card.deckId ?? NONE);
  const [tags, setTags] = useState(card.tags.join(', '));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const setTags = tags
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const res = await fetch(`/api/flashcards/${card.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          front,
          back,
          deckId: deckId === NONE ? null : deckId,
          setTags,
        }),
      });
      if (res.ok) await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('flashcards.manage.edit.title')}</DialogTitle>
          {card.pageId && !card.sourceOrphanedAt ? (
            <DialogDescription>{t('flashcards.manage.edit.writeThrough')}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label htmlFor={frontId}>{t('flashcards.manage.col.front')}</Label>
            <Input id={frontId} value={front} onChange={(e) => setFront(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={backId}>{t('flashcards.manage.col.back')}</Label>
            <Input id={backId} value={back} onChange={(e) => setBack(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t('flashcards.manage.col.deck')}</Label>
            <Select value={deckId} onValueChange={setDeckId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('flashcards.manage.bulk.noDeck')}</SelectItem>
                {decks.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={tagsId}>{t('flashcards.manage.edit.tagsLabel')}</Label>
            <Input id={tagsId} value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('flashcards.manage.cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {t('flashcards.manage.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TypedDeleteDialog({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const fieldId = useId();
  const [value, setValue] = useState('');
  const phrase = t('flashcards.manage.delete.phrase');
  const matches = value.trim() === phrase;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('flashcards.manage.delete.title', { count })}</DialogTitle>
          <DialogDescription>
            {t('flashcards.manage.delete.description', { phrase })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor={fieldId}>{t('flashcards.manage.delete.confirmLabel', { phrase })}</Label>
          <Input
            id={fieldId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="delete-confirm-input"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('flashcards.manage.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!matches}
            onClick={onConfirm}
            data-testid="delete-confirm-button"
          >
            {t('flashcards.manage.delete.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
