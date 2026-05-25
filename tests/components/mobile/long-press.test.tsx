// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LongPress } from '@/components/mobile/long-press';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x = 10,
  y = 10,
) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent & {
    clientX: number;
    clientY: number;
    pointerId: number;
  };
  Object.assign(ev, { clientX: x, clientY: y, pointerId: 1 });
  return ev;
}

describe('<LongPress>', () => {
  it('fires onLongPress after the hold duration', () => {
    const onLongPress = vi.fn();
    const { container } = render(
      <LongPress onLongPress={onLongPress} holdMs={500}>
        <div data-testid="target">hi</div>
      </LongPress>,
    );
    const target = container.querySelector('[data-testid="target"]')!;
    fireEvent(target, pointer('pointerdown', 10, 10));
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('cancels when the pointer moves more than 8px', () => {
    const onLongPress = vi.fn();
    const { container } = render(
      <LongPress onLongPress={onLongPress} holdMs={500}>
        <div data-testid="target">hi</div>
      </LongPress>,
    );
    const target = container.querySelector('[data-testid="target"]')!;
    fireEvent(target, pointer('pointerdown', 10, 10));
    fireEvent(target, pointer('pointermove', 25, 10)); // 15px > 8px → cancel
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels on pointerup before the hold elapses', () => {
    const onLongPress = vi.fn();
    const { container } = render(
      <LongPress onLongPress={onLongPress} holdMs={500}>
        <div data-testid="target">hi</div>
      </LongPress>,
    );
    const target = container.querySelector('[data-testid="target"]')!;
    fireEvent(target, pointer('pointerdown'));
    vi.advanceTimersByTime(200);
    fireEvent(target, pointer('pointerup'));
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not leak timers on unmount mid-hold', () => {
    const onLongPress = vi.fn();
    const { container, unmount } = render(
      <LongPress onLongPress={onLongPress} holdMs={500}>
        <div data-testid="target">hi</div>
      </LongPress>,
    );
    const target = container.querySelector('[data-testid="target"]')!;
    fireEvent(target, pointer('pointerdown'));
    unmount();
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
