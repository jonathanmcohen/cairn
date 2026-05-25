'use client';

import { type ReactNode, type RefObject, useEffect, useRef } from 'react';

export type LongPressProps = {
  /** Fires after a press of `holdMs` with no cancelling pointer travel / release. */
  onLongPress: () => void;
  /** Hold duration in ms. Default 500. */
  holdMs?: number;
  /** Max pointer travel (px) before the gesture is cancelled. Default 8. */
  cancelTravelPx?: number;
  children: ReactNode;
};

export type UseLongPressOptions = {
  onLongPress: () => void;
  holdMs?: number;
  cancelTravelPx?: number;
};

/**
 * Hook flavour of `<LongPress>`. Attach to any element via ref — useful when
 * the wrapper element matters for HTML semantics (e.g. a `<tr>` that can't be
 * wrapped in a generic span without breaking `<tbody>`).
 */
export function useLongPress(
  ref: RefObject<HTMLElement | null>,
  options: UseLongPressOptions,
): void {
  const onLongPress = options.onLongPress;
  const holdMs = options.holdMs ?? 500;
  const cancelTravelPx = options.cancelTravelPx ?? 8;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clear() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      start = null;
    }

    function onDown(ev: PointerEvent) {
      start = { x: ev.clientX, y: ev.clientY };
      timer = setTimeout(() => {
        timer = null;
        onLongPress();
      }, holdMs);
    }
    function onMove(ev: PointerEvent) {
      if (!start) return;
      const dx = Math.abs(ev.clientX - start.x);
      const dy = Math.abs(ev.clientY - start.y);
      if (dx > cancelTravelPx || dy > cancelTravelPx) clear();
    }
    function onEnd() {
      clear();
    }

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
    el.addEventListener('pointerleave', onEnd);
    return () => {
      clear();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      el.removeEventListener('pointerleave', onEnd);
    };
  }, [ref, onLongPress, holdMs, cancelTravelPx]);
}

/**
 * Wrap any subtree to bind a long-press → callback. Uses PointerEvents so it
 * works equally on touch + mouse. The wrapper renders an unstyled <span>
 * (display: contents) so existing layout is unaffected.
 *
 * Pair with a `<Sheet>` / `<DropdownMenu>` opened from within `onLongPress`
 * to surface a context menu on db rows + sidebar pages (per spec §3 G1 P2).
 */
export function LongPress({
  onLongPress,
  holdMs = 500,
  cancelTravelPx = 8,
  children,
}: LongPressProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  useLongPress(hostRef, { onLongPress, holdMs, cancelTravelPx });
  return (
    <span ref={hostRef} style={{ display: 'contents' }}>
      {children}
    </span>
  );
}
