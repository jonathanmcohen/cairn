'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { computeFormula } from '@/lib/databases/formula';

const TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'formula',
  'relation',
] as const;

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
  const [expression, setExpression] = useState('');
  const [targetDatabaseId, setTargetDatabaseId] = useState('');
  const [databases, setDatabases] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (type !== 'relation') return;
    let cancelled = false;
    void fetch('/api/databases')
      .then((r) => r.json())
      .then((data: { databases?: { id: string; title: string }[] }) => {
        if (!cancelled) setDatabases(data.databases ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  function configForType() {
    if (type === 'select' || type === 'multi_select') return { options: [] };
    if (type === 'formula') return { expression };
    if (type === 'relation') return { targetDatabaseId };
    return {};
  }

  async function addProperty() {
    if (!name.trim()) return;
    if (type === 'relation' && !targetDatabaseId) return;
    setBusy(true);
    await fetch(`/api/databases/${databaseId}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        type,
        config: configForType(),
      }),
    });
    setBusy(false);
    setName('');
    setExpression('');
    setTargetDatabaseId('');
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
    <div className="space-y-2 border-t px-3 py-2">
      <div className="flex items-center gap-2">
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
        {type === 'relation' && (
          <select
            aria-label="Target database"
            value={targetDatabaseId}
            onChange={(e) => setTargetDatabaseId(e.target.value)}
            className="rounded border bg-transparent px-2 py-1 text-sm outline-none"
          >
            <option value="">Target database…</option>
            {databases
              .filter((d) => d.id !== databaseId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title || 'Untitled'}
                </option>
              ))}
          </select>
        )}
        <Button size="sm" disabled={busy} onClick={() => void addProperty()}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {type === 'formula' && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="formula-expr">
            Expression
          </label>
          <input
            id="formula-expr"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm font-mono"
            value={expression}
            placeholder='e.g. Price * Qty  or  if(Done, "✓", "")'
            onChange={(e) => setExpression(e.target.value)}
          />
          {(() => {
            if (expression.trim() === '') return null;
            const probe = computeFormula(expression, { nameToId: new Map(), cells: {} });
            const msg =
              typeof probe === 'object' && probe !== null && '__error' in probe
                ? String((probe as { __error: string }).__error)
                : null;
            // Unknown-property errors are expected against the empty probe context; only
            // syntax / unknown-function problems are real authoring errors.
            const isAuthoringError =
              msg !== null &&
              (msg.startsWith('unknown function') || !msg.startsWith('unknown property'));
            return isAuthoringError ? (
              <p className="text-xs text-destructive">{msg}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Computed at read time. Filtering/sorting on formulas is not supported in this
                version.
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}
