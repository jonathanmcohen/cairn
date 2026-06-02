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
import type { ConditionGroupModel, ConditionRow } from '@/lib/automation/builder';
import { MAX_CONDITION_TREE_DEPTH } from '@/lib/automation/condition-tree';
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

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `c-${Math.random().toString(36).slice(2)}`;
}

function isGroup(n: ConditionRow | ConditionGroupModel): n is ConditionGroupModel {
  return 'logic' in n && Array.isArray((n as ConditionGroupModel).children);
}

type Props = {
  group: ConditionGroupModel;
  onChange: (next: ConditionGroupModel) => void;
  depth: number;
};

export function ConditionGroup({ group, onChange, depth }: Props) {
  const t = useT();

  function setCombinator(logic: 'and' | 'or') {
    onChange({ ...group, logic });
  }
  function addRow() {
    onChange({
      ...group,
      children: [...group.children, { id: newId(), field: '', op: 'equals', value: null }],
    });
  }
  function addGroup() {
    onChange({
      ...group,
      children: [...group.children, { id: newId(), logic: 'and', children: [] }],
    });
  }
  function updateChild(id: string, next: ConditionRow | ConditionGroupModel) {
    onChange({ ...group, children: group.children.map((c) => (c.id === id ? next : c)) });
  }
  function removeChild(id: string) {
    onChange({ ...group, children: group.children.filter((c) => c.id !== id) });
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      {group.children.length > 1 ? (
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={group.logic === 'and' ? 'default' : 'outline'}
            aria-pressed={group.logic === 'and'}
            onClick={() => setCombinator('and')}
          >
            {t('automation.builder.combinator.and')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={group.logic === 'or' ? 'default' : 'outline'}
            aria-pressed={group.logic === 'or'}
            onClick={() => setCombinator('or')}
          >
            {t('automation.builder.combinator.or')}
          </Button>
        </div>
      ) : null}

      {group.children.map((child) =>
        isGroup(child) ? (
          <div key={child.id} className="relative pl-2">
            <ConditionGroup
              group={child}
              depth={depth + 1}
              onChange={(next) => updateChild(child.id, next)}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('automation.builder.removeGroup')}
              className="absolute right-1 top-1"
              onClick={() => removeChild(child.id)}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div key={child.id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
            <Input
              aria-label={t('automation.builder.condition.propertyPlaceholder')}
              placeholder={t('automation.builder.condition.propertyPlaceholder')}
              value={child.field}
              onChange={(e) => updateChild(child.id, { ...child, field: e.target.value })}
            />
            <Select
              value={child.op}
              onValueChange={(v) =>
                updateChild(child.id, { ...child, op: v as AutomationOperator })
              }
            >
              <SelectTrigger
                aria-label={t('automation.builder.condition.operator')}
                className="w-full text-sm"
              >
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
              aria-label={t('automation.builder.setProperty.value')}
              placeholder={t('automation.builder.setProperty.value')}
              value={child.value == null ? '' : String(child.value)}
              onChange={(e) =>
                updateChild(child.id, { ...child, value: parseLiteral(e.target.value) })
              }
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('db.sort.remove')}
              onClick={() => removeChild(child.id)}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        ),
      )}

      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          {t('automation.builder.addCondition')}
        </Button>
        {depth < MAX_CONDITION_TREE_DEPTH ? (
          <Button type="button" size="sm" variant="outline" onClick={addGroup}>
            {t('automation.builder.addGroup')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
