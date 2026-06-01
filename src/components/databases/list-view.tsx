'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state/empty-state';
import { PullToRefresh } from '@/components/mobile/pull-to-refresh';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type CalcFn, type CalcResult, computeCalcFooter } from '@/lib/databases/calc-footer';
import { groupRows } from '@/lib/databases/group';
import { useT } from '@/lib/i18n/provider';
import { patchCalcFooter } from './calc-footer-row';
import { buildRowForest, flattenVisible } from './row-tree';
import type { ViewProps } from './table-view';

const LIST_FN_LABELS: Record<CalcFn | 'none', string> = {
  none: '—',
  count: 'Count',
  filled: 'Filled',
  empty: 'Empty',
  sum: 'Sum',
  avg: 'Avg',
  min: 'Min',
  max: 'Max',
};
const LIST_ALL_FNS: (CalcFn | 'none')[] = [
  'none',
  'count',
  'filled',
  'empty',
  'sum',
  'avg',
  'min',
  'max',
];

function listFormatValue(r: CalcResult): string {
  if (r.value === null) return '—';
  return String(Math.round(r.value * 100) / 100);
}

export function ListView({ databaseId, meta, rows, view, onChange }: ViewProps) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const config = (view.config ?? {}) as { groupBy?: string | null };
  const groupByProp = meta.properties.find((p) => p.id === config.groupBy);
  const titleProp = meta.properties.find((p) => p.type === 'text') ?? meta.properties[0];

  function rowTitle(cells: Record<string, unknown>): string {
    if (!titleProp) return t('db.row.untitled');
    const v = cells[titleProp.id];
    return typeof v === 'string' && v.length > 0 ? v : t('db.row.untitled');
  }

  async function addRow(opts?: { groupValue?: string; parentRowId?: string }) {
    setAdding(true);
    const body: { cells?: Record<string, unknown>; parentRowId?: string } = {};
    if (groupByProp && opts?.groupValue) body.cells = { [groupByProp.id]: opts.groupValue };
    if (opts?.parentRowId) body.parentRowId = opts.parentRowId;
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setAdding(false);
    onChange();
  }

  function Row({
    cells,
    depth = 0,
    hasChildren = false,
    isCollapsed = false,
    rowId,
    onToggle,
    onAddSub,
  }: {
    cells: Record<string, unknown>;
    depth?: number;
    hasChildren?: boolean;
    isCollapsed?: boolean;
    rowId?: string;
    onToggle?: () => void;
    onAddSub?: () => void;
  }) {
    return (
      <div className="flex items-center gap-2 rounded border bg-background px-3 py-2 text-sm">
        <span
          style={{ paddingInlineStart: `${depth * 1.25}rem` }}
          className="inline-flex items-center gap-1"
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={isCollapsed ? t('db.row.expand') : t('db.row.collapse')}
              aria-expanded={!isCollapsed}
              onClick={onToggle}
              className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
            >
              {isCollapsed ? (
                <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="font-medium">{rowTitle(cells)}</span>
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {meta.properties
            .filter((p) => p.id !== titleProp?.id)
            .map((p) => {
              const v = cells[p.id];
              const text =
                v === null || v === undefined
                  ? ''
                  : typeof v === 'object'
                    ? JSON.stringify(v)
                    : String(v);
              return text ? (
                <span key={p.id} className="truncate" title={text}>
                  {text}
                </span>
              ) : null;
            })}
          {rowId && onAddSub ? (
            <button
              type="button"
              aria-label={t('db.row.addSubItem')}
              disabled={adding}
              onClick={onAddSub}
              className="shrink-0 rounded px-1 hover:bg-accent"
            >
              +
            </button>
          ) : null}
        </span>
      </div>
    );
  }

  const calcFooter =
    ((view.config ?? {}) as { calcFooter?: Record<string, CalcFn> }).calcFooter ?? {};

  function ListCalcFooter() {
    const results = computeCalcFooter(rows, meta.properties, calcFooter);
    async function setFn(propertyId: string, fn: CalcFn | 'none') {
      await patchCalcFooter(databaseId, view.id, view.config, calcFooter, propertyId, fn);
      onChange();
    }
    return (
      <div className="flex flex-wrap items-center gap-3 border-t px-1 pt-2 text-xs">
        {meta.properties.map((p) => {
          const current = calcFooter[p.id] ?? 'none';
          const result = results[p.id];
          return (
            <span key={p.id} className="inline-flex items-center gap-1 text-muted-foreground">
              <span className="font-medium">{p.name}:</span>
              {result ? (
                <span className="tabular-nums text-foreground">{listFormatValue(result)}</span>
              ) : null}
              <Select
                value={current}
                onValueChange={(next) => void setFn(p.id, next as CalcFn | 'none')}
              >
                <SelectTrigger
                  aria-label={t('db.calc.label', { name: p.name })}
                  className="h-6 min-h-6 w-auto border-0 px-1 py-0 text-xs text-muted-foreground shadow-none hover:bg-accent"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIST_ALL_FNS.map((fn) => (
                    <SelectItem key={fn} value={fn}>
                      {LIST_FN_LABELS[fn]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
          );
        })}
      </div>
    );
  }

  if (groupByProp && groupByProp.type === 'select') {
    const options =
      (groupByProp.config as { options?: { id: string; name: string }[] })?.options ?? [];
    const groups = groupRows(rows, groupByProp.id, options);
    return (
      <PullToRefresh onRefresh={async () => onChange()}>
        <div className="flex flex-col gap-4 p-3">
          {groups.map((g) => (
            <div key={g.id || 'uncategorized'} className="flex flex-col gap-1">
              <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.name} · {g.rows.length}
              </div>
              <div className="flex flex-col gap-1">
                {g.rows.map((r) => (
                  <Row key={r.row.id} cells={r.cells} />
                ))}
              </div>
              <button
                type="button"
                disabled={adding}
                onClick={() => void addRow({ groupValue: g.id || undefined })}
                className="self-start rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                + Add
              </button>
            </div>
          ))}
          <ListCalcFooter />
        </div>
      </PullToRefresh>
    );
  }

  const rowById = new Map(rows.map((r) => [r.row.id, r]));
  const forest = buildRowForest(
    rows.map((r) => ({ id: r.row.id, parentRowId: r.row.parentRowId })),
  );
  const visible = flattenVisible(forest, collapsed);

  return (
    <PullToRefresh onRefresh={async () => onChange()}>
      <div className="flex flex-col gap-1 p-3">
        {visible.map((node) => {
          const item = rowById.get(node.row.id);
          if (!item) return null;
          return (
            <Row
              key={node.row.id}
              cells={item.cells}
              depth={node.depth}
              hasChildren={node.hasChildren}
              isCollapsed={collapsed.has(node.row.id)}
              rowId={node.row.id}
              onToggle={() => toggle(node.row.id)}
              onAddSub={() => void addRow({ parentRowId: node.row.id })}
            />
          );
        })}
        {rows.length === 0 && (
          <div className="px-1 py-4">
            <EmptyState headline={t('db.list.empty')} guidance={t('db.gallery.empty.guidance')} />
          </div>
        )}
        <button
          type="button"
          disabled={adding}
          onClick={() => void addRow()}
          className="self-start rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          + Add
        </button>
        <ListCalcFooter />
      </div>
    </PullToRefresh>
  );
}
