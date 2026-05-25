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
        <Link href={ctaHref as Route} className="mt-1">
          <Button type="button">{ctaLabel}</Button>
        </Link>
      ) : null}
      {showButton && ctaLabel ? (
        <Button type="button" onClick={onCta} className="mt-1">
          {ctaLabel}
        </Button>
      ) : null}
    </div>
  );
}
