import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export type EmptyStateProps = {
  headline: string;
  guidance: string;
  /** Optional primary action label — paired with either `ctaHref` (renders a Link) or `onCta` (renders a Button). */
  ctaLabel?: string;
  ctaHref?: Route | string;
  onCta?: () => void;
  /** Optional icon element rendered above the headline. */
  icon?: ReactNode;
};

/**
 * Centered empty-state card. Used directly for one-off cases and wrapped by
 * named variants (see ./variants.tsx) for the eight standard surfaces.
 *
 * If both `ctaHref` and `onCta` are passed, the link wins (href takes priority).
 */
export function EmptyState({
  headline,
  guidance,
  ctaLabel,
  ctaHref,
  onCta,
  icon,
}: EmptyStateProps) {
  const showLink = Boolean(ctaLabel && ctaHref);
  const showButton = Boolean(ctaLabel && !ctaHref && onCta);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border bg-muted/30 p-8 text-center">
      {icon ? <div className="text-2xl text-muted-foreground">{icon}</div> : null}
      <h2 className="text-lg font-semibold">{headline}</h2>
      <p className="text-sm text-muted-foreground">{guidance}</p>
      {showLink && ctaLabel ? (
        // inline-flex + min-h-11 so both the <a> and the inner <button> meet the
        // 44×44 touch-target floor (WCAG 2.5.5 / mobile a11y gate).
        <Link href={ctaHref as Route} className="mt-1 inline-flex min-h-11">
          <Button type="button" className="min-h-11">
            {ctaLabel}
          </Button>
        </Link>
      ) : null}
      {showButton && ctaLabel ? (
        <Button type="button" onClick={onCta} className="mt-1 min-h-11">
          {ctaLabel}
        </Button>
      ) : null}
    </div>
  );
}
