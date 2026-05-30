'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useRef } from 'react';
import { useSwipeBack } from '@/lib/mobile/gestures';

/**
 * Client wrapper that binds an edge-swipe-back gesture to the detail-page
 * shell. The hook is a no-op when the user never starts a pointer near the
 * left edge — desktop layouts are unaffected.
 */
export function PageDetailShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  useSwipeBack(rootRef, { onBack: () => router.back() });
  // a9 #18 — the reading column is intentionally centered (`mx-auto max-w-3xl`)
  // with responsive horizontal padding so it reads as a deliberate text column,
  // and the page region fills the viewport height (`min-h-dvh bg-background`) so
  // the area beside/below the column is part of the page surface, not a bare
  // void. `relative` makes this the positioning context for the absolutely-
  // placed TOC rail in page.tsx, so the rail anchors to the centered column
  // (left-1/2 + translate) rather than floating against the viewport edge and
  // leaving an orphan whitespace band.
  return (
    <div className="relative min-h-dvh bg-background">
      <div ref={rootRef} className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
        {children}
      </div>
    </div>
  );
}
