'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AutomationOperator } from '@/db/schema';
import type { ConditionGroup as ConditionGroupModel } from '@/lib/automation/builder';
import { useT } from '@/lib/i18n/provider';

const OPERATORS: AutomationOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'gt',
  'lt',
  'between',
  'is_empty',
  'is_not_empty',
  'is_true',
  'is_false',
];

/** Coerce a free-text value into the literal the dispatcher condition compares against. */
function parseLiteral(s: string): unknown {
  if (s === '') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  const n = Number(s);
  if (!Number.isNaN(n) && s.trim() !== '') return n;
  return s;
}

function newRowId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `c-${Math.random().toString(36).slice(2)}`;
}

type Props = {
  group: ConditionGroupModel;
  onChange: (next: ConditionGroupModel) => void;
};

export function ConditionGroup({ group, onChange }: Props) {
  const t = useT();
  const rows = group.rows;

  function setCombinator(combinator: 'and' | 'or') {
    onChange({ ...group, combinator });
  }

  function addRow() {
    onChange({
      ...group,
      rows: [...rows, { id: newRowId(), property: '', operator: 'equals', value: null }],
    });
  }

  function updateRow(id: string, patch: Partial<ConditionGroupModel['rows'][number]>) {
    onChange({
      ...group,
      rows: rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }

  function removeRow(id: string) {
    onChange({ ...group, rows: rows.filter((r) => r.id !== id) });
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      {rows.length > 1 ? (
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={group.combinator === 'and' ? 'default' : 'outline'}
            aria-pressed={group.combinator === 'and'}
            onClick={() => setCombinator('and')}
          >
            {t('automation.builder.combinator.and')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={group.combinator === 'or' ? 'default' : 'outline'}
            aria-pressed={group.combinator === 'or'}
            onClick={() => setCombinator('or')}
          >
            {t('automation.builder.combinator.or')}
          </Button>
        </div>
      ) : null}

      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            placeholder={t('automation.builder.condition.propertyPlaceholder')}
            value={row.property}
            onChange={(e) => updateRow(row.id, { property: e.target.value })}
          />
          <Select
            value={row.operator}
            onValueChange={(v) => updateRow(row.id, { operator: v as AutomationOperator })}
          >
            <SelectTrigger className="w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder={t('automation.builder.setProperty.value')}
            value={row.value == null ? '' : String(row.value)}
            onChange={(e) => updateRow(row.id, { value: parseLiteral(e.target.value) })}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t('db.sort.remove')}
            onClick={() => removeRow(row.id)}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button type="button" size="sm" variant="outline" onClick={addRow}>
        {t('automation.builder.addCondition')}
      </Button>

      {rows.length > 1 ? (
        <p className="text-muted-foreground text-xs">
          {t('automation.builder.condition.firstOnly')}
        </p>
      ) : null}
    </div>
  );
}
