'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { matchShortcut } from '@/lib/shortcuts/registry';
import { ensureAppShortcuts, setShortcutHandlers } from './app-shortcuts';

type SheetState = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const SheetCtx = createContext<SheetState | null>(null);

/**
 * v0.10.0 Plan E E1 — true when a keydown originated inside a control that
 * consumes typed characters: inputs, textareas, native/custom select-like
 * controls (combobox), or any contenteditable surface (the TipTap editor is
 * contenteditable). Bare-key shortcuts must never fire there — typing `?` in
 * a doc or a search field has to insert the character.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el =
    target instanceof Element
      ? target
      : typeof document !== 'undefined'
        ? document.activeElement
        : null;
  if (!el) return false;
  return (
    el.closest(
      'input, textarea, select, [role="combobox"], [role="textbox"], [contenteditable]:not([contenteditable="false"])',
    ) !== null
  );
}

/** Bare keys (no modifier) the dispatcher is allowed to match. Everything
 *  else keeps the historical no-modifier early-return — don't open the
 *  floodgates for plain typing. */
const BARE_KEYS = new Set(['?']);

/**
 * The global keydown handler behind <ShortcutDispatcher>. Exported (rather
 * than closed over inside the effect) so unit tests can drive it with real
 * KeyboardEvents without mounting the component tree.
 */
export function handleShortcutKeydown(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) {
    // E1 — bare `?` opens the shortcuts sheet. Keyed off e.key (the LAYOUT
    // value), never the physical Shift+/ code, so non-US layouts that emit
    // `?` without Shift work too; and only when focus is outside editable
    // controls.
    if (!BARE_KEYS.has(e.key) || e.altKey || isEditableTarget(e.target)) return;
    // Look the binding up under its registered form (`?` with no modifiers):
    // on US layouts the keystroke arrives as Shift+/ (shiftKey=true), which
    // would otherwise normalize to 'shift+?' and miss the '?' entry.
    const bare = matchShortcut(
      { key: e.key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
      'global',
    );
    if (!bare) return;
    e.preventDefault();
    bare.run();
    return;
  }
  const entry = matchShortcut(
    {
      key: e.key,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
    },
    'global',
  );
  if (!entry) return;
  e.preventDefault();
  entry.run();
}

export function useShortcutSheet(): SheetState {
  const ctx = useContext(SheetCtx);
  if (!ctx) {
    throw new Error('useShortcutSheet must be used within ShortcutDispatcher');
  }
  return ctx;
}

export function ShortcutDispatcher({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const newPage = useCallback(() => {
    void (async () => {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.ok) {
        const created = (await res.json()) as { id: string };
        router.push(`/pages/${created.id}` as Route);
        router.refresh();
      }
    })();
  }, [router]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const openFavorites = useCallback(() => {
    router.push('/favorites' as Route);
  }, [router]);

  const switchWorkspace = useCallback(() => {
    router.push('/workspaces' as Route);
  }, [router]);

  const openSheet = useCallback(() => {
    setOpen(true);
  }, []);

  const openExport = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cairn:export:open'));
    }
  }, []);

  useEffect(() => {
    ensureAppShortcuts();
    setShortcutHandlers({
      newPage,
      toggleTheme,
      switchWorkspace,
      openFavorites,
      openSheet,
      export: openExport,
    });
  }, [newPage, toggleTheme, switchWorkspace, openFavorites, openSheet, openExport]);

  useEffect(() => {
    window.addEventListener('keydown', handleShortcutKeydown);
    return () => window.removeEventListener('keydown', handleShortcutKeydown);
  }, []);

  const value = useMemo<SheetState>(() => ({ open, setOpen }), [open]);

  return <SheetCtx.Provider value={value}>{children}</SheetCtx.Provider>;
}
