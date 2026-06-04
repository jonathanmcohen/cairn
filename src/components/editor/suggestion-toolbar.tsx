'use client';

import type { Editor as TiptapEditor } from '@tiptap/react';
import { Minus, PencilLine, Plus } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import { useT } from '@/lib/i18n/provider';

export function SuggestionToolbar({
  editor,
  active,
  onToggle,
  openCount,
  onMarkInsert,
  onMarkDelete,
  resolvable,
  onAccept,
  onReject,
  onOpenDrawer,
  disabled = false,
}: {
  editor: TiptapEditor | null;
  active: boolean;
  onToggle: () => void;
  openCount: number;
  onMarkInsert: () => void;
  onMarkDelete: () => void;
  resolvable: string | null;
  onAccept: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
  /** #85/#145 — open the suggestions drawer listing open suggestions. */
  onOpenDrawer: () => void;
  /**
   * #188 — when the page is locked the toggle stays mounted (so the bar's
   * structure doesn't change), but is disabled with a hint, rather than
   * disappearing (which reads as a broken UI).
   */
  disabled?: boolean;
}) {
  const t = useT();
  const markDisabled = disabled || !editor || editor.state.selection.empty;
  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="suggest-toggle-chip"
          aria-pressed={active}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          title={disabled ? t('editor.suggest.lockedHint') : undefined}
          aria-label={t(
            active ? 'pageActions.suggest.toggleSuggesting' : 'pageActions.suggest.toggleSuggest',
          )}
          onClick={onToggle}
          className={
            active
              ? 'inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 font-medium text-primary-foreground text-xs disabled:opacity-50'
              : 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-muted-foreground text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
          }
        >
          <PencilLine aria-hidden="true" className="h-3.5 w-3.5" />
          {active
            ? t('pageActions.suggest.toggleSuggesting')
            : t('pageActions.suggest.toggleSuggest')}
        </button>
        {active && (
          <>
            {/* #101 — Mark insert/delete carry an icon + tooltip + accessible
                label. The compact text-xs + hover:bg-accent styling is kept
                (the strip is intentionally dense); icon + visible text match
                the rest of the bar while the aria-label names the control. */}
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  onClick={onMarkInsert}
                  disabled={markDisabled}
                  aria-label={t('pageActions.suggest.markInsert')}
                  className="inline-flex min-h-9 items-center gap-1 rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent disabled:opacity-50"
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  Mark insert
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  sideOffset={4}
                  className="z-50 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md"
                >
                  {t('pageActions.suggest.markInsert')}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  onClick={onMarkDelete}
                  disabled={markDisabled}
                  aria-label={t('pageActions.suggest.markDelete')}
                  className="inline-flex min-h-9 items-center gap-1 rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent disabled:opacity-50"
                >
                  <Minus aria-hidden="true" className="h-3.5 w-3.5" />
                  Mark delete
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  sideOffset={4}
                  className="z-50 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md"
                >
                  {t('pageActions.suggest.markDelete')}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </>
        )}
        {resolvable && (
          <>
            <button
              type="button"
              onClick={() => onAccept(resolvable)}
              className="rounded px-2 py-1 text-green-700 text-xs hover:bg-accent dark:text-green-400"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => onReject(resolvable)}
              className="rounded px-2 py-1 text-red-700 text-xs hover:bg-accent dark:text-red-400"
            >
              Reject
            </button>
          </>
        )}
        {openCount > 0 && (
          // a30 #39 (round-2 styling, preserved) — the open-suggestion count is a
          // quiet resting status, so it carries a hairline border instead of a
          // filled `bg-muted` chip (the filled fill read as an active/selected
          // state at rest, competing with the genuinely-active Suggesting toggle).
          // -23- #98 (interactivity) — it is now a <button> that jumps to and
          // focuses the first open suggestion mark in the document. The resting
          // hairline-border styling is kept; a hover + focus-ring affordance is
          // layered on so it reads as actionable.
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label={t('pageActions.suggest.openCountLabel', { count: openCount })}
            className="inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-muted-foreground text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          >
            {openCount} {t('pageActions.suggest.open')}
          </button>
        )}
      </div>
    </Tooltip.Provider>
  );
}
