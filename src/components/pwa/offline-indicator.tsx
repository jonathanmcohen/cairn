'use client';

import { useOfflineGate } from '@/components/pwa/offline-context';

/**
 * A live-region badge that announces the offline state. Renders nothing while
 * online; while offline it explains the bounded-offline contract (open pages
 * keep editing; the edits sync on reconnect).
 */
export function OfflineIndicator() {
  const { online } = useOfflineGate();
  if (online) return null;
  return (
    <output
      aria-live="polite"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-700 text-xs dark:text-amber-400"
    >
      Offline — changes to open pages sync when you reconnect
    </output>
  );
}
