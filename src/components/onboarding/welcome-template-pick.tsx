'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export type PickableTemplate = {
  id: string;
  name: string;
  kind: 'page' | 'database';
  builtIn: boolean;
};

/**
 * Fetches the built-in template list from `/api/templates` and renders a
 * compact selectable grid. Selecting a card highlights it; the parent's
 * `onPick` callback receives the chosen template id (or null on deselect).
 *
 * If `/api/templates` is unavailable or returns no built-ins, falls back to a
 * single synthetic "Welcome to Cairn" card whose id is the special sentinel
 * `__welcome-fallback__` — the parent treats it as "skip instantiate" since
 * we can't resolve a real template id without the API.
 */
export function WelcomeTemplatePick({
  selectedId,
  onPick,
}: {
  selectedId: string | null;
  onPick: (id: string | null) => void;
}) {
  const [templates, setTemplates] = useState<PickableTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/templates');
        if (!res.ok) throw new Error(`Template list failed (${res.status})`);
        const data = (await res.json()) as { templates?: PickableTemplate[] };
        if (cancelled) return;
        const list = (data.templates ?? []).filter((t) => t.builtIn);
        if (list.length === 0) {
          setTemplates([
            {
              id: '__welcome-fallback__',
              name: 'Welcome to Cairn',
              kind: 'page',
              builtIn: true,
            },
          ]);
        } else {
          setTemplates(list);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load templates');
        setTemplates([
          {
            id: '__welcome-fallback__',
            name: 'Welcome to Cairn',
            kind: 'page',
            builtIn: true,
          },
        ]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading templates…</p>;
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p className="text-xs text-muted-foreground">{error} (showing fallback)</p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {templates.map((t) => {
          const active = selectedId === t.id;
          return (
            <Button
              key={t.id}
              type="button"
              variant={active ? 'default' : 'outline'}
              className="h-auto justify-start whitespace-normal py-3 text-left"
              onClick={() => onPick(active ? null : t.id)}
            >
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t.kind === 'database' ? 'Database template' : 'Page template'}
                </div>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
