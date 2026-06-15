'use client';

import { CircleCheck, CircleSlash, TriangleAlert } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { SystemHealthDetail, SystemHealthPill } from '@/lib/health/system-health';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * v0.10.3 CFG-4 — System health pill list.
 *
 * Renders one row per {@link SystemHealthPill} from `getSystemHealth`: a label,
 * a status badge, an optional muted detail line, and an optional "Fix" link to
 * the relevant settings page (internal `Link`) or operations docs (external
 * `<a target=_blank>`).
 *
 * Status is conveyed by BOTH a semantic color (ok=success-green,
 * warn=warning-amber, off=muted) AND a text word + icon — never color-only (a11y).
 */

const STATUS_STYLE: Record<
  SystemHealthPill['status'],
  { className: string; Icon: typeof CircleCheck }
> = {
  ok: {
    className: 'border-success/50 bg-success/10 text-success',
    Icon: CircleCheck,
  },
  warn: {
    className: 'border-warning/50 bg-warning/10 text-warning',
    Icon: TriangleAlert,
  },
  off: {
    className: 'border-border bg-muted text-muted-foreground',
    Icon: CircleSlash,
  },
};

/** i18n key for each pill's human label. */
const LABEL_KEY: Record<SystemHealthPill['id'], string> = {
  email: 'systemHealth.label.email',
  storage: 'systemHealth.label.storage',
  scheduler: 'systemHealth.label.scheduler',
  collab: 'systemHealth.label.collab',
  e2e: 'systemHealth.label.e2e',
};

function detailText(detail: SystemHealthDetail, t: ReturnType<typeof useT>): string {
  switch (detail.kind) {
    case 'source':
      return t(`systemHealth.source.${detail.source}`);
    case 'consumers':
      return detail.consumers.length > 0
        ? t('systemHealth.detail.consumers', { consumers: detail.consumers.join(', ') })
        : t('systemHealth.detail.noConsumers');
    case 'scheduleCount':
      return t('systemHealth.detail.scheduleCount', { count: detail.enabledCount });
  }
}

export function SystemHealthPanel({ pills }: { pills: SystemHealthPill[] }) {
  const t = useT();
  return (
    <ul data-testid="system-health-panel" className="space-y-2">
      {pills.map((p) => {
        const { className, Icon } = STATUS_STYLE[p.status];
        const detail = p.detail ? detailText(p.detail, t) : null;
        return (
          <li
            key={p.id}
            data-testid={`system-health-pill-${p.id}`}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
          >
            <span className="min-w-40 font-medium text-sm">{t(LABEL_KEY[p.id])}</span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
                className,
              )}
            >
              <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
              {t(p.statusKey)}
            </span>
            {detail ? <span className="text-muted-foreground text-xs">{detail}</span> : null}
            {p.fixHref ? (
              <span className="ml-auto">
                {p.fixExternal ? (
                  <a
                    data-testid={`system-health-fix-${p.id}`}
                    href={String(p.fixHref)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm underline underline-offset-2 hover:text-foreground"
                  >
                    {t('systemHealth.fix')}
                  </a>
                ) : (
                  <Link
                    data-testid={`system-health-fix-${p.id}`}
                    href={p.fixHref as Route}
                    className="text-sm underline underline-offset-2 hover:text-foreground"
                  >
                    {t('systemHealth.fix')}
                  </Link>
                )}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
