'use client';

import { useId, useMemo, useState } from 'react';
import { ActionCardHost } from '@/components/automation/builder/action-card-host';
import { ConditionGroup } from '@/components/automation/builder/condition-group';
import { FlowConnector } from '@/components/automation/builder/flow-connector';
import { TemplatesGallery } from '@/components/automation/builder/templates-gallery';
import { TestPanel } from '@/components/automation/builder/test-panel';
import type { RuleListRow } from '@/components/automation/rule-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type * as schema from '@/db/schema';
import {
  type BuilderModel,
  compileBuilder,
  decompileRule,
  emptyBuilder,
} from '@/lib/automation/builder';
import { TRIGGER_EVENTS, type TriggerEvent } from '@/lib/automation/events';
import { useT } from '@/lib/i18n/provider';

type Props =
  | { mode: 'create'; onClose: (saved: RuleListRow | null) => void }
  | { mode: 'edit'; rule: RuleListRow; onClose: (saved: RuleListRow | null) => void };

function newActionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `a-${Math.random().toString(36).slice(2)}`;
}

export function RuleCanvas(props: Props) {
  const t = useT();
  const nameId = useId();
  const triggerId = useId();

  const initial = props.mode === 'edit' ? props.rule : null;
  const [name, setName] = useState(initial?.name ?? '');
  const [model, setModel] = useState<BuilderModel>(() =>
    props.mode === 'edit'
      ? decompileRule({
          triggerEvent: props.rule.triggerEvent,
          condition: props.rule.condition,
          actionType: props.rule.actionType,
          actionConfig: props.rule.actionConfig,
          builder: props.rule.builder ?? null,
        })
      : emptyBuilder('row.created'),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The dry-run "Test rule" panel doesn't need a rule name — compile against a
  // placeholder name so the panel is usable before the user has named the rule.
  // Null body disables the Test button until the action config is complete.
  const testCompiled = useMemo(() => compileBuilder(name.trim() || 'test', model), [name, model]);

  function setTrigger(next: string) {
    if ((TRIGGER_EVENTS as readonly string[]).includes(next)) {
      setModel((m) => ({ ...m, triggerEvent: next as TriggerEvent }));
    }
  }

  function setActionAt(
    index: number,
    next: { type: schema.AutomationActionType; config: Record<string, unknown> },
  ) {
    setModel((m) => ({
      ...m,
      actions: m.actions.map((a, i) => (i === index ? { ...a, ...next } : a)),
    }));
  }

  function addAction() {
    setModel((m) => ({
      ...m,
      actions: [...m.actions, { id: newActionId(), type: 'notify', config: {} }],
    }));
  }

  async function save() {
    const result = compileBuilder(name, model);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url =
        props.mode === 'create'
          ? '/api/automation/rules'
          : `/api/automation/rules/${props.rule.id}`;
      const method = props.mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...result.body, builder: model }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(errBody?.error ?? `Request failed (${res.status})`);
        return;
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
        builder: schema.AutomationRule['builder'];
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
        builder: saved.builder ?? model,
      };
      props.onClose(row);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold leading-none tracking-tight">
          {props.mode === 'create' ? t('automation.builder.name') : (initial?.name ?? '')}
        </h2>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>{t('automation.builder.name')}</Label>
            <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5 rounded-md border p-3">
            <Label htmlFor={triggerId}>{t('automation.builder.triggerCard.title')}</Label>
            <Select value={model.triggerEvent} onValueChange={setTrigger}>
              <SelectTrigger id={triggerId} className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_EVENTS.map((ev) => (
                  <SelectItem key={ev} value={ev}>
                    {ev}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <FlowConnector />

          <ConditionGroup
            group={model.conditions}
            onChange={(conditions) => setModel((m) => ({ ...m, conditions }))}
          />

          {model.actions.map((action, i) => (
            <div key={action.id}>
              <FlowConnector variant="branch" />
              <ActionCardHost
                type={action.type}
                config={action.config}
                onChange={(next) => setActionAt(i, next)}
              />
            </div>
          ))}

          <Button type="button" size="sm" variant="outline" onClick={addAction}>
            {t('automation.builder.addAction')}
          </Button>

          <TestPanel body={testCompiled.ok ? testCompiled.body : null} />

          {props.mode === 'create' ? <TemplatesGallery onPick={(m) => setModel(m)} /> : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex gap-2">
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {t('automation.builder.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => props.onClose(null)}
            >
              {t('automation.builder.cancel')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
