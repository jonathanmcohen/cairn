'use client';

import { Command } from 'cmdk';
import { Bookmark } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ensureAppShortcuts } from '@/components/shortcuts/app-shortcuts';
import { copy } from '@/lib/copy/messages';
import { useT } from '@/lib/i18n/provider';
import { buildPaletteActions, type PaletteAction } from '@/lib/palette/actions';
import { highlightMatch } from '@/lib/palette/highlight';
import { getRecents, pushRecent } from '@/lib/palette/recents';
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
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [actions, setActions] = useState<PaletteAction[]>([]);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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
    const name = window.prompt(t('palette.saveSearch.namePrompt'), q);
    if (!name) return;
    const r = await fetch('/api/search/saved', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, query: q, filters: {} }),
    });
    if (r.ok) {
      void refreshSaved();
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
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
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
  }, [query]);

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
        className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
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
          className="w-full bg-transparent px-4 py-3 text-sm outline-hidden placeholder:text-muted-foreground"
        />
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
          {loading && <div className="px-4 py-2 text-sm text-muted-foreground">Searching…</div>}
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
