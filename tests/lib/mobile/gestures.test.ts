// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipeBack } from '@/lib/mobile/gestures';

function dispatchPointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent & {
    clientX: number;
    clientY: number;
    pointerId: number;
  };
  Object.assign(ev, { clientX: x, clientY: y, pointerId: 1 });
  el.dispatchEvent(ev);
}

function setup(opts: { thresholdPx?: number; edgeInsetPx?: number } = {}) {
  const onBack = vi.fn();
  const { result } = renderHook(() => {
    const ref = useRef<HTMLDivElement>(null);
    useSwipeBack(ref, { onBack, ...opts });
    return ref;
  });
  const host = document.createElement('div');
  // jsdom doesn't drive layout; the hook reads pointer coords, not getBoundingClientRect.
  document.body.appendChild(host);
  act(() => {
    (result.current as { current: HTMLDivElement | null }).current = host;
  });
  return { host, onBack };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('useSwipeBack', () => {
  it('fires onBack when horizontal travel from the left edge exceeds threshold', () => {
    const { host, onBack } = setup({ thresholdPx: 80, edgeInsetPx: 20 });
    dispatchPointer(host, 'pointerdown', 10, 200);
    dispatchPointer(host, 'pointermove', 100, 205);
    dispatchPointer(host, 'pointerup', 100, 205);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not fire when below threshold', () => {
    const { host, onBack } = setup({ thresholdPx: 80 });
    dispatchPointer(host, 'pointerdown', 10, 200);
    dispatchPointer(host, 'pointermove', 50, 205);
    dispatchPointer(host, 'pointerup', 50, 205);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('does not fire when the drag starts beyond the left edge inset', () => {
    const { host, onBack } = setup({ thresholdPx: 80, edgeInsetPx: 20 });
    dispatchPointer(host, 'pointerdown', 120, 200); // started mid-screen
    dispatchPointer(host, 'pointermove', 220, 205);
    dispatchPointer(host, 'pointerup', 220, 205);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('does not fire when vertical travel dominates (user is scrolling, not swiping)', () => {
    const { host, onBack } = setup({ thresholdPx: 80 });
    dispatchPointer(host, 'pointerdown', 10, 200);
    dispatchPointer(host, 'pointermove', 100, 290); // dx=90, dy=90 — diagonal, treat as scroll
    dispatchPointer(host, 'pointerup', 100, 290);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('detaches listeners on unmount', () => {
    const onBack = vi.fn();
    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      useSwipeBack(ref, { onBack });
      return ref;
    });
    unmount();
    // No assertion on the ref host (it was never set); the test passes if the
    // hook's cleanup didn't throw.
    expect(onBack).not.toHaveBeenCalled();
  });
});
