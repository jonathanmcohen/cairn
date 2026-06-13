'use client';

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { GripVertical, MoreHorizontal, Palette, Settings2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { IconPicker } from '@/components/icon-picker';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { descendantIds, flattenDeckTree } from './deck-tree';
import { DeckTreePicker } from './deck-tree-picker';
import type { DeckCountDto, DeckTreeDto } from './types';

// The seeded per-workspace deck (migration 0077) — never offers Delete and can
// never be reparented onto another deck's subtree. Detected by name (matches
// `DEFAULT_DECK_NAME` in src/lib/flashcards/decks.ts).
const DEFAULT_DECK_NAME = 'Default';

const ROOT_DROPPABLE_ID = '__root__';
const EMPTY_COUNT: DeckCountDto = { deckId: '', new: 0, learning: 0, review: 0, mature: 0 };

// Fixed deck color palette. Stored as a stable name (the `color` column is free
// text); the chip hex follows the editor color-popover precedent for swatches.
type DeckColor = { key: string; hex: string };
const COLORS: DeckColor[] = [
  { key: 'red', hex: '#dc2626' },
  { key: 'orange', hex: '#ea580c' },
  { key: 'yellow', hex: '#ca8a04' },
  { key: 'green', hex: '#16a34a' },
  { key: 'blue', hex: '#2563eb' },
  { key: 'purple', hex: '#9333ea' },
];
const COLOR_HEX = new Map(COLORS.map((c) => [c.key, c.hex]));

type DeckPatch = Partial<{
  name: string;
  icon: string | null;
  color: string | null;
  defaultNewPerDay: number | null;
  defaultReviewLimit: number | null;
  easeStart: number | null;
  parentDeckId: string | null;
}>;

/**
 * /flashcards/decks client (v0.10.2 F2 Task C). Builds a nested deck tree from
 * `parentDeckId` (counts are small, so no virtualization — the pages-tree
 * idiom would be overkill). Per deck: inline rename, icon + color pickers,
 * per-deck SM-2 count pills, study link, an options popover, and a lifecycle
 * menu (move-all / merge / delete). Drag-to-reparent via @dnd-kit; a rejected
 * cycle (409) rolls back the optimistic move and toasts the error.
 */
export function DecksClient({
  initialDecks,
  initialCounts,
}: {
  initialDecks: DeckTreeDto[];
  initialCounts: DeckCountDto[];
}) {
  const t = useT();
  const prompt = usePrompt();

  const [decks, setDecks] = useState<DeckTreeDto[]>(initialDecks);
  const [countList, setCountList] = useState<DeckCountDto[]>(initialCounts);
  const counts = useMemo(() => {
    const m = new Map<string, DeckCountDto>();
    for (const c of countList) m.set(c.deckId, c);
    return m;
  }, [countList]);

  // Re-fetch the deck tree + counts from the server (used after card-moving
  // operations — move-all / merge — where the count pills must reflect server
  // truth rather than an optimistic guess).
  const reload = useCallback(async () => {
    const res = await fetch('/api/flashcards/decks');
    if (!res.ok) return;
    const body = (await res.json()) as { decks: DeckTreeDto[]; counts: DeckCountDto[] };
    setDecks(body.decks);
    setCountList(body.counts);
  }, []);

  const [moveTarget, setMoveTarget] = useState<{
    deck: DeckTreeDto;
    mode: 'move' | 'merge';
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeckTreeDto | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const flat = useMemo(() => flattenDeckTree(decks), [decks]);

  const patchDeck = useCallback(async (deckId: string, patch: DeckPatch): Promise<Response> => {
    return fetch(`/api/flashcards/decks/${deckId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }, []);

  // Apply an optimistic local field update + PATCH; roll back on failure.
  const applyPatch = useCallback(
    async (deckId: string, patch: DeckPatch, successMsg: string, failMsg: string) => {
      const prev = decks;
      setDecks((ds) => ds.map((d) => (d.id === deckId ? { ...d, ...patch } : d)));
      const res = await patchDeck(deckId, patch);
      if (res.ok) {
        toast.success(successMsg);
      } else if (res.status === 409) {
        setDecks(prev);
        toast.error(t('flashcards.decks.toast.exists'));
      } else {
        setDecks(prev);
        toast.error(failMsg);
      }
    },
    [decks, patchDeck, t],
  );

  async function newDeck() {
    const name = await prompt({
      title: t('flashcards.decks.newDeck'),
      label: t('flashcards.decks.newDeck.nameLabel'),
    });
    if (!name?.trim()) return;
    const res = await fetch('/api/flashcards/decks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      const body = (await res.json()) as { deck: DeckTreeDto };
      setDecks((prev) => [...prev, body.deck]);
      toast.success(t('flashcards.decks.toast.created'));
    } else if (res.status === 409) {
      toast.error(t('flashcards.decks.toast.exists'));
    } else {
      toast.error(t('flashcards.decks.toast.exists'));
    }
  }

  async function rename(deck: DeckTreeDto, next: string) {
    const trimmed = next.trim();
    if (!trimmed || trimmed === deck.name) return;
    await applyPatch(
      deck.id,
      { name: trimmed },
      t('flashcards.decks.toast.renamed'),
      t('flashcards.decks.toast.renameFailed'),
    );
  }

  async function reparent(deckId: string, parentDeckId: string | null) {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck || deck.parentDeckId === parentDeckId) return;
    const prev = decks;
    setDecks((ds) => ds.map((d) => (d.id === deckId ? { ...d, parentDeckId } : d)));
    const res = await patchDeck(deckId, { parentDeckId });
    if (res.ok) {
      toast.success(t('flashcards.decks.toast.reparented'));
      return;
    }
    setDecks(prev); // roll back the optimistic move
    if (res.status === 409) {
      toast.error(t('flashcards.decks.toast.reparentCycle'));
    } else {
      toast.error(t('flashcards.decks.toast.reparentFailed'));
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || overId === activeId) return;
    const parentDeckId = overId === ROOT_DROPPABLE_ID ? null : overId;
    void reparent(activeId, parentDeckId);
  }

  async function doMoveOrMerge(source: DeckTreeDto, mode: 'move' | 'merge', targetDeckId: string) {
    setMoveTarget(null);
    if (mode === 'merge') {
      const res = await fetch(`/api/flashcards/decks/${source.id}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetDeckId }),
      });
      if (res.ok) {
        // Source deck is gone; its children were reparented to the target. Pull
        // fresh decks + counts so the pills reflect the merged totals.
        await reload();
        toast.success(t('flashcards.decks.toast.merged'));
      } else {
        toast.error(t('flashcards.decks.toast.mergeFailed'));
      }
      return;
    }
    // mode === 'move' — move all of source's cards into target via bulk endpoint.
    const cardIds = await fetchDeckCardIds(source.id);
    if (cardIds.length === 0) {
      toast.success(t('flashcards.decks.toast.movedAll'));
      return;
    }
    const res = await fetch('/api/flashcards/manage/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'moveToDeck', cardIds, deckId: targetDeckId }),
    });
    if (res.ok) {
      await reload();
      toast.success(t('flashcards.decks.toast.movedAll'));
    } else {
      toast.error(t('flashcards.decks.toast.moveAllFailed'));
    }
  }

  async function doDelete(deck: DeckTreeDto, disposition: 'moveToDefault' | 'deleteCards') {
    setDeleteTarget(null);
    const res = await fetch(`/api/flashcards/decks/${deck.id}?disposition=${disposition}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setDecks((prev) =>
        prev
          .filter((d) => d.id !== deck.id)
          // Children are reparented to root by the server on delete.
          .map((d) => (d.parentDeckId === deck.id ? { ...d, parentDeckId: null } : d)),
      );
      toast.success(t('flashcards.decks.toast.deleted'));
    } else {
      toast.error(t('flashcards.decks.toast.deleteFailed'));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-2">
      <div className="mx-auto px-2 pt-2">
        <Link
          href={'/flashcards' as Route}
          className="text-sm text-muted-foreground hover:text-foreground"
          data-testid="decks-back-link"
        >
          ← {t('flashcards.decks.back')}
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-semibold">{t('flashcards.decks.title')}</h1>
        <Button type="button" variant="outline" size="sm" onClick={() => void newDeck()}>
          {t('flashcards.decks.newDeck')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('flashcards.decks.intro')}</p>

      {flat.length === 0 ? (
        <p className="rounded border bg-card p-8 text-center text-muted-foreground">
          {t('flashcards.decks.empty')}
        </p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <RootDropZone>
            <ul className="space-y-1" data-testid="decks-tree">
              {flat.map(({ deck, depth }) => (
                <DeckRow
                  key={deck.id}
                  deck={deck}
                  depth={depth}
                  count={counts.get(deck.id) ?? { ...EMPTY_COUNT, deckId: deck.id }}
                  isDefault={deck.name === DEFAULT_DECK_NAME}
                  onRename={(next) => void rename(deck, next)}
                  onIconChange={(icon) =>
                    void applyPatch(
                      deck.id,
                      { icon },
                      t('flashcards.decks.toast.iconUpdated'),
                      t('flashcards.decks.toast.optionsFailed'),
                    )
                  }
                  onColorChange={(color) =>
                    void applyPatch(
                      deck.id,
                      { color },
                      t('flashcards.decks.toast.colorUpdated'),
                      t('flashcards.decks.toast.optionsFailed'),
                    )
                  }
                  onSaveOptions={(opts) =>
                    void applyPatch(
                      deck.id,
                      opts,
                      t('flashcards.decks.toast.optionsSaved'),
                      t('flashcards.decks.toast.optionsFailed'),
                    )
                  }
                  onMoveAll={() => setMoveTarget({ deck, mode: 'move' })}
                  onMerge={() => setMoveTarget({ deck, mode: 'merge' })}
                  onDelete={() => setDeleteTarget(deck)}
                />
              ))}
            </ul>
          </RootDropZone>
        </DndContext>
      )}

      {moveTarget ? (
        <MoveOrMergeDialog
          decks={decks}
          source={moveTarget.deck}
          mode={moveTarget.mode}
          onCancel={() => setMoveTarget(null)}
          onConfirm={(targetDeckId) =>
            void doMoveOrMerge(moveTarget.deck, moveTarget.mode, targetDeckId)
          }
        />
      ) : null}

      {deleteTarget ? (
        <DeleteDeckDialog
          deck={deleteTarget}
          count={counts.get(deleteTarget.id) ?? { ...EMPTY_COUNT, deckId: deleteTarget.id }}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={(disposition) => void doDelete(deleteTarget, disposition)}
        />
      ) : null}
    </div>
  );
}

async function fetchDeckCardIds(deckId: string): Promise<string[]> {
  const res = await fetch(`/api/flashcards/manage?deck=${encodeURIComponent(deckId)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { cards: Array<{ id: string }> };
  return body.cards.map((c) => c.id);
}

// ---------------------------------------------------------------------------

function RootDropZone({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROPPABLE_ID });
  return (
    <div
      ref={setNodeRef}
      data-testid="decks-root-dropzone"
      title={t('flashcards.decks.rootDropLabel')}
      className={cn(
        'rounded-md border border-transparent p-1',
        isOver && 'border-primary bg-accent/40',
      )}
    >
      {children}
    </div>
  );
}

function DeckRow({
  deck,
  depth,
  count,
  isDefault,
  onRename,
  onIconChange,
  onColorChange,
  onSaveOptions,
  onMoveAll,
  onMerge,
  onDelete,
}: {
  deck: DeckTreeDto;
  depth: number;
  count: DeckCountDto;
  isDefault: boolean;
  onRename: (next: string) => void;
  onIconChange: (icon: string | null) => void;
  onColorChange: (color: string | null) => void;
  onSaveOptions: (opts: DeckPatch) => void;
  onMoveAll: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: deck.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: deck.id });
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(deck.name);

  const colorHex = deck.color ? COLOR_HEX.get(deck.color) : undefined;

  return (
    <li
      ref={setDropRef}
      data-testid="decks-tree-row"
      data-deck-id={deck.id}
      style={{ marginInlineStart: `${depth * 20}px` }}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border bg-card p-2',
        isDragging && 'opacity-60',
        isOver && 'border-primary bg-accent/40',
      )}
    >
      <button
        type="button"
        ref={setDragRef}
        className="flex min-h-11 min-w-11 cursor-grab items-center justify-center text-muted-foreground"
        aria-label={t('flashcards.decks.dragHandle')}
        data-testid="deck-drag-handle"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>

      {colorHex ? (
        <span
          className="size-3 shrink-0 rounded-full border border-border"
          style={{ backgroundColor: colorHex }}
          aria-hidden
        />
      ) : null}

      <IconPicker value={deck.icon} onChange={onIconChange} />

      {editingName ? (
        <Input
          value={nameDraft}
          autoFocus
          aria-label={t('flashcards.decks.renameLabel')}
          className="h-8 w-44"
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            setEditingName(false);
            onRename(nameDraft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setEditingName(false);
              onRename(nameDraft);
            } else if (e.key === 'Escape') {
              setEditingName(false);
              setNameDraft(deck.name);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="min-h-11 flex-1 truncate text-left font-medium hover:underline"
          data-testid="deck-name"
          title={t('flashcards.decks.rename')}
          onClick={() => {
            setNameDraft(deck.name);
            setEditingName(true);
          }}
        >
          {deck.name}
          {isDefault ? (
            <span className="ms-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {t('flashcards.decks.defaultBadge')}
            </span>
          ) : null}
        </button>
      )}

      <div className="flex items-center gap-1" data-testid="deck-count-pills">
        <CountPill
          n={count.new}
          label={t('flashcards.decks.pill.new')}
          aria={t('flashcards.decks.pill.newAria', { count: count.new })}
        />
        <CountPill
          n={count.learning}
          label={t('flashcards.decks.pill.learning')}
          aria={t('flashcards.decks.pill.learningAria', { count: count.learning })}
        />
        <CountPill
          n={count.review}
          label={t('flashcards.decks.pill.review')}
          aria={t('flashcards.decks.pill.reviewAria', { count: count.review })}
        />
        <CountPill
          n={count.mature}
          label={t('flashcards.decks.pill.mature')}
          aria={t('flashcards.decks.pill.matureAria', { count: count.mature })}
        />
      </div>

      <DeckColorPicker value={deck.color} onChange={onColorChange} />

      <DeckOptionsPopover deck={deck} onSave={onSaveOptions} />

      <Button type="button" variant="outline" size="sm" asChild>
        <Link href={`/flashcards/study?deck=${deck.id}` as Route} data-testid="deck-study-link">
          {t('flashcards.decks.study')}
        </Link>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('flashcards.decks.menu')}
            data-testid="deck-menu-trigger"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onMoveAll}>
            {t('flashcards.decks.menu.moveAll')}
          </DropdownMenuItem>
          {!isDefault ? (
            <DropdownMenuItem onSelect={onMerge}>
              {t('flashcards.decks.menu.merge')}
            </DropdownMenuItem>
          ) : null}
          {!isDefault ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onSelect={onDelete}
                data-testid="deck-delete-item"
              >
                {t('flashcards.decks.menu.delete')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function CountPill({ n, label, aria }: { n: number; label: string; aria: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground" title={label}>
      <span aria-hidden>{n}</span>
      <span className="sr-only">{aria}</span>
    </span>
  );
}

function DeckColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('flashcards.decks.color')}
          title={t('flashcards.decks.color')}
          data-testid="deck-color-trigger"
        >
          <Palette className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-6 gap-0.5">
          {COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-label={t(`flashcards.decks.color.${c.key}`)}
              title={t(`flashcards.decks.color.${c.key}`)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-accent"
              onClick={() => {
                onChange(c.key);
                setOpen(false);
              }}
            >
              <span
                className={cn(
                  'size-5 rounded-full border',
                  value === c.key ? 'border-foreground' : 'border-border',
                )}
                style={{ backgroundColor: c.hex }}
                aria-hidden
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mt-1 inline-flex min-h-11 w-full items-center rounded-md px-2 text-sm text-muted-foreground hover:bg-accent"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          {t('flashcards.decks.color.none')}
        </button>
      </PopoverContent>
    </Popover>
  );
}

function numOrNull(v: string): number | null {
  const trimmed = v.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function DeckOptionsPopover({
  deck,
  onSave,
}: {
  deck: DeckTreeDto;
  onSave: (opts: DeckPatch) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const newPerDayId = useId();
  const reviewLimitId = useId();
  const easeId = useId();
  const [newPerDay, setNewPerDay] = useState(deck.defaultNewPerDay?.toString() ?? '');
  const [reviewLimit, setReviewLimit] = useState(deck.defaultReviewLimit?.toString() ?? '');
  const [ease, setEase] = useState(deck.easeStart?.toString() ?? '');

  function save() {
    onSave({
      defaultNewPerDay: numOrNull(newPerDay),
      defaultReviewLimit: numOrNull(reviewLimit),
      easeStart: numOrNull(ease),
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('flashcards.decks.options')}
          title={t('flashcards.decks.options')}
          data-testid="deck-options-trigger"
        >
          <Settings2 className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div>
          <p className="font-medium text-sm">{t('flashcards.decks.options.title')}</p>
          <p className="text-muted-foreground text-xs">
            {t('flashcards.decks.options.description')}
          </p>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={newPerDayId}>{t('flashcards.decks.options.newPerDay')}</Label>
          <Input
            id={newPerDayId}
            type="number"
            inputMode="numeric"
            min={0}
            value={newPerDay}
            placeholder={t('flashcards.decks.options.inheritPlaceholder')}
            onChange={(e) => setNewPerDay(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={reviewLimitId}>{t('flashcards.decks.options.reviewLimit')}</Label>
          <Input
            id={reviewLimitId}
            type="number"
            inputMode="numeric"
            min={0}
            value={reviewLimit}
            placeholder={t('flashcards.decks.options.inheritPlaceholder')}
            onChange={(e) => setReviewLimit(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={easeId}>{t('flashcards.decks.options.startingEase')}</Label>
          <Input
            id={easeId}
            type="number"
            inputMode="decimal"
            step="0.1"
            value={ease}
            placeholder={t('flashcards.decks.options.inheritPlaceholder')}
            onChange={(e) => setEase(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            {t('flashcards.decks.options.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={save} data-testid="deck-options-save">
            {t('flashcards.decks.options.save')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MoveOrMergeDialog({
  decks,
  source,
  mode,
  onCancel,
  onConfirm,
}: {
  decks: DeckTreeDto[];
  source: DeckTreeDto;
  mode: 'move' | 'merge';
  onCancel: () => void;
  onConfirm: (targetDeckId: string) => void;
}) {
  const t = useT();
  const [target, setTarget] = useState<string | undefined>(undefined);
  // Forbid choosing the source itself; for merge also forbid its descendants
  // (the server reparents children to the target, so a descendant target is a
  // guaranteed conflict). For move, only the source is excluded.
  const disabled = useMemo(
    () => (mode === 'merge' ? descendantIds(decks, source.id) : new Set([source.id])),
    [decks, source.id, mode],
  );

  const titleKey =
    mode === 'merge' ? 'flashcards.decks.merge.title' : 'flashcards.decks.moveAll.title';
  const descKey =
    mode === 'merge'
      ? 'flashcards.decks.merge.description'
      : 'flashcards.decks.moveAll.description';
  const confirmKey =
    mode === 'merge' ? 'flashcards.decks.merge.confirm' : 'flashcards.decks.moveAll.confirm';

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(titleKey)}</DialogTitle>
          <DialogDescription>{t(descKey)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1 py-2">
          <Label>{t('flashcards.decks.picker.label')}</Label>
          <DeckTreePicker
            decks={decks}
            value={target}
            onValueChange={setTarget}
            placeholder={t('flashcards.decks.picker.placeholder')}
            disabledIds={disabled}
            triggerTestId="move-merge-target-picker"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('flashcards.decks.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!target}
            onClick={() => target && onConfirm(target)}
            data-testid="move-merge-confirm"
          >
            {t(confirmKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDeckDialog({
  deck,
  count,
  onCancel,
  onConfirm,
}: {
  deck: DeckTreeDto;
  count: DeckCountDto;
  onCancel: () => void;
  onConfirm: (disposition: 'moveToDefault' | 'deleteCards') => void;
}) {
  const t = useT();
  const fieldId = useId();
  const [disposition, setDisposition] = useState<'moveToDefault' | 'deleteCards'>('moveToDefault');
  const [value, setValue] = useState('');
  const phrase = t('flashcards.decks.delete.phrase');
  const matches = value.trim() === phrase;
  const total = count.new + count.learning + count.review + count.mature;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('flashcards.decks.delete.title')} — {deck.name}
          </DialogTitle>
          <DialogDescription>
            {t('flashcards.decks.delete.description', { phrase })}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2 py-2">
          <legend className="text-sm font-medium">
            {t('flashcards.decks.delete.disposition')}
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="deck-delete-disposition"
              checked={disposition === 'moveToDefault'}
              onChange={() => setDisposition('moveToDefault')}
              data-testid="disposition-move"
            />
            {t('flashcards.decks.delete.moveToDefault')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="deck-delete-disposition"
              checked={disposition === 'deleteCards'}
              onChange={() => setDisposition('deleteCards')}
              data-testid="disposition-delete"
            />
            {total > 0
              ? t('flashcards.decks.delete.deleteCards', { count: total })
              : t('flashcards.decks.delete.deleteCardsZero')}
          </label>
        </fieldset>
        <div className="grid gap-2">
          <Label htmlFor={fieldId}>{t('flashcards.decks.delete.confirmLabel', { phrase })}</Label>
          <Input
            id={fieldId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="deck-delete-confirm-input"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('flashcards.decks.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!matches}
            onClick={() => onConfirm(disposition)}
            data-testid="deck-delete-confirm-button"
          >
            {t('flashcards.decks.delete.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
