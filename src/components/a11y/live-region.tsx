'use client';

import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';

type Politeness = 'polite' | 'assertive';
type Announce = (message: string, politeness?: Politeness) => void;

const LiveRegionContext = createContext<Announce | null>(null);

/**
 * Provides two `aria-live` regions (polite + assertive) that descendants can
 * push announcements into via {@link useAnnounce}. Save-status and other UI
 * surfaces route through here so screen-reader users hear state transitions
 * even when the visible change is in a non-focused region.
 *
 * Toasts already have their own `aria-live` region (sonner) — leave them be;
 * this provider exists for everything else (save-status, etc.).
 */
export function LiveRegionProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const seq = useRef(0);

  const announce = useCallback<Announce>((message, politeness = 'polite') => {
    // Append a zero-width sentinel that changes each call so identical
    // consecutive messages still trigger an announcement.
    seq.current += 1;
    const text = `${message}${'​'.repeat(seq.current % 2)}`;
    if (politeness === 'assertive') setAssertive(text);
    else setPolite(text);
  }, []);

  // sr-only class string — mirrors VisuallyHidden so we don't depend on a
  // potentially-missing Tailwind utility.
  const srOnly =
    'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]';

  return (
    <LiveRegionContext.Provider value={announce}>
      {children}
      {/* Two regions: aria-live politeness can't change after mount. */}
      <div aria-live="polite" aria-atomic="true" className={srOnly} role="status">
        {polite}
      </div>
      <div aria-live="assertive" aria-atomic="true" className={srOnly} role="alert">
        {assertive}
      </div>
    </LiveRegionContext.Provider>
  );
}

/**
 * Hook to push messages into the nearest LiveRegionProvider's aria-live
 * regions. `politeness` defaults to `'polite'`; use `'assertive'` for errors.
 */
export function useAnnounce(): Announce {
  const ctx = useContext(LiveRegionContext);
  if (!ctx) throw new Error('useAnnounce must be used within LiveRegionProvider');
  return ctx;
}
