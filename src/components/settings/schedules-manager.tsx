'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { absoluteLocal, relativeFromNow } from '@/lib/datetime/format';
import { useT } from '@/lib/i18n/provider';

/** Mirrors `ScheduleRow` from @/lib/scheduler/manage (ISO-string timestamps). */
export type ScheduleRowView = {
  id: string;
  workspaceId: string | null;
  command: string;
  cronSpec: string;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  enabled: boolean;
};

/**
 * v0.10.3 CFG-3 — admin Schedules console.
 *
 * Client Component. Lists every cron_schedules row with an editable cron
 * expression, an enable/disable toggle, and a "Run now" button. Edits PATCH
 * /api/admin/schedules/:id; run POSTs /api/admin/schedules/:id/run. Toggle +
 * run are optimistic with rollback on failure; the cron-save shows inline
 * status. "Run now" marks the row due immediately — the in-process poller
 * (≤60s) actually executes it, so jobs only fire when the scheduler is
 * enabled (CAIRN_SCHEDULER_ENABLED=1).
 */
export function SchedulesManager({ initial }: { initial: ScheduleRowView[] }) {
  const t = useT();
  const [rows, setRows] = useState<ScheduleRowView[]>(initial);
  // Per-row in-progress cron-expression draft (keyed by id).
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((r) => [r.id, r.cronSpec])),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function patchRow(id: string, next: Partial<ScheduleRowView>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)));
  }

  async function saveCron(row: ScheduleRowView) {
    const cronSpec = (drafts[row.id] ?? row.cronSpec).trim();
    if (cronSpec === row.cronSpec) return;
    setBusyId(row.id);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/schedules/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cronSpec }),
      });
      if (!res.ok) throw new Error(await errText(res));
      const data = (await res.json()) as { schedule: ScheduleRowView };
      patchRow(row.id, data.schedule);
      setDrafts((d) => ({ ...d, [row.id]: data.schedule.cronSpec }));
      setStatus({ kind: 'ok', text: t('schedules.saved') });
    } catch (err) {
      // Roll the draft back to the persisted value.
      setDrafts((d) => ({ ...d, [row.id]: row.cronSpec }));
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleEnabled(row: ScheduleRowView) {
    const nextEnabled = !row.enabled;
    // Optimistic flip.
    patchRow(row.id, { enabled: nextEnabled });
    setBusyId(row.id);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/schedules/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (!res.ok) throw new Error(await errText(res));
      const data = (await res.json()) as { schedule: ScheduleRowView };
      patchRow(row.id, data.schedule);
      setStatus({ kind: 'ok', text: t('schedules.saved') });
    } catch (err) {
      // Rollback the optimistic flip.
      patchRow(row.id, { enabled: row.enabled });
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function runNow(row: ScheduleRowView) {
    setBusyId(row.id);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/schedules/${row.id}/run`, { method: 'POST' });
      if (!res.ok) throw new Error(await errText(res));
      const data = (await res.json()) as { schedule: ScheduleRowView };
      patchRow(row.id, data.schedule);
      setStatus({ kind: 'ok', text: t('schedules.runQueued') });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="schedules-manager">
      <p
        data-testid="schedules-enabled-note"
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm"
      >
        {t('schedules.schedulerNote')}
      </p>
      {status ? (
        <p
          role="status"
          data-testid="schedules-status"
          className={status.kind === 'ok' ? 'text-green-600 text-sm' : 'text-destructive text-sm'}
        >
          {status.text}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p data-testid="schedules-empty" className="text-muted-foreground text-sm">
          {t('schedules.empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card data-testid={`schedule-row-${row.id}`}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm" title={row.command}>
                        {row.command}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {row.workspaceId
                          ? t('schedules.scopeWorkspace')
                          : t('schedules.scopeGlobal')}
                      </p>
                    </div>
                    <StatusBadge status={row.lastStatus} enabled={row.enabled} t={t} />
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex-1 space-y-1" htmlFor={`schedule-cron-${row.id}`}>
                      <span className="text-muted-foreground text-xs">{t('schedules.cron')}</span>
                      <Input
                        id={`schedule-cron-${row.id}`}
                        data-testid={`schedule-cron-${row.id}`}
                        value={drafts[row.id] ?? row.cronSpec}
                        onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                        className="font-mono"
                      />
                    </label>
                    <Button
                      type="button"
                      data-testid={`schedule-save-${row.id}`}
                      onClick={() => saveCron(row)}
                      disabled={
                        busyId === row.id || (drafts[row.id] ?? row.cronSpec) === row.cronSpec
                      }
                    >
                      {t('schedules.save')}
                    </Button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.enabled}
                      data-testid={`schedule-enabled-${row.id}`}
                      onClick={() => toggleEnabled(row)}
                      disabled={busyId === row.id}
                      className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${
                        row.enabled
                          ? 'border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400'
                          : 'border-border bg-muted/40 text-muted-foreground'
                      }`}
                    >
                      {row.enabled ? t('schedules.enabled') : t('schedules.disabled')}
                    </button>
                    <Button
                      type="button"
                      variant="outline"
                      data-testid={`schedule-run-${row.id}`}
                      onClick={() => runNow(row)}
                      disabled={busyId === row.id || !row.enabled}
                    >
                      {t('schedules.runNow')}
                    </Button>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">{t('schedules.nextRun')}</dt>
                    <dd title={absoluteLocal(row.nextRunAt)}>{relativeFromNow(row.nextRunAt)}</dd>
                    <dt className="text-muted-foreground">{t('schedules.lastRun')}</dt>
                    <dd title={row.lastRunAt ? absoluteLocal(row.lastRunAt) : undefined}>
                      {row.lastRunAt ? relativeFromNow(row.lastRunAt) : t('schedules.never')}
                    </dd>
                  </dl>
                  {row.lastStatus === 'failure' && row.lastError ? (
                    <p
                      data-testid={`schedule-error-${row.id}`}
                      className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-destructive text-xs"
                    >
                      {row.lastError}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  enabled,
  t,
}: {
  status: string | null;
  enabled: boolean;
  t: ReturnType<typeof useT>;
}) {
  if (!enabled) {
    return (
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
        {t('schedules.disabled')}
      </span>
    );
  }
  if (status === 'success') {
    return (
      <span className="shrink-0 rounded-full bg-green-600/10 px-2 py-0.5 text-green-700 text-xs dark:text-green-400">
        {t('schedules.statusSuccess')}
      </span>
    );
  }
  if (status === 'failure') {
    return (
      <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive text-xs">
        {t('schedules.statusFailure')}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
      {t('schedules.statusNever')}
    </span>
  );
}

async function errText(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
