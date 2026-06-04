'use client';

import { Bookmark, Check, Pencil, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { subscribeMutation } from '@/lib/client/mutation-bus';
import { useT } from '@/lib/i18n/provider';

type Saved = {
  id: string;
  name: string;
  query: string;
  filters: Record<string, unknown>;
};

/**
 * Minimal per-user saved-searches sidebar section. Loads on mount, renders
 * nothing when empty. Clicking a row navigates to `/search?q=...`; the × button
 * deletes after a `confirm()`; the pencil button enters inline rename mode
 * (PATCH /api/search/saved/{id}).
 */
export function SavedSearches() {
  const t = useT();
  const confirm = useConfirm();
  const [items, setItems] = useState<Saved[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/search/saved');
      if (!r.ok) return;
      const data = (await r.json()) as { savedSearches: Saved[] };
      setItems(data.savedSearches);
    } catch {
      // silent — section just stays empty
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeMutation('savedSearches', () => void load());
  }, [load]);

  async function remove(id: string, name: string) {
    const ok = await confirm({
      title: t('savedSearches.confirmDelete', { name }),
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    const r = await fetch(`/api/search/saved/${id}`, { method: 'DELETE' });
    if (r.ok) {
      setItems((xs) => xs.filter((x) => x.id !== id));
    }
  }

  function startRename(s: Saved) {
    setEditingId(s.id);
    setDraftName(s.name);
  }

  function cancelRename() {
    setEditingId(null);
    setDraftName('');
  }

  async function saveRename(id: string) {
    const name = draftName.trim();
    if (!name) return;
    const r = await fetch(`/api/search/saved/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, name } : x)));
    }
    cancelRename();
  }

  if (items.length === 0) return null;

  return (
    <section aria-label={t('savedSearches.heading')} className="mb-3">
      <div className="mb-1 flex items-center gap-2 px-2">
        <Bookmark aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('savedSearches.heading')}
        </p>
      </div>
      <ul>
        {items.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent"
          >
            {editingId === s.id ? (
              <>
                <input
                  // biome-ignore lint/a11y/noAutofocus: focus the field the user just opened for rename
                  autoFocus
                  aria-label={t('savedSearches.rename')}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void saveRename(s.id);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  className="min-h-11 flex-1 rounded border bg-background px-2 text-sm"
                />
                <button
                  type="button"
                  aria-label={t('savedSearches.save')}
                  onClick={() => void saveRename(s.id)}
                  className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  <Check aria-hidden="true" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={t('savedSearches.cancel')}
                  onClick={cancelRename}
                  className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <a
                  className="flex-1 truncate"
                  href={`/search?q=${encodeURIComponent(s.query)}`}
                  title={s.name}
                >
                  {s.name}
                </a>
                <button
                  type="button"
                  aria-label={t('savedSearches.renameLabel', { name: s.name })}
                  onClick={() => startRename(s)}
                  className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={t('savedSearches.deleteLabel', { name: s.name })}
                  onClick={() => void remove(s.id, s.name)}
                  className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-destructive"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
