'use client';

import { Command } from 'cmdk';
import { Bookmark } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { openQuickCapture } from '@/components/quick-capture/controller';
import { ensureAppShortcuts } from '@/components/shortcuts/app-shortcuts';
import { usePrompt } from '@/components/ui/input-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useFocusTrap } from '@/lib/a11y/focus-trap';
import { emitMutation } from '@/lib/client/mutation-bus';
import { copy } from '@/lib/copy/messages';
import { useT } from '@/lib/i18n/provider';
import { buildPaletteActions, type PaletteAction } from '@/lib/palette/actions';
import { highlightMatch } from '@/lib/palette/highlight';
import { getRecents, pushRecent } from '@/lib/palette/recents';
import { SEARCH_MODES, useSearchMode } from '@/lib/search/use-search-mode';
import { prettyKeys, shortcutFor } from '@/lib/shortcuts/format';

/**
 * #117 — true when keyboard focus is inside an editable ProseMirror surface and
 * the current DOM selection spans a non-empty range. In that case ⌘K is the
 * editor's insert-link shortcut (EditorLinkShortcut), so the global palette
 * handler bails. A collapsed caret, or focus outside the editor, returns false
 * and the palette opens as before.
 */
function editorHasRangedSelection(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  // The editable editor surface is a `[contenteditable=true]` ProseMirror node.
  const inEditor =
    active instanceof HTMLElement && active.closest('.ProseMirror[contenteditable="true"]');
  if (!inEditor) return false;
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().length > 0;
}

type SearchResult = {
  id: string;
  title: string;
  snippet: string | null;
  breadcrumb: { id: string; title: string }[];
};

type SavedSearch = {
  id: string;
  name: string;
  query: string;
  filters: Record<string, unknown>;
};

export function SearchPalette({
  currentUserId,
  currentPageId = null,
}: {
  currentUserId: string;
  currentPageId?: string | null;
}) {
  const t = useT();
  const prompt = usePrompt();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { mode, setMode } = useSearchMode();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [actions, setActions] = useState<PaletteAction[]>([]);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // #169 — trap Tab/Shift+Tab inside the palette while it's open. cmdk owns
  // arrow-key list nav; the trap only governs Tab, so they don't collide.
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  // #109: focus the input whenever the palette opens. autoFocus on
  // Command.Input handles the common (fresh-mount) path; this effect covers
  // the case where cmdk reuses the node across opens.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    ensureAppShortcuts();
    setActions(
      buildPaletteActions({
        router: {
          push: (p: string) => router.push(p as Route),
          refresh: () => router.refresh(),
        },
        currentPageId,
        currentUserId,
        setTheme: (next) => setTheme(next),
        currentTheme: (theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system') as
          | 'light'
          | 'dark'
          | 'system',
        toast: (m) => toast(m),
        openNotifications: () => router.push('/notifications' as Route),
        quickCapture: () => openQuickCapture(),
      }),
    );
  }, [router, currentPageId, currentUserId, setTheme, theme]);

  // Refresh the recent ids whenever the palette opens.
  useEffect(() => {
    if (!open) return;
    setRecentIds(getRecents(currentUserId).slice(0, 5));
  }, [open, currentUserId]);

  const refreshSaved = useCallback(async () => {
    try {
      const r = await fetch('/api/search/saved');
      if (!r.ok) return;
      const data = (await r.json()) as { savedSearches: SavedSearch[] };
      setSaved(data.savedSearches);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshSaved();
  }, [open, refreshSaved]);

  async function saveCurrent() {
    const q = query.trim();
    if (!q) return;
    const name = await prompt({
      title: t('palette.saveSearch.namePrompt'),
      defaultValue: q,
      confirmLabel: 'Save',
    });
    if (!name) return;
    const r = await fetch('/api/search/saved', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, query: q, filters: {} }),
    });
    if (r.ok) {
      void refreshSaved();
      emitMutation('savedSearches');
      toast(t('palette.saveSearch.saved'));
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // #117 — tie-break with the editor's insert-link shortcut. When the
        // focused element is an editable ProseMirror surface AND the user has a
        // non-empty (ranged) text selection, ⌘K means "insert link" and is
        // handled by the EditorLinkShortcut extension — so the palette must NOT
        // open. With a collapsed caret (or focus outside the editor) ⌘K still
        // opens the palette unchanged.
        if (editorHasRangedSelection()) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&mode=${mode}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as { results: SearchResult[] };
          setResults(body.results);
        }
      } catch {
        // ignore aborted/network errors
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, mode]);

  function onSelect(id: string) {
    setOpen(false);
    setQuery('');
    router.push(`/pages/${id}` as Route);
  }

  if (!open) return null;

  const hasQuery = query.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[20vh]">
      <button
        type="button"
        aria-label="Close search"
        className="fixed inset-0 bg-black/30"
        onClick={() => setOpen(false)}
      />
      <Command
        ref={trapRef}
        data-cairn-palette=""
        className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-150"
        shouldFilter={false}
        onKeyDown={(e) => {
          // #114: a single Escape always closes the palette. Stop here so the
          // key never bubbles to page-level handlers and can't be swallowed by
          // cmdk's list-nav handler (which ignores Escape) requiring a 2nd press.
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setQuery('');
          }
        }}
      >
        <Command.Input
          ref={inputRef}
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={t('palette.searchPlaceholder')}
          className="w-full bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        />
        <fieldset className="flex items-center gap-1 border-t px-3 py-1.5">
          <legend className="sr-only">{t('search.mode.label')}</legend>
          <span className="mr-1 text-xs text-muted-foreground">{t('search.mode.label')}</span>
          {SEARCH_MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 text-xs ${
                mode === m
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              {t(`search.mode.${m}`)}
            </button>
          ))}
        </fieldset>
        <Command.List className="max-h-80 overflow-y-auto border-t">
          {hasQuery && results.length > 0 && (
            <Command.Group heading={t('palette.pages')}>
              {results.map((r) => (
                <Command.Item
                  key={r.id}
                  value={r.id}
                  onSelect={() => onSelect(r.id)}
                  className="cursor-pointer px-4 py-2 text-sm aria-selected:bg-accent"
                >
                  <div className="font-medium">{highlightMatch(r.title, query)}</div>
                  {r.breadcrumb.length > 1 && (
                    <div className="text-xs text-muted-foreground">
                      {r.breadcrumb
                        .slice(0, -1)
                        .map((b) => b.title)
                        .join(' / ')}
                    </div>
                  )}
                  {r.snippet && (
                    <div
                      className="palette-snippet mt-1 text-xs text-muted-foreground"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: ts_headline returns sanitized <b> markup; accepted v0.1.0 trust boundary
                      dangerouslySetInnerHTML={{ __html: r.snippet }}
                    />
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {loading && (
            <div role="status" className="space-y-2 px-4 py-2" aria-label={t('search.searching')}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          )}
          {!loading && query && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">{copy('empty.search.headline')}</div>
              <div className="mt-1">{copy('empty.search.guidance')}</div>
            </div>
          )}
          {!hasQuery && recentIds.length > 0 && (
            <Command.Group heading={t('palette.recent')}>
              {recentIds
                .map((id) => actions.find((a) => a.id === id))
                .filter((a): a is PaletteAction => a !== undefined)
                .map((a) => (
                  <Command.Item
                    key={`recent-${a.id}`}
                    value={`recent:${a.id}`}
                    onSelect={() => {
                      setOpen(false);
                      setQuery('');
                      pushRecent(currentUserId, a.id);
                      a.run();
                    }}
                    className="cursor-pointer px-4 py-2 text-sm aria-selected:bg-accent"
                  >
                    <div className="flex items-center justify-between">
                      <span>{a.label}</span>
                      {(() => {
                        const keys = shortcutFor(a.id);
                        return keys ? (
                          <kbd className="text-xs text-muted-foreground">{prettyKeys(keys)}</kbd>
                        ) : null;
                      })()}
                    </div>
                  </Command.Item>
                ))}
            </Command.Group>
          )}
          {actions.length > 0 && (
            <Command.Group heading={t('palette.actions')}>
              {actions.map((a) => (
                <Command.Item
                  key={a.id}
                  value={`action:${a.id}`}
                  onSelect={() => {
                    setOpen(false);
                    setQuery('');
                    pushRecent(currentUserId, a.id);
                    a.run();
                  }}
                  className="cursor-pointer px-4 py-2 text-sm aria-selected:bg-accent"
                >
                  <div className="flex items-center justify-between">
                    <span>{a.label}</span>
                    {(() => {
                      const keys = shortcutFor(a.id);
                      return keys ? (
                        <kbd className="text-xs text-muted-foreground">{prettyKeys(keys)}</kbd>
                      ) : null;
                    })()}
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {saved.length > 0 && (
            <Command.Group heading={t('palette.saved.heading')}>
              {saved.map((s) => (
                <Command.Item
                  key={s.id}
                  value={`saved:${s.id}`}
                  onSelect={() => setQuery(s.query)}
                  className="cursor-pointer px-4 py-2 text-sm aria-selected:bg-accent"
                >
                  {s.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        {query.trim().length > 0 && (
          <div className="flex justify-end border-t px-3 py-2">
            <button
              type="button"
              onClick={() => void saveCurrent()}
              aria-label={t('palette.saveSearch')}
              className="flex min-h-11 items-center gap-2 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Bookmark aria-hidden="true" className="h-3 w-3" />
              {t('palette.saveSearch')}
            </button>
          </div>
        )}
      </Command>
    </div>
  );
}
