'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AutomationActionType, AutomationCondition } from '@/db/schema';
import { useT } from '@/lib/i18n/provider';

type Body = {
  triggerEvent: string;
  condition: AutomationCondition;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
};

type DryRun = {
  status: 'would_run' | 'condition_unmet' | 'invalid_config';
  matched: boolean;
  actionSummary: string;
  error?: string;
};

export function TestPanel({ body }: { body: Body | null }) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DryRun | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!body) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/automation/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? `Test failed (${res.status})`);
        return;
      }
      const json = (await res.json()) as { result: DryRun; payload: unknown };
      setResult(json.result);
      setPayload(json.payload);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Button
        type="button"
        variant="outline"
        disabled={running || body === null}
        onClick={() => void run()}
      >
        {t('automation.builder.test')}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {result ? (
        <div className="text-sm">
          {result.status === 'would_run' ? (
            <p className="text-green-600 dark:text-green-400">
              {t('automation.builder.testResult.wouldRun', { summary: result.actionSummary })}
            </p>
          ) : null}
          {result.status === 'condition_unmet' ? (
            <p className="text-muted-foreground">
              {t('automation.builder.testResult.conditionUnmet')}
            </p>
          ) : null}
          {result.status === 'invalid_config' ? (
            <p className="text-destructive">
              {t('automation.builder.testResult.invalidConfig', { error: result.error ?? '' })}
            </p>
          ) : null}
          {payload ? (
            <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(payload, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
