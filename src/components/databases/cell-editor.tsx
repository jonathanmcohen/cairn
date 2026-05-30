'use client';

import { useState } from 'react';
import { DateField } from '@/components/ui/date-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RelationCell } from './relation-cell';

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
    case 'formula': {
      if (value && typeof value === 'object' && '__error' in value) {
        return (
          <span
            className="text-xs text-destructive"
            title={String((value as { __error: string }).__error)}
          >
            ⚠ error
          </span>
        );
      }
      const display =
        value === null || value === undefined
          ? ''
          : value instanceof Date
            ? value.toISOString().slice(0, 10)
            : String(value);
      return <span className="text-sm text-muted-foreground">{display}</span>;
    }
    case 'relation': {
      const targetDatabaseId = (property.config as { targetDatabaseId?: string })?.targetDatabaseId;
      if (!targetDatabaseId) {
        return <span className="text-xs text-destructive">no target db</span>;
      }
      return (
        <RelationCell
          databaseId={databaseId}
          rowId={rowId}
          propertyId={property.id}
          targetDatabaseId={targetDatabaseId}
          value={value as { ids: string[]; labels: string[] } | undefined}
          onSaved={onSaved}
        />
      );
    }
    case 'checkbox':
      return (
        <input
          type="checkbox"
          aria-label={property.name}
          checked={Boolean(local)}
          onChange={(e) => void save(e.target.checked)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          aria-label={property.name}
          className="w-full bg-transparent outline-hidden"
          defaultValue={local === null || local === undefined ? '' : String(local)}
          onBlur={(e) => void save(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <DateField
          label={property.name}
          hideLabel
          value={typeof local === 'string' ? local.slice(0, 10) : ''}
          onChange={(iso) => void save(iso || null)}
        />
      );
    case 'select': {
      const options =
        (property.config as { options?: { id: string; name: string }[] })?.options ?? [];
      const NONE = '__none';
      const current = typeof local === 'string' && local ? local : NONE;
      return (
        <Select value={current} onValueChange={(next) => void save(next === NONE ? null : next)}>
          <SelectTrigger aria-label={property.name} className="h-8 min-h-8 w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    default:
      // text, url, multi_select(simplified as comma string)
      return (
        <input
          type="text"
          aria-label={property.name}
          className="w-full bg-transparent outline-hidden"
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
