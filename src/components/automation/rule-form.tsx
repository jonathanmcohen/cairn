'use client';

import { useId, useState } from 'react';
import type { RuleListRow } from '@/components/automation/rule-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type * as schema from '@/db/schema';

const TRIGGERS = [
  'page.created',
  'page.updated',
  'page.deleted',
  'row.created',
  'row.updated',
  'row.deleted',
  'comment.created',
] as const;

type TriggerEvent = (typeof TRIGGERS)[number];

const ACTIONS: schema.AutomationActionType[] = [
  'notify',
  'send_webhook',
  'set_property',
  'create_page',
];

const OPERATORS: schema.AutomationOperator[] = [
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

// Action-specific config templates surfaced as placeholder JSON.
// The runner registry under src/lib/automation/actions/ is the source of truth.
const ACTION_CONFIG_TEMPLATES: Record<schema.AutomationActionType, string> = {
  notify: JSON.stringify({ userId: '<user-id>', message: 'Optional message' }, null, 2),
  send_webhook: JSON.stringify({ url: 'https://example.com/hook', payload: {} }, null, 2),
  set_property: JSON.stringify({ propertyId: '<property-id>', value: '<new-value>' }, null, 2),
  create_page: JSON.stringify({ title: 'New page', parentId: '<parent-page-id>' }, null, 2),
};

type Props =
  | { mode: 'create'; onClose: (saved: RuleListRow | null) => void }
  | { mode: 'edit'; rule: RuleListRow; onClose: (saved: RuleListRow | null) => void };

function parseLiteral(s: string): unknown {
  if (s === '') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  const n = Number(s);
  if (!Number.isNaN(n) && s.trim() !== '') return n;
  return s;
}

function isTriggerEvent(v: string): v is TriggerEvent {
  return (TRIGGERS as readonly string[]).includes(v);
}

function isActionType(v: string): v is schema.AutomationActionType {
  return (ACTIONS as readonly string[]).includes(v);
}

function isOperator(v: string): v is schema.AutomationOperator {
  return (OPERATORS as readonly string[]).includes(v);
}

export function RuleForm(props: Props) {
  const nameId = useId();
  const triggerId = useId();
  const propertyId = useId();
  const operatorId = useId();
  const valueId = useId();
  const actionId = useId();
  const configId = useId();

  const initial = props.mode === 'edit' ? props.rule : null;
  const initialCondition = (initial?.condition ?? {}) as
    | Record<string, never>
    | { property: string; operator: schema.AutomationOperator; value: unknown };
  const hasInitialCondition = 'property' in initialCondition;

  const [name, setName] = useState(initial?.name ?? '');
  const [triggerEvent, setTriggerEvent] = useState<TriggerEvent>(() => {
    const t = initial?.triggerEvent;
    return t && isTriggerEvent(t) ? t : 'row.created';
  });
  const [property, setProperty] = useState(hasInitialCondition ? initialCondition.property : '');
  const [operator, setOperator] = useState<schema.AutomationOperator>(
    hasInitialCondition ? initialCondition.operator : 'equals',
  );
  const [value, setValue] = useState(
    hasInitialCondition && initialCondition.value != null ? String(initialCondition.value) : '',
  );
  const [actionType, setActionType] = useState<schema.AutomationActionType>(
    () => initial?.actionType ?? 'notify',
  );
  const [actionConfig, setActionConfig] = useState(
    initial ? JSON.stringify(initial.actionConfig, null, 2) : ACTION_CONFIG_TEMPLATES.notify,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onActionChange(next: schema.AutomationActionType) {
    setActionType(next);
    // Only swap in the template when the user hasn't customised it for this rule.
    if (!initial) {
      setActionConfig(ACTION_CONFIG_TEMPLATES[next]);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      let parsedConfig: Record<string, unknown>;
      try {
        parsedConfig = JSON.parse(actionConfig || '{}') as Record<string, unknown>;
      } catch {
        throw new Error('Action config must be valid JSON');
      }
      if (
        typeof parsedConfig !== 'object' ||
        parsedConfig === null ||
        Array.isArray(parsedConfig)
      ) {
        throw new Error('Action config must be a JSON object');
      }
      const condition =
        property.length === 0 ? {} : { property, operator, value: parseLiteral(value) };
      const body = {
        name,
        triggerEvent,
        condition,
        actionType,
        actionConfig: parsedConfig,
      };
      const url =
        props.mode === 'create'
          ? '/api/automation/rules'
          : `/api/automation/rules/${props.rule.id}`;
      const method = props.mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errBody?.error ?? `Request failed (${res.status})`);
      }
      const saved = (await res.json()) as {
        id: string;
        name: string;
        triggerEvent: string;
        condition: schema.AutomationCondition;
        actionType: schema.AutomationActionType;
        actionConfig: Record<string, unknown>;
        enabled: boolean;
        createdAt: string;
      };
      const row: RuleListRow = {
        id: saved.id,
        name: saved.name,
        triggerEvent: saved.triggerEvent,
        condition: saved.condition,
        actionType: saved.actionType,
        actionConfig: saved.actionConfig,
        enabled: saved.enabled,
        createdAt:
          typeof saved.createdAt === 'string'
            ? saved.createdAt
            : new Date(saved.createdAt).toISOString(),
        lastStatus: props.mode === 'edit' ? props.rule.lastStatus : null,
        lastRunAt: props.mode === 'edit' ? props.rule.lastRunAt : null,
      };
      props.onClose(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  }

  const title = props.mode === 'create' ? 'New rule' : `Edit ${initial?.name ?? 'rule'}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Notify on new high-priority row"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={triggerId}>Trigger event</Label>
            <select
              id={triggerId}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={triggerEvent}
              onChange={(e) => {
                if (isTriggerEvent(e.target.value)) setTriggerEvent(e.target.value);
              }}
            >
              {TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Condition (optional)</legend>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor={propertyId} className="text-xs">
                  Property
                </Label>
                <Input
                  id={propertyId}
                  placeholder="row.cells.status"
                  value={property}
                  onChange={(e) => setProperty(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={operatorId} className="text-xs">
                  Operator
                </Label>
                <select
                  id={operatorId}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={operator}
                  onChange={(e) => {
                    if (isOperator(e.target.value)) setOperator(e.target.value);
                  }}
                >
                  {OPERATORS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={valueId} className="text-xs">
                  Value
                </Label>
                <Input
                  id={valueId}
                  placeholder="value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              Leave property blank to match every event. Numeric/boolean values are auto-coerced.
            </p>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={actionId}>Action</Label>
            <select
              id={actionId}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={actionType}
              onChange={(e) => {
                if (isActionType(e.target.value)) onActionChange(e.target.value);
              }}
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={configId}>Action config (JSON)</Label>
            <textarea
              id={configId}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              rows={8}
              value={actionConfig}
              onChange={(e) => setActionConfig(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Shape depends on the action — see <code>src/lib/automation/actions/</code>.
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={saving || name.trim().length === 0}>
              {saving ? 'Saving…' : 'Save rule'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => props.onClose(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
