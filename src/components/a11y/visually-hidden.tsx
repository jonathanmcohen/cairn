import type { ReactNode } from 'react';

/**
 * Visually hidden but exposed to assistive tech (the standard sr-only pattern).
 * Used to provide accessible names/text for elements that have only an icon or
 * other non-textual content. The class string mirrors Tailwind's `sr-only`
 * utility so this works whether or not the project pulls in that exact class.
 */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return (
    <span className="absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]">
      {children}
    </span>
  );
}
