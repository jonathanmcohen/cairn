'use client';

import { Search } from 'lucide-react';

/**
 * Visible search affordance with a ⌘K hint. The SearchPalette listens for
 * `(metaKey || ctrlKey) && key === 'k'` on `window` (see `search-palette.tsx`),
 * so clicking this button dispatches the same synthetic shortcut to toggle it
 * open — keeping a single source of truth for the open mechanism.
 */
export function SearchHintButton() {
  function open() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  }
  return (
    <button
      type="button"
      onClick={open}
      className="mb-2 flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-background px-2 py-2 text-sm text-muted-foreground hover:bg-accent"
    >
      <Search aria-hidden="true" className="h-4 w-4" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
        ⌘K
      </kbd>
    </button>
  );
}
