'use client';

import { useEffect, useRef, useState } from 'react';

type TargetRow = { id: string; label: string };

export function RelationCell({
  databaseId,
  rowId,
  propertyId,
  targetDatabaseId,
  value,
  onSaved,
}: {
  databaseId: string;
  rowId: string;
  propertyId: string;
  targetDatabaseId: string;
  /** Resolved relation cell from listRows. */
  value: { ids: string[]; labels: string[] } | undefined;
  onSaved: () => void;
}) {
  const [ids, setIds] = useState<string[]>(value?.ids ?? []);
  const [labels, setLabels] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    (value?.ids ?? []).forEach((id, i) => {
      m[id] = value?.labels[i] ?? 'Untitled';
    });
    return m;
  });
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<TargetRow[]>([]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch(`/api/databases/${targetDatabaseId}/rows`)
      .then((r) => r.json())
      .then((data: { rows?: { row: { id: string }; cells: Record<string, unknown> }[] }) => {
        if (cancelled) return;
        // Derive a label from the first string cell value.
        const opts: TargetRow[] = (data.rows ?? []).map((r) => {
          const firstStr = Object.values(r.cells).find((v) => typeof v === 'string') as
            | string
            | undefined;
          return { id: r.row.id, label: firstStr?.trim() || 'Untitled' };
        });
        setOptions(opts);
      });
    return () => {
      cancelled = true;
    };
  }, [open, targetDatabaseId]);

  async function persist(nextIds: string[]) {
    setIds(nextIds);
    await fetch(`/api/databases/${databaseId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cells: { [propertyId]: nextIds } }),
    });
    onSaved();
  }

  function add(opt: TargetRow) {
    if (ids.includes(opt.id)) return;
    setLabels((m) => ({ ...m, [opt.id]: opt.label }));
    void persist([...ids, opt.id]);
  }

  function remove(id: string) {
    void persist(ids.filter((x) => x !== id));
  }

  const filtered = options.filter(
    (o) => !ids.includes(o.id) && o.label.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex flex-wrap items-center gap-1">
      {ids.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs"
        >
          {labels[id] ?? 'Untitled'}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => remove(id)}
            aria-label="Remove relation"
          >
            ×
          </button>
        </span>
      ))}
      {open ? (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search rows…"
            className="rounded border bg-transparent px-1.5 py-0.5 text-xs outline-none"
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {filtered.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-40 w-48 overflow-auto rounded border bg-popover text-xs shadow">
              {filtered.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="block w-full px-2 py-1 text-left hover:bg-accent"
                    onMouseDown={() => add(o)}
                  >
                    {o.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          onClick={() => setOpen(true)}
        >
          + Link
        </button>
      )}
    </div>
  );
}
