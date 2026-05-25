'use client';

import { type ReactNode, useEffect } from 'react';
import {
  ACCENT_PRESETS,
  FONT_FAMILY_STACK,
  PAGE_WIDTH_PX,
  type ThemePrefs,
} from '@/lib/themes/presets';

export type ThemeProviderProps = {
  initialPrefs: ThemePrefs;
  children: ReactNode;
};

const NAMED_ACCENT_IDS = new Set<string>(ACCENT_PRESETS.map((p) => p.id));

function applyPrefs(prefs: ThemePrefs): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (NAMED_ACCENT_IDS.has(prefs.accent)) {
    root.setAttribute('data-accent', prefs.accent);
    root.style.removeProperty('--cairn-accent');
  } else {
    root.setAttribute('data-accent', 'custom');
    root.style.setProperty('--cairn-accent', prefs.accent);
  }
  root.style.setProperty('--cairn-font-family', FONT_FAMILY_STACK[prefs.fontFamily]);
  root.style.setProperty('--cairn-page-width-max', PAGE_WIDTH_PX[prefs.pageWidth]);
}

/**
 * Mount once at the `(app)` root + on `/p/<id>` public pages. Applies the
 * user's theme via attributes + CSS custom properties on the document root.
 *   - `data-accent="<id>"` selects the per-accent override block in
 *     globals.css. Custom hex accents land under `data-accent="custom"`
 *     and rely on `--cairn-accent` directly.
 *   - `--cairn-font-family` is consumed by the typography utilities.
 *   - `--cairn-page-width-max` is consumed by the page container.
 *
 * Writes happen synchronously during render (in addition to useEffect) so
 * tests that read attributes immediately after render see them. The provider
 * is mounted exactly once per session so the duplicate write is harmless.
 */
export function ThemeProvider({ initialPrefs, children }: ThemeProviderProps): ReactNode {
  applyPrefs(initialPrefs);
  useEffect(() => {
    applyPrefs(initialPrefs);
  }, [initialPrefs]);
  return children;
}
