'use client';

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import {
  type ActionKind,
  isActionAllowedOffline,
  type OfflineState,
} from '@/components/pwa/offline-gate';

const OfflineContext = createContext<OfflineState>({ online: true });

/**
 * Tracks `navigator.onLine` and the browser's `online`/`offline` events. SSR has
 * no `navigator`, so the initial state is optimistically `online: true` and is
 * hydrated from `navigator.onLine` in an effect — avoiding a hydration mismatch.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return <OfflineContext.Provider value={{ online }}>{children}</OfflineContext.Provider>;
}

export function useOfflineGate(): OfflineState {
  return useContext(OfflineContext);
}

/**
 * Returns whether the given action is currently allowed, applying the pure
 * bounded-offline predicate to the live online state.
 */
export function useActionAllowed(kind: ActionKind): boolean {
  const state = useOfflineGate();
  return isActionAllowedOffline(kind, state);
}
