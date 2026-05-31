'use client';

import { useT } from '@/lib/i18n/provider';

/**
 * #134 — compact locked indicator shown in the editor control strip in place
 * of the hidden edit affordances. The leading 🔒 is part of the i18n string so
 * RTL locales keep it on the correct side. The time is the viewer's locale
 * short date+time; an absent unlock time renders the indefinite label.
 */
export function LockBadge({ lockedUntilIso }: { lockedUntilIso: string | null }) {
  const t = useT();
  const label = lockedUntilIso
    ? t('editor.lockedBadge.until', {
        time: new Date(lockedUntilIso).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      })
    : t('editor.lockedBadge.indefinite');
  return (
    <span
      role="status"
      className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-800 text-xs dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      {label}
    </span>
  );
}
