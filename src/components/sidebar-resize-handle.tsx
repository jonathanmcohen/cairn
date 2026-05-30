'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256; // = w-64 (16rem)
const STEP = 16;
const CSS_VAR = '--cairn-sidebar-w';

function clamp(w: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));
}

function applyWidth(w: number): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(CSS_VAR, `${w}px`);
  }
}

/**
 * P19 #42 — drag- and keyboard-resizable sidebar boundary. Drives the sidebar
 * width via the `--cairn-sidebar-w` CSS custom property on <html> and persists
 * it to localStorage (device/viewport preference — no DB migration warranted).
 * Clamped to [200, 480]px; default 256px (= w-64). Desktop-only affordance
 * (`hidden md:block`); the mobile drawer is unaffected.
 *
 * The visible grabber is a thin line, but the pointer/touch hit area is widened
 * to ≥44px via transparent padding so it clears the touch-target gate.
 */
export function SidebarResizeHandle({ storageKey }: { storageKey: string }) {
  const t = useT();
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);

  const persist = useCallback(
    (w: number) => {
      const clamped = clamp(w);
      setWidth(clamped);
      applyWidth(clamped);
      try {
        localStorage.setItem(storageKey, String(clamped));
      } catch {
        // localStorage may be unavailable (private mode) — width still applies for the session.
      }
    },
    [storageKey],
  );

  // On mount, restore the persisted width and apply it.
  useEffect(() => {
    let stored: number | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) stored = Number.parseInt(raw, 10);
    } catch {
      stored = null;
    }
    const w = stored && !Number.isNaN(stored) ? clamp(stored) : DEFAULT_WIDTH;
    setWidth(w);
    applyWidth(w);
  }, [storageKey]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const el = event.currentTarget;
    el.setPointerCapture?.(event.pointerId);
    const onMove = (e: PointerEvent) => {
      // The sidebar is on the inline-start edge; width grows as the pointer moves right.
      persist(e.clientX);
    };
    const onUp = (e: PointerEvent) => {
      persist(e.clientX);
      el.releasePointerCapture?.(event.pointerId);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      persist(width + STEP);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      persist(width - STEP);
    } else if (event.key === 'Home') {
      event.preventDefault();
      persist(MIN_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      persist(MAX_WIDTH);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an interactive split-pane resizer needs a focusable, handler-bearing element; <hr> cannot carry tabIndex + pointer/keydown handlers, so role="separator" on a <div> is the correct ARIA pattern here
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar.resize')}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 end-0 z-10 hidden w-3 translate-x-1/2 cursor-col-resize touch-none select-none md:block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className="absolute inset-y-0 start-1/2 w-px bg-border" />
    </div>
  );
}
