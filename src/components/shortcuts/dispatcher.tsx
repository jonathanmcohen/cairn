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
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<SheetState>(() => ({ open, setOpen }), [open]);

  return <SheetCtx.Provider value={value}>{children}</SheetCtx.Provider>;
}
