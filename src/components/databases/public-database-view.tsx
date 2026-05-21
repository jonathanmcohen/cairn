'use client';

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useEffect, useState } from 'react';

type Meta = {
  database: { id: string; name: string };
  properties: { id: string; name: string; type: string; position: number }[];
  rows: { row: { id: string }; cells: Record<string, unknown> }[];
};

function renderCell(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? '✓' : '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function PublicDatabaseView({ node }: NodeViewProps) {
  const databaseId = (node.attrs as { databaseId?: string }).databaseId ?? '';
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!databaseId) {
      setLoading(false);
      return;
    }
    void fetch(`/api/public/databases/${databaseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: Meta | null) => setMeta(m))
      .catch(() => setMeta(null))
      .finally(() => setLoading(false));
  }, [databaseId]);

  if (loading) {
    return (
      <NodeViewWrapper className="my-4 rounded-md border p-4 text-sm text-muted-foreground">
        Loading database…
      </NodeViewWrapper>
    );
  }
  if (!meta) {
    return (
      <NodeViewWrapper className="my-4 rounded-md border p-4 text-sm text-muted-foreground">
        Database unavailable
      </NodeViewWrapper>
    );
  }

  const props = [...meta.properties].sort((a, b) => a.position - b.position);

  return (
    <NodeViewWrapper className="my-4 overflow-x-auto rounded-md border" contentEditable={false}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            {props.map((p) => (
              <th key={p.id} className="px-3 py-2 text-left font-medium">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {meta.rows.map((r) => (
            <tr key={r.row.id} className="border-b last:border-0">
              {props.map((p) => (
                <td key={p.id} className="px-3 py-2">
                  {renderCell(r.cells[p.id])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </NodeViewWrapper>
  );
}
