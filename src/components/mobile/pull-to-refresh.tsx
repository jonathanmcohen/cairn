'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

export type PullToRefreshProps = {
  /** Async refresh callback; the wrapper shows a spinner while it resolves. */
  onRefresh: () => Promise<void> | void;
  /** Pull distance (px) at which onRefresh fires. Default 60. */
  thresholdPx?: number;
  children: ReactNode;
};

/**
 * Wrap a scrollable list. When the user pulls DOWN starting from scrollTop=0
 * and travel exceeds `thresholdPx`, fires `onRefresh`. Renders a 32px-tall
 * indicator above the content; the indicator's opacity scales with pull
 * progress. No external dep — PointerEvents only.
 *
 * Use on list/timeline views (mobile per spec §3 G1 P2). On desktop the pull
 * still works with mouse-drag but stays out of the way (the indicator hides
 * itself when not pulling).
 */
export function PullToRefresh({ onRefresh, thresholdPx = 60, children }: PullToRefreshProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    function onDown(ev: PointerEvent) {
      if (el && el.scrollTop > 0) {
        startYRef.current = null;
        return;
      }
      startYRef.current = ev.clientY;
    }
    function onMove(ev: PointerEvent) {
      if (startYRef.current === null) return;
      const dy = ev.clientY - startYRef.current;
      if (dy > 0) {
        const next = Math.min(dy, thresholdPx * 1.5);
        pullRef.current = next;
        setPull(next);
      }
    }
    async function onUp() {
      const fired = startYRef.current !== null && pullRef.current >= thresholdPx;
      startYRef.current = null;
      pullRef.current = 0;
      setPull(0);
      if (fired) {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }
    }

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [onRefresh, thresholdPx]);

  const indicatorOpacity = Math.min(pull / thresholdPx, 1);
  return (
    <div ref={rootRef} className="relative h-full overflow-y-auto">
      <div
        aria-hidden="true"
        className="pointer-events-none flex h-8 items-center justify-center text-xs text-muted-foreground"
        style={{ opacity: refreshing ? 1 : indicatorOpacity }}
      >
        {refreshing
          ? 'Refreshing…'
          : pull >= thresholdPx
            ? 'Release to refresh'
            : 'Pull to refresh'}
      </div>
      {children}
    </div>
  );
}
