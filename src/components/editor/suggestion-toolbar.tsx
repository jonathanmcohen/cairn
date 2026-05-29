'use client';

import type { Editor as TiptapEditor } from '@tiptap/react';

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
}) {
  return (
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
          <button
            type="button"
            onClick={onMarkInsert}
            disabled={!editor || editor.state.selection.empty}
            className="rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent disabled:opacity-50"
          >
            Mark insert
          </button>
          <button
            type="button"
            onClick={onMarkDelete}
            disabled={!editor || editor.state.selection.empty}
            className="rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent disabled:opacity-50"
          >
            Mark delete
          </button>
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
        // a30 #39 (round-2 styling) — the open-suggestion count is a quiet
        // resting status, so it carries a hairline border instead of a filled
        // `bg-muted` chip (the filled fill read as an active/selected state at
        // rest, competing with the genuinely-active Suggesting toggle). The
        // count badge itself stays a distinct, separated affordance — interactivity
        // (click-to-open the resolve list) is owned by the -23- plan and slots
        // onto this same element.
        <span className="inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-muted-foreground text-xs">
          {openCount} open
        </span>
      )}
    </div>
  );
}
