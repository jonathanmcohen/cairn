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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Themed replacement for native `window.prompt`. Exposes a promise-based
 * `usePrompt()` so imperative call sites convert cleanly:
 *
 *   const name = window.prompt('Name your workspace');     // before
 *   const name = await prompt({ title: 'Name your workspace' });   // after
 *
 * Resolves the entered string on submit, or `null` on cancel / Escape / empty
 * dismissal (matching `window.prompt`'s null-on-cancel contract, so existing
 * `if (!name) return` guards keep working). `type: 'password'` masks input for
 * passphrase prompts. Mounts once at the app root via `<InputDialogProvider>`.
 */

export type PromptOptions = {
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: 'text' | 'password';
};

type PromptFn = (options: PromptOptions) => Promise<string | null>;

const MISSING_PROVIDER: PromptFn = () => {
  throw new Error('usePrompt must be used inside <InputDialogProvider>');
};

const PromptContext = createContext<PromptFn | null>(null);

/**
 * Promise-based text prompt. Returns a function that throws when *invoked*
 * outside `<InputDialogProvider>` (not at render) so render-only tests are
 * unaffected while real misuse fails loudly.
 */
export function usePrompt(): PromptFn {
  return useContext(PromptContext) ?? MISSING_PROVIDER;
}

export function InputDialogProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<PromptOptions | null>(null);
  const [value, setValue] = useState('');
  const resolverRef = useRef<((value: string | null) => void) | null>(null);

  const prompt = useCallback<PromptFn>((opts) => {
    setValue(opts.defaultValue ?? '');
    setOptions(opts);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((result: string | null) => {
    setOptions(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(result);
  }, []);

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      <Dialog
        open={options !== null}
        onOpenChange={(open) => {
          if (!open) settle(null);
        }}
      >
        {options !== null && (
          <DialogContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                settle(value);
              }}
            >
              <DialogHeader>
                <DialogTitle>{options.title}</DialogTitle>
                {options.description ? (
                  <DialogDescription>{options.description}</DialogDescription>
                ) : null}
              </DialogHeader>
              <div className="grid gap-2 py-4">
                {options.label ? <Label htmlFor="input-dialog-field">{options.label}</Label> : null}
                <Input
                  id="input-dialog-field"
                  type={options.type ?? 'text'}
                  value={value}
                  placeholder={options.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                  // biome-ignore lint/a11y/noAutofocus: focus the field when the prompt opens
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => settle(null)}>
                  {options.cancelLabel ?? 'Cancel'}
                </Button>
                <Button type="submit">{options.confirmLabel ?? 'OK'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </PromptContext.Provider>
  );
}
