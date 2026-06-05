import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * v0.9.11 #16 — shadcn skeleton primitive. A non-interactive pulsing block for
 * >300ms loads. `animate-pulse` is disabled under prefers-reduced-motion via
 * `motion-reduce:animate-none` (and the global reduced-motion media block also
 * clamps it). Size/shape come from the passed className (e.g. `h-4 w-32`).
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  );
}

export { Skeleton };
