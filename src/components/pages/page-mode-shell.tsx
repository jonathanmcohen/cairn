'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * Per-device localStorage key holding `{ focus: boolean; reader: boolean }`.
 *
 * v0.9.0 G6 P33: focus + reader mode persist client-side only (no DB column),
 * so toggling on one device does not bleed to a colleague's session on a
 * shared machine. The shell reads this on mount + writes on every toggle.
 */
export const PAGE_MODE_STORAGE_KEY = 'cairn:page-mode';

export type PageMode = {
  /** Hides the workspace sidebar + top chrome + comments rail. Editor stays editable. */
  focus: boolean;
  /** Forces the TipTap editor into `editable: false` + applies prose styling. */
  reader: boolean;
};

type ModeCtx = PageMode & {
  setFocus: (v: boolean) => void;
  setReader: (v: boolean) => void;
};

const DEFAULTS: PageMode = { focus: false, reader: false };
const Ctx = createContext<ModeCtx | null>(null);

/**
 * Hook for descendants of `<PageModeShell>` to read the live focus + reader
 * flags. Throws if used outside the shell so misuse is caught at dev-time.
 */
export function usePageMode(): ModeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePageMode must be used inside <PageModeShell>');
  return ctx;
}

/**
 * Best-effort try/catch read of the persisted prefs. localStorage can throw in
 * private-mode Safari + a few sandboxed iframes; we fall back to defaults
 * silently rather than crash the page-detail route.
 */
function readPrefs(): PageMode {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(PAGE_MODE_STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PageMode>;
    return {
      focus: typeof parsed.focus === 'boolean' ? parsed.focus : false,
      reader: typeof parsed.reader === 'boolean' ? parsed.reader : false,
    };
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(next: PageMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PAGE_MODE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / SecurityError — toggle still works in-memory
  }
}

type Props = {
  toggles: ReactNode;
  children: ReactNode;
};

/**
 * Client wrapper around the page-detail body. Owns the focus + reader toggle
 * state, persists it to localStorage, and exposes it both as a React context
 * (children call `usePageMode()`) and as a `cairn-focus-mode` class on the
 * document root so the workspace layout's sidebar / topbar / comments rail can
 * collapse via CSS without re-rendering server components.
 *
 * v0.9.0 G6 P33: replaces the previous unwrapped `<PageDetailShell>` body. No
 * server pref read; the shell mounts with defaults and hydrates from
 * localStorage on the first effect tick (a brief flicker is acceptable — the
 * default off→off case is a no-op, and on→off / off→on only affects users who
 * previously toggled).
 */
export function PageModeShell({ toggles, children }: Props) {
  const [mode, setMode] = useState<PageMode>(DEFAULTS);

  // Hydrate from localStorage on mount. Effect-scoped so SSR + the initial
  // client render agree (no hydration mismatch); the brief flash on
  // previously-toggled users is acceptable per the retrospective spec.
  useEffect(() => {
    setMode(readPrefs());
  }, []);

  // Mirror focus into a global root class so CSS in src/app/globals.css can
  // hide the layout-level chrome (sidebar / topbar / comments rail) without
  // re-rendering server components. Cleanup on unmount so navigating away from
  // a focused page never leaves the rest of the app in a half-hidden state.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('cairn-focus-mode', mode.focus);
    return () => {
      document.documentElement.classList.remove('cairn-focus-mode');
    };
  }, [mode.focus]);

  const setFocus = useCallback((v: boolean) => {
    setMode((prev) => {
      const next = { ...prev, focus: v };
      writePrefs(next);
      return next;
    });
  }, []);

  const setReader = useCallback((v: boolean) => {
    setMode((prev) => {
      const next = { ...prev, reader: v };
      writePrefs(next);
      return next;
    });
  }, []);

  const value = useMemo<ModeCtx>(
    () => ({ focus: mode.focus, reader: mode.reader, setFocus, setReader }),
    [mode.focus, mode.reader, setFocus, setReader],
  );

  return (
    <Ctx.Provider value={value}>
      <div data-page-mode-shell="" data-focus={mode.focus} data-reader={mode.reader}>
        <div className="mb-2 flex justify-end gap-1">{toggles}</div>
        {children}
      </div>
    </Ctx.Provider>
  );
}
