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
      {openCount > 0 && <span className="text-muted-foreground text-xs">{openCount} open</span>}
    </div>
  );
}
