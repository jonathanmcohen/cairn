'use client';

import type { Editor as TiptapEditor } from '@tiptap/react';
import { Minus, Plus } from 'lucide-react';
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
  onJumpToFirstOpen,
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
  /** #98 — focus + scroll to the first open suggestion mark in the document. */
  onJumpToFirstOpen: () => void;
}) {
  const t = useT();
  const markDisabled = !editor || editor.state.selection.empty;
  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={active}
          onClick={onToggle}
          className={
            active
              ? 'rounded bg-primary px-2 py-1 text-primary-foreground'
              : 'rounded px-2 py-1 text-muted-foreground hover:bg-accent'
          }
        >
          {active ? 'Suggesting' : 'Suggest edits'}
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
            onClick={onJumpToFirstOpen}
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
