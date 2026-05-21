'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

const TYPES = ['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url'] as const;

export function PropertyPanel({
  databaseId,
  onChange,
}: {
  databaseId: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('text');
  const [busy, setBusy] = useState(false);

  async function addProperty() {
    if (!name.trim()) return;
    setBusy(true);
    await fetch(`/api/databases/${databaseId}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        type,
        config: type === 'select' || type === 'multi_select' ? { options: [] } : {},
      }),
    });
    setBusy(false);
    setName('');
    setOpen(false);
    onChange();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
      >
        + Add property
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 border-t px-3 py-2">
      <input
        type="text"
        placeholder="Property name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded border bg-transparent px-2 py-1 text-sm outline-hidden"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
        className="rounded border bg-transparent px-2 py-1 text-sm outline-hidden"
      >
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={busy} onClick={() => void addProperty()}>
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
