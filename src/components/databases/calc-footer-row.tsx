'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type CalcFn, type CalcResult, computeCalcFooter } from '@/lib/databases/calc-footer';
import type { DatabaseMeta, RowData } from './use-database-data';

const FN_LABELS: Record<CalcFn | 'none', string> = {
  none: '—',
  count: 'Count',
  filled: 'Filled',
  empty: 'Empty',
  sum: 'Sum',
  avg: 'Avg',
  min: 'Min',
  max: 'Max',
};
const ALL_FNS: (CalcFn | 'none')[] = [
  'none',
  'count',
  'filled',
  'empty',
  'sum',
  'avg',
  'min',
  'max',
];

function formatValue(r: CalcResult): string {
  if (r.value === null) return '—';
  const rounded = Math.round(r.value * 100) / 100;
  return String(rounded);
}

/**
 * PATCH the view's calc-footer config, toggling `propertyId` to `fn`.
 * Shared by the table `<tfoot>` row and the list-view footer.
 */
export async function patchCalcFooter(
  databaseId: string,
  viewId: string,
  viewConfig: unknown,
  calcFooter: Record<string, CalcFn>,
  propertyId: string,
  fn: CalcFn | 'none',
): Promise<void> {
  const next = { ...calcFooter };
  if (fn === 'none') delete next[propertyId];
  else next[propertyId] = fn;
  const config = { ...((viewConfig ?? {}) as object), calcFooter: next };
  await fetch(`/api/databases/${databaseId}/views/${viewId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config }),
  });
}

export function CalcFooterRow({
  databaseId,
  viewId,
  viewConfig,
  meta,
  rows,
  calcFooter,
  onChange,
}: {
  databaseId: string;
  viewId: string;
  viewConfig: unknown;
  meta: DatabaseMeta;
  rows: RowData[];
  calcFooter: Record<string, CalcFn>;
  onChange: () => void;
}) {
  const results = computeCalcFooter(rows, meta.properties, calcFooter);

  async function setFn(propertyId: string, fn: CalcFn | 'none') {
    await patchCalcFooter(databaseId, viewId, viewConfig, calcFooter, propertyId, fn);
    onChange();
  }

  return (
    <tfoot>
      <tr className="border-t bg-muted/30 text-xs">
        {meta.properties.map((p) => {
          const current = calcFooter[p.id] ?? 'none';
          const result = results[p.id];
          return (
            <td key={p.id} className="px-3 py-1.5">
              <div className="flex items-center justify-between gap-1">
                <span className="tabular-nums text-foreground">
                  {result ? formatValue(result) : ''}
                </span>
                <Select
                  value={current}
                  onValueChange={(next) => void setFn(p.id, next as CalcFn | 'none')}
                >
                  <SelectTrigger
                    aria-label={`Calc for ${p.name}`}
                    className="h-6 min-h-6 w-auto border-0 px-1 py-0 text-xs text-muted-foreground shadow-none hover:bg-accent"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_FNS.map((fn) => (
                      <SelectItem key={fn} value={fn}>
                        {FN_LABELS[fn]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </td>
          );
        })}
      </tr>
    </tfoot>
  );
}
