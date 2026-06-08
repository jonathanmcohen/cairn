'use client';

import { ImageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { parseIcon } from '@/lib/pages/icon-format';

/**
 * Client-safe inline page-icon renderer.
 *
 * Routes the stored `pages.icon` string through `parseIcon` so the
 * `emoji::`/`file::` shortcode prefix NEVER leaks into the DOM as literal text
 * (the Trash-list regression — it printed `emoji::📄`). Use this in any CLIENT
 * component that shows a page icon.
 *
 * File-backed icons render a neutral placeholder here, NOT the actual image:
 * resolving a `file::<uuid>` to a signed `/api/files/...` URL requires
 * `AUTH_SECRET` and must stay server-side (see `PageIconRender` for the RSC
 * path). This matches the sidebar tree + see-also panel convention.
 */
export function InlineIcon({
  value,
  fallback = '📄',
  fileFallback,
  className,
}: {
  /** Raw stored icon string (e.g. `"emoji::🚀"`, `"file::<uuid>"`, bare emoji, or null). */
  value: string | null;
  /** Rendered when `value` is null/empty. Defaults to the document emoji. */
  fallback?: ReactNode;
  /** Rendered for `file::` icons. Defaults to a neutral image glyph. */
  fileFallback?: ReactNode;
  /** Applied to the default file placeholder glyph only. */
  className?: string;
}): ReactNode {
  const parsed = parseIcon(value);
  if (!parsed) return fallback;
  if (parsed.kind === 'emoji') return parsed.value;
  return (
    fileFallback ?? (
      <ImageIcon aria-hidden="true" className={className ?? 'h-4 w-4 text-muted-foreground'} />
    )
  );
}
