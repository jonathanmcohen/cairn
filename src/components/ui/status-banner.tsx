'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

export type StatusBannerVariant = 'error' | 'success' | 'warning';

const VARIANT_CLASS: Record<StatusBannerVariant, string> = {
  // The `/10` tint surface reads in both themes because the text token is AA on
  // --card (Task 2). Border + text share the semantic token; no raw palette.
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
};

const ROLE: Record<StatusBannerVariant, 'alert' | 'status'> = {
  error: 'alert',
  success: 'status',
  warning: 'status',
};

const LABEL_KEY: Record<StatusBannerVariant, string> = {
  error: 'statusBanner.error',
  success: 'statusBanner.success',
  warning: 'statusBanner.warning',
};

/**
 * #169 — themed status banner. Replaces raw `bg-red-50 text-red-800` /
 * `text-green-600` markup that was illegible or off-theme in dark mode. The
 * semantic tokens (Task 2) carry AA-contrast light + dark values, so a single
 * component is correct in both themes. A visually-hidden label gives screen
 * readers the severity (the color alone is not an accessible cue — WCAG 1.4.1).
 */
export function StatusBanner({
  variant,
  className,
  children,
}: {
  variant: StatusBannerVariant;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div
      role={ROLE[variant]}
      className={cn('rounded border p-3 text-sm', VARIANT_CLASS[variant], className)}
    >
      <span className="sr-only">{t(LABEL_KEY[variant])}: </span>
      {children}
    </div>
  );
}
