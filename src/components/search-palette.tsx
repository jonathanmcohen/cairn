'use client';

import { Command } from 'cmdk';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ensureAppShortcuts } from '@/components/shortcuts/app-shortcuts';
import { getShortcuts } from '@/lib/shortcuts/registry';

type SearchResult = {
  id: string;
  title: string;
  snippet: string | null;
  breadcrumb: { id: string; title: string }[];
};

type PaletteAction = {
  id: string;
  labelKey: string;
  run: () => void;
};

export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [actions, setActions] = useState<PaletteAction[]>([]);

  useEffect(() => {
    ensureAppShortcuts();
    setActions(
      getShortcuts('global')
        .filter((s) => s.kind === 'action')
        .map((s) => ({ id: s.id, labelKey: s.labelKey, run: s.run })),
    );
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
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
      >
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search pages…"
          className="w-full bg-transparent px-4 py-3 text-sm outline-hidden placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-80 overflow-y-auto border-t">
          {actions.length > 0 && (
            <Command.Group heading="Actions">
              {actions.map((a) => (
                <Command.Item
                  key={a.id}
                  value={`action:${a.id}`}
                  onSelect={() => {
                    setOpen(false);
                    setQuery('');
                    a.run();
                  }}
                  className="cursor-pointer px-4 py-2 text-sm aria-selected:bg-accent"
                >
                  {a.labelKey}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {loading && <div className="px-4 py-2 text-sm text-muted-foreground">Searching…</div>}
          {!loading && query && results.length === 0 && (
            <div className="px-4 py-2 text-sm text-muted-foreground">No results.</div>
          )}
          {results.map((r) => (
            <Command.Item
              key={r.id}
              value={r.id}
              onSelect={() => onSelect(r.id)}
              className="cursor-pointer px-4 py-2 text-sm aria-selected:bg-accent"
            >
              <div className="font-medium">{r.title}</div>
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
                  className="mt-1 text-xs text-muted-foreground"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: ts_headline returns sanitized <b> markup; accepted v0.1.0 trust boundary
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              )}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
