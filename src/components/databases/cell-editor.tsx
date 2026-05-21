'use client';

import { useState } from 'react';

type Property = { id: string; name: string; type: string; config: unknown };

export function CellEditor({
  databaseId,
  rowId,
  property,
  value,
  onSaved,
}: {
  databaseId: string;
  rowId: string;
  property: Property;
  value: unknown;
  onSaved: () => void;
}) {
  const [local, setLocal] = useState<unknown>(value);

  async function save(next: unknown) {
    setLocal(next);
    await fetch(`/api/databases/${databaseId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cells: { [property.id]: next } }),
    });
    onSaved();
  }

  switch (property.type) {
    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={Boolean(local)}
          onChange={(e) => void save(e.target.checked)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          className="w-full bg-transparent outline-none"
          defaultValue={local === null || local === undefined ? '' : String(local)}
          onBlur={(e) => void save(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className="w-full bg-transparent outline-none"
          defaultValue={typeof local === 'string' ? local.slice(0, 10) : ''}
          onBlur={(e) => void save(e.target.value || null)}
        />
      );
    case 'select': {
      const options =
        (property.config as { options?: { id: string; name: string }[] })?.options ?? [];
      return (
        <select
          className="w-full bg-transparent outline-none"
          value={typeof local === 'string' ? local : ''}
          onChange={(e) => void save(e.target.value || null)}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    }
    default:
      // text, url, multi_select(simplified as comma string)
      return (
        <input
          type="text"
          className="w-full bg-transparent outline-none"
          defaultValue={
            Array.isArray(local)
              ? local.join(', ')
              : local === null || local === undefined
                ? ''
                : String(local)
          }
          onBlur={(e) => {
            if (property.type === 'multi_select') {
              const arr = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              void save(arr);
            } else {
              void save(e.target.value);
            }
          }}
        />
      );
  }
}
