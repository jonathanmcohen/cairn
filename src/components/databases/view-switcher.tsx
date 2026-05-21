'use client';

import { useState } from 'react';

export type ViewTab = { id: string; type: string; name: string };

export function ViewSwitcher({
  databaseId,
  views,
  activeId,
  onChange,
  onViewsChanged,
}: {
  databaseId: string;
  views: ViewTab[];
  activeId: string;
  onChange: (id: string) => void;
  onViewsChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  async function addView(type: 'table' | 'kanban' | 'gallery') {
    setAdding(true);
    await fetch(`/api/databases/${databaseId}/views`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type,
        name: type.charAt(0).toUpperCase() + type.slice(1),
        config: type === 'kanban' ? { groupBy: null } : {},
      }),
    });
    setAdding(false);
    onViewsChanged();
  }

  return (
    <div className="flex items-center gap-1 border-b px-2 py-1">
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onChange(v.id)}
          className={`rounded px-2 py-1 text-sm ${v.id === activeId ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent'}`}
        >
          {v.name}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          disabled={adding}
          onClick={() => void addView('table')}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          + Table
        </button>
        <button
          type="button"
          disabled={adding}
          onClick={() => void addView('gallery')}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          + Gallery
        </button>
      </div>
    </div>
  );
}
