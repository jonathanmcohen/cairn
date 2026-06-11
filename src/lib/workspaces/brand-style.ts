import type { CSSProperties } from 'react';
import type { WorkspaceBrand } from './brand';
import { BRAND_PRIMARY_FOREGROUND_HSL } from './brand-color';

/**
 * v0.10.0 F1 — inline style for the brand primary-color override.
 *
 * The wrapper div sets the minimum token set the primary Button variant
 * (`bg-primary text-primary-foreground`, ring via `focus-visible:ring-ring`)
 * actually consumes: `--primary`, `--primary-foreground`, `--ring` — the same
 * trio the named-accent blocks in globals.css remap. Inline custom properties
 * win over both the `.dark` block and any `html[data-accent=…]` accent for
 * everything INSIDE the wrapper, so the override holds in light AND dark mode
 * with a single clamp target (the pinned near-white foreground `0 0% 98%`).
 * Content portaled to <body> (dropdown menus, toasts) falls back to the
 * user's theme accent — accepted: the shell + its buttons are the surface F1
 * brands. Returns undefined when no brand color is set → no inline style →
 * today's behavior.
 */
export function brandPrimaryStyle(
  appliedPrimary: WorkspaceBrand['appliedPrimary'],
): CSSProperties | undefined {
  if (!appliedPrimary) return undefined;
  return {
    '--primary': appliedPrimary.hsl,
    '--primary-foreground': BRAND_PRIMARY_FOREGROUND_HSL,
    '--ring': appliedPrimary.hsl,
  } as CSSProperties;
}
