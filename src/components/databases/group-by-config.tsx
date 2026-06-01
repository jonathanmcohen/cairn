'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';
import type { ViewProps } from './table-view';

// Sentinel value for the "None" option — Radix Select needs a non-empty string.
const NONE = '__none__';

export function GroupByConfig({ databaseId, meta, view, onChange }: ViewProps) {
  const t = useT();
  const config = (view.config ?? {}) as { groupBy?: string | null };
  // Only `select` properties can be grouped — groupRows() / KanbanView bucket
  // against a select property's options.
  const selectProps = meta.properties.filter((p) => p.type === 'select');
  const current = config.groupBy ?? NONE;

  async function save(next: string | null) {
    await fetch(`/api/databases/${databaseId}/views/${view.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: { ...(view.config ?? {}), groupBy: next } }),
    });
    onChange();
  }

  if (selectProps.length === 0) {
    return (
      <span
        className="px-2 py-1 text-xs text-muted-foreground"
        title={t('database.groupBy.needSelect')}
      >
        {t('database.groupBy.label')}
      </span>
    );
  }

  return (
    <Select value={current} onValueChange={(next) => void save(next === NONE ? null : next)}>
      <SelectTrigger
        aria-label={t('database.groupBy.label')}
        className="h-auto min-h-11 w-auto gap-1.5 border-0 px-2 py-1 text-xs text-muted-foreground shadow-none hover:bg-accent"
      >
        <SelectValue placeholder={t('database.groupBy.label')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('database.groupBy.none')}</SelectItem>
        {selectProps.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
