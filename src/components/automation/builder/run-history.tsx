'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

type RunRow = {
  id: string;
  status: string;
  error: string | null;
  triggerPayload: Record<string, unknown>;
  createdAt: string;
};

function statusClass(status: string): string {
  if (status === 'success') return 'text-green-600 dark:text-green-400';
  if (status === 'failed') return 'text-destructive';
  return 'text-muted-foreground';
}

export function RunHistory({ ruleId }: { ruleId: string }) {
  const t = useT();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/automation/rules/${ruleId}/runs`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: { runs: RunRow[] }) => {
        if (!cancelled) setRuns(json.runs);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed');
      });
    return () => {
      cancelled = true;
    };
  }, [ruleId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (runs === null) return <p className="text-sm text-muted-foreground">…</p>;
  if (runs.length === 0)
    return <p className="text-sm text-muted-foreground">{t('automation.builder.runs.empty')}</p>;

  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">{t('automation.builder.runs.status')}</th>
            <th className="px-3 py-2 font-medium">{t('automation.builder.runs.payload')}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b align-top last:border-0">
              <td className="px-3 py-2">
                <span className={`font-medium ${statusClass(run.status)}`}>{run.status}</span>
                <div className="text-xs text-muted-foreground">
                  {new Date(run.createdAt).toLocaleString()}
                </div>
                {run.error ? <div className="text-xs text-destructive">{run.error}</div> : null}
              </td>
              <td className="px-3 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded((id) => (id === run.id ? null : run.id))}
                >
                  {t('automation.builder.runs.payload')}
                </Button>
                {expanded === run.id ? (
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(run.triggerPayload, null, 2)}
                  </pre>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
