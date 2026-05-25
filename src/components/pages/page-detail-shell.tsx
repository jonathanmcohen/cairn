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
  return (
    <div ref={rootRef} className="mx-auto w-full max-w-3xl px-1 sm:px-0">
      {children}
    </div>
  );
}
