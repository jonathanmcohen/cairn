'use client';

import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactNode } from 'react';

export const TooltipProvider = RadixTooltip.Provider;

/**
 * #189 — supplementary hover/focus tooltip for icon-only controls. The wrapped
 * trigger MUST already carry its own `aria-label` (the tooltip is decorative,
 * not the accessible name) so SR users are unaffected if the tooltip never
 * opens. Radix manages keyboard focus + Esc dismissal + delay.
 */
export function IconTooltip({
  label,
  children,
  side = 'bottom',
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md"
        >
          {label}
          <RadixTooltip.Arrow className="fill-popover" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
