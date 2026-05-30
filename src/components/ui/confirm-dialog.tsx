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
 * Themed replacement for native `window.confirm`. Native popups ignore the dark
 * theme and the app's button styles; this renders an in-app radix dialog and
 * exposes a promise-based `useConfirm()` so the imperative call sites convert
 * cleanly:
 *
 *   if (!window.confirm('Delete?')) return;          // before
 *   if (!(await confirm({ title: 'Delete?', ... }))) return;   // after
 *
 * `<ConfirmProvider>` mounts once at the app root (inside the i18n provider, so
 * callers can pass already-translated strings). A single dialog instance is
 * reused for every confirmation; the resolver ref bridges the promise to the
 * dialog's open/close lifecycle. Escape / overlay-click / Cancel all resolve
 * `false`; the action button resolves `true`.
 */

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' renders the destructive button variant for irreversible actions. */
  variant?: 'default' | 'danger';
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const MISSING_PROVIDER: ConfirmFn = () => {
  throw new Error('useConfirm must be used inside <ConfirmProvider>');
};

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Promise-based confirmation. Returns a function that throws when *invoked*
 * outside `<ConfirmProvider>` (not at render time) — so merely rendering a
 * component that holds the hook never crashes (keeps render-only tests simple),
 * while an actual confirm without a provider fails loudly instead of silently
 * proceeding with a destructive action.
 */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? MISSING_PROVIDER;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setOptions(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={options !== null}
        onOpenChange={(open) => {
          // Escape / overlay-click / the built-in X close → treat as cancel.
          if (!open) settle(false);
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
              <Button type="button" variant="outline" onClick={() => settle(false)}>
                {options.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                type="button"
                variant={options.variant === 'danger' ? 'destructive' : 'default'}
                onClick={() => settle(true)}
                autoFocus
              >
                {options.confirmLabel ?? 'Confirm'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}
