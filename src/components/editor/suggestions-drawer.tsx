'use client';

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useT } from '@/lib/i18n/provider';

/** A single open suggestion row, projected for the drawer list. */
export type OpenSuggestion = {
  id: string;
  /** Resolved author display name; falls back to a generic label upstream. */
  authorName: string;
  /**
   * #232 — inline diff halves for this suggestion, derived from the live doc by
   * computeDiffPreview(). Optional: a brand-new (empty) suggestion has neither half.
   */
  diff?: { deleted: string; inserted: string };
};

/**
 * #119 — The card's content region (author line + diff preview) is a single
 * <button> whose click invokes onView, so clicking the card body scrolls to
 * the suggestion. The Accept/Reject/View action buttons are siblings of that
 * content button (not descendants), so they fire independently with no nested
 * interactive elements and no need for stopPropagation. The <li> stays a plain,
 * non-interactive list item.
 */
function SuggestionCard({
  s,
  onView,
  onAccept,
  onReject,
}: {
  s: OpenSuggestion;
  onView: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const t = useT();
  return (
    <li key={s.id} className="rounded-md border p-3">
      <button
        type="button"
        onClick={() => onView(s.id)}
        className="block w-full cursor-pointer rounded-sm text-left hover:bg-accent/50 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      >
        <p className="text-muted-foreground text-xs">
          {t('pageActions.suggest.byAuthor', { author: s.authorName })}
        </p>
        {s.diff && (s.diff.deleted || s.diff.inserted) ? (
          <p className="mt-2 break-words text-sm leading-relaxed">
            {s.diff.deleted ? (
              <>
                <span className="sr-only">{t('pageActions.suggest.diffDeletedLabel')}: </span>
                <del
                  title={t('pageActions.suggest.diffDeletedLabel')}
                  className="rounded-sm bg-red-500/10 px-0.5 text-red-700 line-through decoration-red-500/70 dark:text-red-300"
                >
                  {s.diff.deleted}
                </del>
              </>
            ) : null}
            {s.diff.deleted && s.diff.inserted ? ' ' : null}
            {s.diff.inserted ? (
              <>
                <span className="sr-only">{t('pageActions.suggest.diffInsertedLabel')}: </span>
                <ins
                  title={t('pageActions.suggest.diffInsertedLabel')}
                  className="rounded-sm bg-green-500/10 px-0.5 text-green-700 no-underline dark:text-green-300"
                >
                  {s.diff.inserted}
                </ins>
              </>
            ) : null}
          </p>
        ) : null}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onView(s.id)}
          className="rounded px-2 py-1 text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        >
          {t('pageActions.suggest.viewInDoc')}
        </button>
        <button
          type="button"
          onClick={() => onAccept(s.id)}
          className="rounded px-2 py-1 text-green-700 text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:text-green-400"
        >
          {t('pageActions.suggest.accept')}
        </button>
        <button
          type="button"
          onClick={() => onReject(s.id)}
          className="rounded px-2 py-1 text-red-700 text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:text-red-400"
        >
          {t('pageActions.suggest.reject')}
        </button>
      </div>
    </li>
  );
}

export function SuggestionsDrawer({
  open,
  onOpenChange,
  suggestions,
  onAccept,
  onReject,
  onView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: OpenSuggestion[];
  onAccept: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
  /** Scroll the document to the suggestion's first mark and close the drawer. */
  onView: (suggestionId: string) => void;
}) {
  const t = useT();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          aria-label={t('pageActions.suggest.drawerTitle')}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Dialog.Title className="text-sm font-medium">
              {t('pageActions.suggest.drawerTitle')}
            </Dialog.Title>
            <Dialog.Close
              aria-label={t('pageActions.suggest.close')}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {suggestions.length === 0 ? (
              <p className="px-2 py-6 text-center text-muted-foreground text-sm">
                {t('pageActions.suggest.drawerEmpty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {suggestions.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    s={s}
                    onView={onView}
                    onAccept={onAccept}
                    onReject={onReject}
                  />
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
