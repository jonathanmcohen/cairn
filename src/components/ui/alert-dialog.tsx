'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Themed replacement for native `window.alert`. There are no current `alert()`
 * sites, but the Biome `noRestrictedGlobals` ban forbids it going forward, so
 * this ships the sanctioned one-button info dialog. Promise-based `useAlert()`
 * resolves `void` when the user acknowledges (OK / Escape / overlay-click),
 * mirroring `ConfirmProvider`. Mount `<AlertProvider>` once at the app root.
 */

export type AlertOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
};

type AlertFn = (options: AlertOptions) => Promise<void>;

const MISSING_PROVIDER: AlertFn = () => {
  throw new Error('useAlert must be used inside <AlertProvider>');
};

const AlertContext = createContext<AlertFn | null>(null);

/**
 * Promise-based info alert. Throws when *invoked* outside `<AlertProvider>`
 * (not at render) so render-only tests stay simple while real misuse fails
 * loudly.
 */
export function useAlert(): AlertFn {
  return useContext(AlertContext) ?? MISSING_PROVIDER;
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<AlertOptions | null>(null);
  const resolverRef = useRef<(() => void) | null>(null);

  const alert = useCallback<AlertFn>((opts) => {
    return new Promise<void>((resolve) => {
      resolverRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  const settle = useCallback(() => {
    setOptions(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.();
  }, []);

  return (
    <AlertContext.Provider value={alert}>
      {children}
      <Dialog
        open={options !== null}
        onOpenChange={(open) => {
          if (!open) settle();
        }}
      >
        {options !== null && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{options.title}</DialogTitle>
              {options.description ? (
                <DialogDescription>{options.description}</DialogDescription>
              ) : null}
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => settle()} autoFocus>
                {options.confirmLabel ?? 'OK'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </AlertContext.Provider>
  );
}
