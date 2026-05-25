'use client';

import { type RefObject, useEffect } from 'react';

export type SwipeBackOptions = {
  /** Callback fired when a qualifying back-swipe completes. */
  onBack: () => void;
  /** Horizontal travel (px) required to trigger. Default 80. */
  thresholdPx?: number;
  /** Maximum X-coordinate where a swipe may *start* (px from left edge). Default 24. */
  edgeInsetPx?: number;
  /** Maximum |dy| (px) allowed before the gesture is treated as a scroll, not a swipe. Default 30. */
  maxVerticalDriftPx?: number;
};

/**
 * Edge-swipe-from-left → invoke `onBack`. Uses PointerEvents so the same code
 * handles touch + mouse + stylus. Listeners attach to the element the returned
 * ref points at; safe to use on any container (typically the page root).
 *
 * Gesture rules:
 *  - Pointer must START within `edgeInsetPx` of the left edge.
 *  - Horizontal travel must exceed `thresholdPx` before pointerup.
 *  - Vertical travel must stay below `maxVerticalDriftPx` (so the user's
 *    finger reads as "swipe", not "scroll").
 */
export function useSwipeBack(ref: RefObject<HTMLElement | null>, options: SwipeBackOptions): void {
  const thresholdPx = options.thresholdPx ?? 80;
  const edgeInsetPx = options.edgeInsetPx ?? 24;
  const maxVerticalDriftPx = options.maxVerticalDriftPx ?? 30;
  const onBack = options.onBack;

  useEffect(() => {
    let startX: number | null = null;
    let startY: number | null = null;

    function targetInsideRef(ev: PointerEvent): boolean {
      // If the ref hasn't been bound yet, treat the gesture as scoped to the
      // document — typical when the hook is attached to a page root that
      // mounts after the effect first runs.
      const el = ref.current;
      if (!el) return true;
      const target = ev.target as Node | null;
      return target ? el === target || el.contains(target) : false;
    }

    function onDown(ev: PointerEvent) {
      if (!targetInsideRef(ev)) {
        startX = null;
        startY = null;
        return;
      }
      if (ev.clientX > edgeInsetPx) {
        startX = null;
        startY = null;
        return;
      }
      startX = ev.clientX;
      startY = ev.clientY;
    }

    function onMove(_ev: PointerEvent) {
      // Track travel only; commitment happens on pointerup.
    }

    function onUp(ev: PointerEvent) {
      if (startX === null || startY === null) return;
      const dx = ev.clientX - startX;
      const dy = Math.abs(ev.clientY - startY);
      startX = null;
      startY = null;
      if (dy > maxVerticalDriftPx) return;
      if (dx >= thresholdPx) onBack();
    }

    if (typeof window === 'undefined') return;
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [ref, onBack, thresholdPx, edgeInsetPx, maxVerticalDriftPx]);
}
