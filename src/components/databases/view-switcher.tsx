'use client';

import { useState } from 'react';

export type ViewTab = { id: string; type: string; name: string };

type DateProp = { id: string; name: string };

export function ViewSwitcher({
  databaseId,
  views,
  activeId,
  dateProperties,
  onChange,
  onViewsChanged,
}: {
  databaseId: string;
  views: ViewTab[];
  activeId: string;
  dateProperties: DateProp[];
  onChange: (id: string) => void;
  onViewsChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  // Which date-requiring type is mid-add ('calendar' | 'timeline' | null).
  const [pendingType, setPendingType] = useState<'calendar' | 'timeline' | null>(null);
  const [pickedDateProp, setPickedDateProp] = useState<string>('');

  async function addSimpleView(type: 'table' | 'gallery') {
    setAdding(true);
    await fetch(`/api/databases/${databaseId}/views`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type,
        name: type.charAt(0).toUpperCase() + type.slice(1),
        config: {},
      }),
    });
    setAdding(false);
    onViewsChanged();
  }

  async function addDateView() {
    if (!pendingType || !pickedDateProp) return;
    setAdding(true);
    await fetch(`/api/databases/${databaseId}/views`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: pendingType,
        name: pendingType.charAt(0).toUpperCase() + pendingType.slice(1),
        config: { dateProperty: pickedDateProp },
      }),
    });
    setAdding(false);
    setPendingType(null);
    setPickedDateProp('');
    onViewsChanged();
  }

  function startDateView(type: 'calendar' | 'timeline') {
    setPendingType(type);
    setPickedDateProp(dateProperties[0]?.id ?? '');
  }

  return (
    <div className="flex flex-col gap-1 border-b px-2 py-1">
      <div className="flex items-center gap-1">
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
            onClick={() => void addSimpleView('table')}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            + Table
          </button>
          <button
            type="button"
            disabled={adding}
            onClick={() => void addSimpleView('gallery')}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            + Gallery
          </button>
          <button
            type="button"
            disabled={adding || dateProperties.length === 0}
            title={dateProperties.length === 0 ? 'Add a date property first' : undefined}
            onClick={() => startDateView('calendar')}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            + Calendar
          </button>
          <button
            type="button"
            disabled={adding || dateProperties.length === 0}
            title={dateProperties.length === 0 ? 'Add a date property first' : undefined}
            onClick={() => startDateView('timeline')}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            + Timeline
          </button>
        </div>
      </div>
      {pendingType && (
        <div className="flex items-center gap-2 px-1 pb-1 text-xs">
          <label className="flex items-center gap-2 text-muted-foreground">
            {pendingType} date property:
            <select
              value={pickedDateProp}
              onChange={(e) => setPickedDateProp(e.target.value)}
              className="rounded border bg-background px-1 py-0.5"
            >
              {dateProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={adding || !pickedDateProp}
            onClick={() => void addDateView()}
            className="rounded bg-accent px-2 py-0.5 font-medium hover:bg-accent/80"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setPendingType(null)}
            className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
