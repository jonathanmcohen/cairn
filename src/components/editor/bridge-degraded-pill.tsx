'use client';

import { TriangleAlert } from 'lucide-react';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.10.2 P12 — degraded-collab indicator beside the Live pill. Rendered when
 * CAIRN_COLLAB_INTERNAL_URL is unset (read server-side in the page route —
 * env never reaches the client): REST API writes to page content update the
 * DB but never reach an open editor until reload, so editors should know
 * their collaborators' API writes can go stale. Shown to edit-capable users
 * only; the admin Upgrade page keeps the long-form explanation.
 */
export function BridgeDegradedPill() {
  const t = useT();
  return (
    <span
      role="status"
      data-testid="bridge-degraded-pill"
      title={t('editor.bridgeWarning.title')}
      className="inline-flex items-center gap-1.5 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-warning text-xs"
    >
      <TriangleAlert aria-hidden="true" className="h-3 w-3 shrink-0" />
      {t('editor.bridgeWarning.label')}
    </span>
  );
}
