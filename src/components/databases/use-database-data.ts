'use client';
import { useCallback, useEffect, useState } from 'react';

export type DatabaseMeta = {
  database: { id: string; name: string };
  properties: { id: string; name: string; type: string; config: unknown; position: number }[];
  views: { id: string; type: string; name: string; config: unknown; position: number }[];
};
export type RowData = {
  row: { id: string; createdAt: string; parentRowId: string | null };
  cells: Record<string, unknown>;
};

export function useDatabaseData(databaseId: string, viewId: string | null) {
  const [meta, setMeta] = useState<DatabaseMeta | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!databaseId) return;
    setLoading(true);
    try {
      const metaRes = await fetch(`/api/databases/${databaseId}`);
      if (metaRes.ok) {
        const m = (await metaRes.json()) as DatabaseMeta;
        setMeta(m);
        // Determine filters/sorts from the active view (or first view).
        const view = m.views.find((v) => v.id === viewId) ?? m.views[0];
        const cfg = (view?.config ?? {}) as { filters?: unknown[]; sorts?: unknown[] };
        const qs = new URLSearchParams();
        if (cfg.filters?.length) qs.set('filters', JSON.stringify(cfg.filters));
        if (cfg.sorts?.length) qs.set('sorts', JSON.stringify(cfg.sorts));
        const rowsRes = await fetch(`/api/databases/${databaseId}/rows?${qs.toString()}`);
        if (rowsRes.ok) {
          const body = (await rowsRes.json()) as { rows: RowData[] };
          setRows(body.rows);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [databaseId, viewId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { meta, rows, loading, refresh };
}
