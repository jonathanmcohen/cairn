'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ExitFocusControl } from './exit-focus-control';
import { SidebarHotEdge } from './sidebar-hot-edge';

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
 * Non-throwing variant for components (e.g. <Editor>) that may be rendered
 * both inside and outside the shell — public `/p/<slug>` viewers mount the
 * editor without the workspace shell, so reader-mode falls back to false
 * there. Returns null when outside.
 */
export function usePageModeOptional(): ModeCtx | null {
  return useContext(Ctx);
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

/** Same-tab signal that focus mode must drop (e.g. a new page was just created). */
export const PAGE_FOCUS_RESET_EVENT = 'cairn:page-focus-reset';

/**
 * Clears the persisted focus flag (reader is intentionally preserved) and
 * notifies any mounted <PageModeShell> in this tab. Call from every new-page
 * creation path so a freshly created page never opens with chrome hidden
 * (#247). Safe to call from anywhere; no-ops on the server.
 */
export function resetPageFocusMode(): void {
  if (typeof window === 'undefined') return;
  try {
    const prev = readPrefs();
    const next: PageMode = { focus: false, reader: prev.reader };
    writePrefs(next);
    window.dispatchEvent(new CustomEvent(PAGE_FOCUS_RESET_EVENT));
  } catch {
    // ignore — best effort
  }
}

type Props = {
  children: ReactNode;
  /**
   * v0.9.9 Plan O #63/#247 — the App Router reuses this client subtree across
   * `/pages/[pageId]` navigations, so without page scoping the focus/reader
   * flags bleed from one document into the next. When `pageId` changes the shell
   * resets to defaults; the initial mount is skipped so the localStorage hydrate
   * still applies for same-page reloads. Complements Plan P's
   * `resetPageFocusMode()` (which only clears focus on new-page / template-use).
   */
  pageId?: string;
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
 *
 * a8 #17: the Focus/Reader toggle buttons (`<PageModeToggles>`) no longer
 * render in a dedicated bar here — they are placed directly into the title-row
 * action cluster in `page.tsx` so there is a single coherent control group.
 * The shell still owns the toggle STATE (context + `cairn-focus-mode` root
 * class); `<PageModeToggles>` reads it via `usePageMode()` from anywhere under
 * this provider.
 */
export function PageModeShell({ children, pageId }: Props) {
  const [mode, setMode] = useState<PageMode>(DEFAULTS);
  // Keep a live ref to `mode` so the shortcut-event listeners (registered once)
  // can read the current flags without re-subscribing on every toggle.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // v0.9.9 Plan O #63/#247 — per-page reset. The App Router reuses this client
  // subtree across `/pages/[pageId]` navigations, so a focus/reader view on one
  // page would otherwise bleed into the next. Reset to defaults only when
  // `pageId` actually changes; the initial mount is skipped (prevRef seeded with
  // the first pageId) so the localStorage hydrate still applies for same-page
  // reloads.
  const prevPageIdRef = useRef<string | undefined>(pageId);
  useEffect(() => {
    if (prevPageIdRef.current === pageId) return;
    prevPageIdRef.current = pageId;
    setMode(DEFAULTS);
    writePrefs(DEFAULTS);
  }, [pageId]);

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

  // Listen for focus-reset signals: the same-tab CustomEvent dispatched by
  // resetPageFocusMode() (a new page was just created) AND the cross-tab
  // `storage` event so a reset in another tab also lands here (#247).
  useEffect(() => {
    function onReset() {
      setMode((prev) => ({ ...prev, focus: false }));
    }
    function onStorage(e: StorageEvent) {
      if (e.key === PAGE_MODE_STORAGE_KEY) setMode(readPrefs());
    }
    window.addEventListener(PAGE_FOCUS_RESET_EVENT, onReset);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PAGE_FOCUS_RESET_EVENT, onReset);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

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

  // v0.9.9 Plan O #57/#236 — keyboard-shortcut toggles. The `page.focus` /
  // `page.reader` registry entries dispatch these window CustomEvents because
  // the toggle buttons live outside the dispatcher tree (and are CSS-hidden in
  // focus mode). Functional setters keep the listener fresh without
  // re-subscribing on every toggle.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onToggleFocus = () => setFocus(!modeRef.current.focus);
    const onToggleReader = () => setReader(!modeRef.current.reader);
    window.addEventListener('cairn:page-mode:toggle-focus', onToggleFocus);
    window.addEventListener('cairn:page-mode:toggle-reader', onToggleReader);
    return () => {
      window.removeEventListener('cairn:page-mode:toggle-focus', onToggleFocus);
      window.removeEventListener('cairn:page-mode:toggle-reader', onToggleReader);
    };
  }, [setFocus, setReader]);

  const value = useMemo<ModeCtx>(
    () => ({ focus: mode.focus, reader: mode.reader, setFocus, setReader }),
    [mode.focus, mode.reader, setFocus, setReader],
  );

  return (
    <Ctx.Provider value={value}>
      <div data-page-mode-shell="" data-focus={mode.focus} data-reader={mode.reader}>
        {children}
      </div>
      {/* v0.9.9 Plan O #58/#237 — these fixed controls live OUTSIDE the shell
          body and carry none of the data-cairn-* attributes, so the
          `cairn-focus-mode` hide rule never collapses them: they stay visible
          as the escape hatch while focus mode hides the rest of the chrome. */}
      {mode.focus && <ExitFocusControl onExit={() => setFocus(false)} />}
      {mode.focus && <SidebarHotEdge />}
    </Ctx.Provider>
  );
}
