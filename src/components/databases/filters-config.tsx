'use client';

import { useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';
import type { ViewProps } from './table-view';

type Condition = { propertyId: string; op: string; value: unknown };

// Ops mirror what `predicateFor` in src/lib/databases/filter.ts actually handles
// per property type. Keep these in sync with that switch.
const OPS_BY_TYPE: Record<string, string[]> = {
  text: [
    'contains',
    'not_contains',
    'eq',
    'neq',
    'starts_with',
    'ends_with',
    'is_empty',
    'is_not_empty',
  ],
  url: [
    'contains',
    'not_contains',
    'eq',
    'neq',
    'starts_with',
    'ends_with',
    'is_empty',
    'is_not_empty',
  ],
  select: ['is', 'is_not', 'is_any_of', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty'],
  checkbox: ['is_true', 'is_false'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty'],
  multi_select: ['contains', 'not_contains', 'is_empty'],
  // v0.9.9 F2 #243 — email/phone share the text op list; created/last_edited
  // time filter like dates against the row column. person/file/*_by are
  // intentionally omitted (non-filterable in this version).
  email: [
    'contains',
    'not_contains',
    'eq',
    'neq',
    'starts_with',
    'ends_with',
    'is_empty',
    'is_not_empty',
  ],
  phone: [
    'contains',
    'not_contains',
    'eq',
    'neq',
    'starts_with',
    'ends_with',
    'is_empty',
    'is_not_empty',
  ],
  created_time: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty'],
  last_edited_time: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty'],
};
// Ops that take no value input.
const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty', 'is_true', 'is_false']);

// Property types the engine can filter on. Computed/relation columns are excluded
// because `predicateFor` returns null for them.
function filterableProps(meta: ViewProps['meta']) {
  return meta.properties.filter((p) => p.type in OPS_BY_TYPE);
}

export function FiltersConfig({ databaseId, meta, view, onChange }: ViewProps) {
  const t = useT();
  const config = (view.config ?? {}) as { filters?: Condition[] };
  const [open, setOpen] = useState(false);
  const props = filterableProps(meta);
  // #244 — hold the filter list locally so add/remove/edit render synchronously
  // on the first interaction, BEFORE the persist PATCH + onChange refetch round
  // trip. Re-seed from view.config whenever the view's persisted config changes
  // (e.g. after the background refetch reconciles, or on view switch).
  const [localFilters, setLocalFilters] = useState<Condition[]>(
    Array.isArray(config.filters) ? config.filters : [],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — re-seed the optimistic mirror only when the persisted view.config identity changes, not on every config.filters read.
  useEffect(() => {
    const cfg = (view.config ?? {}) as { filters?: Condition[] };
    setLocalFilters(Array.isArray(cfg.filters) ? cfg.filters : []);
  }, [view.config]);

  const filters = localFilters;

  function save(next: Condition[]) {
    // Optimistic: reflect locally first, then persist + background refetch.
    setLocalFilters(next);
    void (async () => {
      await fetch(`/api/databases/${databaseId}/views/${view.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: { ...(view.config ?? {}), filters: next } }),
      });
      onChange();
    })();
  }

  function opsFor(propertyId: string): string[] {
    const p = props.find((x) => x.id === propertyId);
    return p ? (OPS_BY_TYPE[p.type] ?? []) : [];
  }

  function addFilter() {
    const first = props[0];
    if (!first) return;
    const op = (OPS_BY_TYPE[first.type] ?? [])[0] ?? 'contains';
    save([...filters, { propertyId: first.id, op, value: NO_VALUE_OPS.has(op) ? null : '' }]);
  }
  function removeFilter(i: number) {
    save(filters.filter((_, idx) => idx !== i));
  }
  function setFilter(i: number, patch: Partial<Condition>) {
    save(
      filters.map((c, idx) => {
        if (idx !== i) return c;
        const merged = { ...c, ...patch };
        // When the property changes, reset the op to the first valid op for the new type.
        if (patch.propertyId && patch.propertyId !== c.propertyId) {
          const op = opsFor(patch.propertyId)[0] ?? 'contains';
          return { propertyId: patch.propertyId, op, value: NO_VALUE_OPS.has(op) ? null : '' };
        }
        // When the op changes to a no-value op, drop the value.
        if (patch.op && NO_VALUE_OPS.has(patch.op)) merged.value = null;
        return merged;
      }),
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
      >
        {t('database.filter.button')}
        {filters.length > 0 ? ` · ${filters.length}` : ''}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-80 rounded-md border bg-background p-2 shadow-md">
          {filters.length === 0 && (
            <div className="px-1 py-1 text-xs text-muted-foreground">
              {t('database.filter.none')}
            </div>
          )}
          {filters.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: filter rows are positional with no stable id
            <div key={`${c.propertyId}-${i}`} className="mb-1 flex items-center gap-1 text-xs">
              <Select
                value={c.propertyId}
                onValueChange={(next) => setFilter(i, { propertyId: next })}
              >
                <SelectTrigger
                  aria-label={t('database.filter.property')}
                  className="h-7 min-h-7 flex-1 px-1 py-0.5 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {props.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={c.op} onValueChange={(next) => setFilter(i, { op: next })}>
                <SelectTrigger
                  aria-label={t('database.filter.operator')}
                  className="h-7 min-h-7 w-28 px-1 py-0.5 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opsFor(c.propertyId).map((op) => (
                    <SelectItem key={op} value={op}>
                      {t(`database.filter.op.${op}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!NO_VALUE_OPS.has(c.op) ? (
                <input
                  aria-label={t('database.filter.value')}
                  value={typeof c.value === 'string' ? c.value : String(c.value ?? '')}
                  onChange={(e) => setFilter(i, { value: e.target.value })}
                  className="h-7 min-h-7 w-24 rounded border bg-background px-1 py-0.5 text-xs"
                />
              ) : null}
              <button
                type="button"
                onClick={() => removeFilter(i)}
                className="rounded px-1 py-0.5 hover:bg-accent"
                aria-label={t('common.remove')}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={props.length === 0}
            onClick={addFilter}
            className="mt-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            {t('database.filter.add')}
          </button>
        </div>
      )}
    </div>
  );
}
