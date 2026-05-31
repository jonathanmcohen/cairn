'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/empty-state/empty-state';
import { useT } from '@/lib/i18n/provider';
import type { ViewProps } from './table-view';

export function GalleryView({ databaseId, meta, rows, onChange }: ViewProps) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const titleProp = meta.properties.find((p) => p.type === 'text') ?? meta.properties[0];
  const otherProps = meta.properties.filter((p) => p.id !== titleProp?.id);

  function renderValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? '✓' : '';
    return String(value);
  }

  async function addRow() {
    setAdding(true);
    try {
      await fetch(`/api/databases/${databaseId}/rows`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      onChange();
    } finally {
      setAdding(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          headline={t('db.gallery.empty.title')}
          guidance={t('db.gallery.empty.guidance')}
          ctaLabel={t('database.empty.firstRow')}
          onCta={() => void addRow()}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => {
        const title = titleProp ? renderValue(r.cells[titleProp.id]) : '';
        return (
          <div key={r.row.id} className="rounded-md border bg-background p-3 shadow-xs">
            <div className="mb-2 font-medium">{title || t('database.untitled')}</div>
            <dl className="space-y-1">
              {otherProps.map((p) => {
                const val = renderValue(r.cells[p.id]);
                if (!val) return null;
                return (
                  <div key={p.id} className="flex gap-2 text-xs">
                    <dt className="text-muted-foreground">{p.name}:</dt>
                    <dd>{val}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
