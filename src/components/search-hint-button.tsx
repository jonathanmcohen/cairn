'use client';

import { Search } from 'lucide-react';
import { useT } from '@/lib/i18n/provider';

/**
 * Visible affordance that opens the global command palette (cmdk), which is
 * Cairn's page-search + commands + recents surface. The SearchPalette listens
 * for `(metaKey || ctrlKey) && key === 'k'` on `window` (see
 * `search-palette.tsx`), so clicking this button dispatches the same synthetic
 * ⌘K shortcut to toggle it open — a single source of truth for the open
 * mechanism. v0.9.4 #97: the label names the palette (rather than reading as a
 * bare page-search box, which the prior "Search…" label implied).
 */
export function SearchHintButton() {
  const t = useT();
  function open() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  }
  return (
    <button
      type="button"
      onClick={open}
      aria-label={t('searchHint.aria')}
      aria-keyshortcuts="Meta+K"
      className="mb-1 flex min-h-[36px] w-full items-center gap-2 rounded-md border border-input bg-background px-2 py-0.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] text-muted-foreground hover:bg-accent pointer-coarse:min-h-11 pointer-coarse:py-1.5"
    >
      <Search aria-hidden="true" className="h-4 w-4" />
      <span className="flex-1 text-left">{t('searchHint.label')}</span>
      <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
        ⌘K
      </kbd>
    </button>
  );
}
