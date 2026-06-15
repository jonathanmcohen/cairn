/**
 * v0.10.3 CFG-4 — System health summary.
 *
 * Aggregates the instance-level "disabled / degraded / configured" indicators
 * that are otherwise scattered across the app (the SMTP banner, the bridge-
 * degraded editor pill, the E2E-disabled notice, the scheduler-off warning,
 * the object-storage consumer opt-ins) into ONE typed array of status pills the
 * admin System health page renders, each with an optional "Fix" deep-link.
 *
 * Read-only and db-injected: no migrations, no mutations, no env writes. The
 * summary is client-safe — it NEVER carries a secret (passwords, secret keys),
 * only booleans, counts, sources, and the masked display views.
 *
 * Sources aggregated:
 *   - email      → getEmailConfigForDisplay   (src/lib/email/config.ts)
 *   - storage    → getStorageConfigForDisplay (src/lib/files/storage-config.ts)
 *   - scheduler  → CAIRN_SCHEDULER_ENABLED env + enabled cron-row count
 *   - collab     → isCollabBridgeConfigured   (src/lib/collab/publish-client.ts)
 *   - e2e        → NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION build flag
 *
 * Search-index health is intentionally OMITTED: the only existing helper
 * (countPendingEmbeddings) is workspace-scoped and walks every page hashing
 * content in Node — too expensive for an instance-level dashboard, and there is
 * no cheap instance-wide backlog query. Surfacing it here would mean inventing
 * one, which this read-only aggregator deliberately does not do.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Route } from 'next';
import type * as schema from '@/db/schema';
import { isCollabBridgeConfigured } from '@/lib/collab/publish-client';
import { OPERATIONS_DOCS_URL } from '@/lib/docs-links';
import { getEmailConfigForDisplay } from '@/lib/email/config';
import { env } from '@/lib/env';
import { getStorageConfigForDisplay } from '@/lib/files/storage-config';
import { listSchedules } from '@/lib/scheduler/manage';

type Db = PostgresJsDatabase<typeof schema>;

/** Stable identifier for each pill — also the data-testid suffix. */
export type SystemHealthPillId = 'email' | 'storage' | 'scheduler' | 'collab' | 'e2e';

/**
 * Semantic status of a pill:
 *   - `ok`   — configured / enabled / live (green-ish).
 *   - `warn` — degraded / paused but expected to be on (amber).
 *   - `off`  — intentionally disabled / not configured (muted).
 * Always paired with a textual status key (never color-only — a11y).
 */
export type SystemHealthStatus = 'ok' | 'warn' | 'off';

/**
 * Structured, secret-free context for a pill's muted detail line. The lib emits
 * the raw values (source label, opted-in consumers, enabled cron count) and the
 * panel turns them into translated copy with `{}` params — keeping copy out of
 * the lib so it stays unit-testable.
 */
export type SystemHealthDetail =
  | { kind: 'source'; source: 'db' | 'env' }
  | { kind: 'consumers'; consumers: string[] }
  | { kind: 'scheduleCount'; enabledCount: number };

export type SystemHealthPill = {
  id: SystemHealthPillId;
  status: SystemHealthStatus;
  /**
   * i18n key for the status word (e.g. `systemHealth.status.configured`). The
   * panel translates it; the lib stays copy-free so it's testable.
   */
  statusKey: string;
  /**
   * Optional extra context already safe to show (no secrets) — e.g. the config
   * source (`db`/`env`), the opted-in storage consumers, the enabled cron
   * count. Rendered as a muted detail line by the panel.
   */
  detail?: SystemHealthDetail;
  /** Settings-route or external docs href the "Fix" link points at, when any. */
  fixHref?: Route | string;
  /** True when {@link fixHref} is an external (https) docs link, not a Route. */
  fixExternal?: boolean;
};

export type SystemHealthSummary = {
  pills: SystemHealthPill[];
};

/**
 * Build the instance System health summary. Pure (db-injected), read-only,
 * secret-free. Reads scheduler/collab/e2e flags from `process.env`/`env()` and
 * the email/storage/scheduler state from their respective display helpers.
 */
export async function getSystemHealth(db: Db): Promise<SystemHealthSummary> {
  const [email, storage, schedules] = await Promise.all([
    getEmailConfigForDisplay(db),
    getStorageConfigForDisplay(db),
    listSchedules(db),
  ]);

  const pills: SystemHealthPill[] = [];

  // 1. Email (SMTP).
  pills.push({
    id: 'email',
    status: email.configured ? 'ok' : 'off',
    statusKey: email.configured
      ? 'systemHealth.status.configured'
      : 'systemHealth.status.notConfigured',
    detail:
      email.configured && email.source !== 'none'
        ? { kind: 'source', source: email.source }
        : undefined,
    fixHref: '/settings/admin/email' as Route,
  });

  // 2. Object storage (S3) + opted-in consumers.
  const consumers = [
    storage.uploadsEnabled ? 'uploads' : null,
    storage.backupsEnabled ? 'backups' : null,
    storage.siemEnabled ? 'siem' : null,
  ].filter((c): c is string => c !== null);
  pills.push({
    id: 'storage',
    status: storage.configured ? 'ok' : 'off',
    statusKey: storage.configured ? 'systemHealth.status.configured' : 'systemHealth.status.off',
    detail: storage.configured ? { kind: 'consumers', consumers } : undefined,
    fixHref: '/settings/admin/object-storage' as Route,
  });

  // 3. Scheduler — env flag + enabled-row count. Read process.env directly (not
  // the cached env()) so a test/runtime toggle is observed, mirroring the
  // backups page's own check.
  const schedulerEnabled = process.env.CAIRN_SCHEDULER_ENABLED === '1';
  const enabledCount = schedules.filter((s) => s.enabled).length;
  pills.push({
    id: 'scheduler',
    status: schedulerEnabled ? 'ok' : 'warn',
    statusKey: schedulerEnabled ? 'systemHealth.status.enabled' : 'systemHealth.status.paused',
    detail: { kind: 'scheduleCount', enabledCount },
    fixHref: '/settings/admin/schedules' as Route,
  });

  // 4. Collab (Yjs) bridge — live when configured, else degraded. No dedicated
  // settings page; the Fix link points at the operations docs.
  const collabLive = isCollabBridgeConfigured();
  pills.push({
    id: 'collab',
    status: collabLive ? 'ok' : 'warn',
    statusKey: collabLive ? 'systemHealth.status.live' : 'systemHealth.status.degraded',
    fixHref: collabLive ? undefined : OPERATIONS_DOCS_URL,
    fixExternal: collabLive ? undefined : true,
  });

  // 5. E2E encryption — build flag. Fix link only when ON, mirroring the
  // sidebar gating (the encryption page/nav entry is hidden when the flag is
  // off, so a Fix link would dead-end).
  const e2eEnabled = env().NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION;
  pills.push({
    id: 'e2e',
    status: e2eEnabled ? 'ok' : 'off',
    statusKey: e2eEnabled ? 'systemHealth.status.on' : 'systemHealth.status.off',
    fixHref: e2eEnabled ? ('/settings/admin/encryption' as Route) : undefined,
  });

  return { pills };
}
