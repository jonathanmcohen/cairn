'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/provider';

// v0.10.0 C3 — "Scheduled backups" section of /settings/admin/backups.
//
// The parent RSC reads the schedule row + run history + the
// CAIRN_SCHEDULER_ENABLED flag server-side and passes plain props; this
// renders the i18n copy and drives the save/delete calls against
// /api/admin/backups/schedule (the command string is built SERVER-SIDE there
// — this form only ships structured fields, never a raw command).
//
// When the scheduler env flag is off, a prominent warning explains that the
// schedule will never fire (the trash-cron lesson: a dormant schedule row
// looks exactly like a healthy one unless the UI says otherwise).

export type ScheduleProps = {
  schedule: {
    cronSpec: string;
    enabled: boolean;
    command: string;
    nextRunAt: string;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    target: 'local' | 's3';
    retentionDays?: number;
    keep?: number;
  } | null;
  schedulerEnabled: boolean;
  runs: {
    id: string;
    startedAt: string;
    status: string;
    trigger: string;
    durationMs: number | null;
    bundleTs: string | null;
    error: string | null;
  }[];
};

const DAILY_CRON = '0 3 * * *';
const WEEKLY_CRON = '0 3 * * 0';

type Preset = 'daily' | 'weekly' | 'custom';

function presetForSpec(spec: string): Preset {
  if (spec === DAILY_CRON) return 'daily';
  if (spec === WEEKLY_CRON) return 'weekly';
  return 'custom';
}

export function ScheduleSection({ schedule, schedulerEnabled, runs }: ScheduleProps) {
  const t = useT();
  const router = useRouter();
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false);
  const [preset, setPreset] = useState<Preset>(presetForSpec(schedule?.cronSpec ?? DAILY_CRON));
  const [customSpec, setCustomSpec] = useState(schedule?.cronSpec ?? DAILY_CRON);
  const [target, setTarget] = useState<'local' | 's3'>(schedule?.target ?? 'local');
  const [retentionDays, setRetentionDays] = useState(
    schedule?.retentionDays !== undefined ? String(schedule.retentionDays) : '',
  );
  const [keep, setKeep] = useState(schedule?.keep !== undefined ? String(schedule.keep) : '');
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  const cronSpec = preset === 'daily' ? DAILY_CRON : preset === 'weekly' ? WEEKLY_CRON : customSpec;

  async function save(): Promise<void> {
    setPhase('saving');
    setError(null);
    try {
      const res = await fetch('/api/admin/backups/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          cronSpec: cronSpec.trim(),
          target,
          retentionDays: retentionDays.trim() === '' ? undefined : Number(retentionDays),
          keep: keep.trim() === '' ? undefined : Number(keep),
        }),
      });
      if (res.ok) {
        setPhase('saved');
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setPhase('failed');
      setError(
        body?.error === 'invalid-cron-spec'
          ? t('settingsAdmin.backups.schedule.invalidCron')
          : (body?.error ?? null),
      );
    } catch {
      setPhase('failed');
      setError(null);
    }
  }

  async function remove(): Promise<void> {
    setPhase('saving');
    setError(null);
    try {
      const res = await fetch('/api/admin/backups/schedule', { method: 'DELETE' });
      if (res.ok) {
        setPhase('idle');
        setEnabled(false);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setPhase('failed');
      setError(body?.error ?? null);
    } catch {
      setPhase('failed');
      setError(null);
    }
  }

  const inputClass = 'rounded-md border bg-background px-3 py-2 text-sm';

  return (
    <section aria-labelledby="backup-schedule" className="space-y-4">
      <h2 id="backup-schedule" className="text-lg font-medium">
        {t('settingsAdmin.backups.schedule.title')}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t('settingsAdmin.backups.schedule.description')}
      </p>

      {!schedulerEnabled ? (
        <div
          role="alert"
          data-testid="scheduler-disabled-warning"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm font-medium"
        >
          {t('settingsAdmin.backups.schedule.schedulerDisabled')}
        </div>
      ) : null}

      <div className="space-y-4 rounded-md border p-4">
        <label className="flex items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="schedule-enabled-toggle"
            className="size-4"
          />
          {t('settingsAdmin.backups.schedule.enable')}
        </label>

        <div className="flex flex-wrap items-end gap-4">
          <label className="block space-y-2 text-sm">
            <span className="font-medium">{t('settingsAdmin.backups.schedule.cadence')}</span>
            <Select value={preset} onValueChange={(next) => setPreset(next as Preset)}>
              <SelectTrigger data-testid="schedule-preset-select" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">
                  {t('settingsAdmin.backups.schedule.preset.daily')}
                </SelectItem>
                <SelectItem value="weekly">
                  {t('settingsAdmin.backups.schedule.preset.weekly')}
                </SelectItem>
                <SelectItem value="custom">
                  {t('settingsAdmin.backups.schedule.preset.custom')}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          {preset === 'custom' ? (
            <label className="block space-y-2 text-sm">
              <span className="font-medium">{t('settingsAdmin.backups.schedule.customCron')}</span>
              <input
                type="text"
                value={customSpec}
                onChange={(e) => setCustomSpec(e.target.value)}
                spellCheck={false}
                data-testid="schedule-custom-cron"
                className={`${inputClass} font-mono`}
              />
            </label>
          ) : null}
          <label className="block space-y-2 text-sm">
            <span className="font-medium">{t('settingsAdmin.backups.schedule.target')}</span>
            <Select value={target} onValueChange={(next) => setTarget(next as 'local' | 's3')}>
              <SelectTrigger data-testid="schedule-target-select" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">
                  {t('settingsAdmin.backups.schedule.targetLocal')}
                </SelectItem>
                <SelectItem value="s3">{t('settingsAdmin.backups.schedule.targetS3')}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-2 text-sm">
            <span className="font-medium">{t('settingsAdmin.backups.schedule.retentionDays')}</span>
            <input
              type="number"
              min={1}
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              data-testid="schedule-retention-days"
              className={`${inputClass} w-28`}
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span className="font-medium">{t('settingsAdmin.backups.schedule.keepN')}</span>
            <input
              type="number"
              min={1}
              value={keep}
              onChange={(e) => setKeep(e.target.value)}
              data-testid="schedule-keep-n"
              className={`${inputClass} w-28`}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => void save()}
            disabled={phase === 'saving'}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            data-testid="schedule-save"
          >
            {phase === 'saving'
              ? t('settingsAdmin.backups.schedule.saving')
              : t('settingsAdmin.backups.schedule.save')}
          </button>
          {schedule ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={phase === 'saving'}
              className="rounded-md border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              data-testid="schedule-delete"
            >
              {t('settingsAdmin.backups.schedule.delete')}
            </button>
          ) : null}
          {phase === 'saved' ? (
            <p role="status" className="text-sm text-success" data-testid="schedule-saved">
              {t('settingsAdmin.backups.schedule.saved')}
            </p>
          ) : null}
          {phase === 'failed' ? (
            <p role="alert" className="text-sm text-destructive" data-testid="schedule-error">
              {t('settingsAdmin.backups.schedule.saveFailed', { error: error ?? '' })}
            </p>
          ) : null}
        </div>

        {schedule ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-medium">{t('settingsAdmin.backups.schedule.lastRun')}</dt>
            <dd data-testid="schedule-last-run">
              {schedule.lastRunAt
                ? `${new Date(schedule.lastRunAt).toLocaleString()} — ${schedule.lastStatus ?? ''}${
                    schedule.lastError ? ` (${schedule.lastError})` : ''
                  }`
                : t('settingsAdmin.backups.schedule.never')}
            </dd>
            <dt className="font-medium">{t('settingsAdmin.backups.schedule.nextRun')}</dt>
            <dd data-testid="schedule-next-run">
              {schedule.enabled
                ? new Date(schedule.nextRunAt).toLocaleString()
                : t('settingsAdmin.backups.schedule.disabled')}
            </dd>
          </dl>
        ) : null}
      </div>

      <h3 className="text-base font-medium">{t('settingsAdmin.backups.schedule.history')}</h3>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="schedule-history-empty">
          {t('settingsAdmin.backups.schedule.historyEmpty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('settingsAdmin.backups.schedule.col.started')}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('settingsAdmin.backups.schedule.col.status')}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('settingsAdmin.backups.schedule.col.trigger')}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('settingsAdmin.backups.schedule.col.duration')}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('settingsAdmin.backups.col.bundle')}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('settingsAdmin.backups.schedule.col.error')}
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b last:border-b-0" data-testid="backup-run-row">
                  <td className="px-4 py-2">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    {run.status === 'done' ? (
                      <span className="rounded bg-success/15 px-2 py-1 text-xs text-success">
                        {t('settingsAdmin.backups.schedule.status.done')}
                      </span>
                    ) : run.status === 'failed' ? (
                      <span className="rounded bg-destructive/15 px-2 py-1 text-xs text-destructive">
                        {t('settingsAdmin.backups.schedule.status.failed')}
                      </span>
                    ) : (
                      <span className="rounded bg-muted px-2 py-1 text-xs">
                        {t('settingsAdmin.backups.schedule.status.running')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {run.trigger === 'scheduled'
                      ? t('settingsAdmin.backups.schedule.trigger.scheduled')
                      : t('settingsAdmin.backups.schedule.trigger.manual')}
                  </td>
                  <td className="px-4 py-2">
                    {run.durationMs === null ? '—' : formatDuration(run.durationMs)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{run.bundleTs ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-destructive">{run.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${rest} s`;
}
