'use client';

import { WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import type { CollabStatus } from './use-collab-doc';

const OFFLINE_STATUSES: ReadonlySet<CollabStatus> = new Set<CollabStatus>([
  'disconnected',
  'error',
]);

/**
 * v0.9.8 G3 (audit item I) — dismissible "Collab offline — reconnecting…"
 * banner, distinct from the small toolbar status pill (editor.tsx). Surfaced
 * on `disconnected`/`error`. Dismiss is sticky until the next offline
 * transition: once the status returns to a non-offline state the dismissal
 * resets, so a *new* drop re-shows the banner even if a prior one was hidden.
 * The whole strip is an aria-live="polite" status region for screen readers.
 */
export function CollabOfflineBanner({ status }: { status: CollabStatus }) {
  const t = useT();
  const offline = OFFLINE_STATUSES.has(status);
  const [dismissed, setDismissed] = useState(false);

  // Reset the dismissal whenever we leave the offline state, so the banner can
  // re-appear on a subsequent disconnect.
  useEffect(() => {
    if (!offline) setDismissed(false);
  }, [offline]);

  return (
    <div role="status" aria-live="polite" aria-label={t('collab.offline.region')}>
      {offline && !dismissed && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-900 text-sm dark:text-amber-200">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t('collab.offline.message')}</p>
            <p className="text-amber-800/80 text-xs dark:text-amber-200/70">
              {t('collab.offline.detail')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={t('collab.offline.dismiss')}
            className="-mr-1 shrink-0 rounded p-1 hover:bg-amber-500/20"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
