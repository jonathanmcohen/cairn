// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PullToRefresh } from '@/components/mobile/pull-to-refresh';

function pointer(type: string, x = 50, y = 50) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent & {
    clientX: number;
    clientY: number;
    pointerId: number;
  };
  Object.assign(ev, { clientX: x, clientY: y, pointerId: 1 });
  return ev;
}

describe('<PullToRefresh>', () => {
  it('fires onRefresh once when the pull crosses the threshold from scrollTop=0', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh} thresholdPx={60}>
        <div data-testid="content" style={{ height: 200 }}>
          rows
        </div>
      </PullToRefresh>,
    );
    const root = container.firstChild as HTMLElement;
    // jsdom: scrollTop is settable; default 0.
    fireEvent(root, pointer('pointerdown', 50, 10));
    fireEvent(root, pointer('pointermove', 50, 30));
    fireEvent(root, pointer('pointermove', 50, 80)); // 70px down > 60 threshold
    fireEvent(root, pointer('pointerup', 50, 80));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the scroll container is not at the top', () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh} thresholdPx={60}>
        <div style={{ height: 200 }}>rows</div>
      </PullToRefresh>,
    );
    const root = container.firstChild as HTMLElement;
    Object.defineProperty(root, 'scrollTop', { configurable: true, value: 50 });
    fireEvent(root, pointer('pointerdown', 50, 10));
    fireEvent(root, pointer('pointermove', 50, 100));
    fireEvent(root, pointer('pointerup', 50, 100));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not fire when pull travel is under threshold', () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh} thresholdPx={60}>
        <div>rows</div>
      </PullToRefresh>,
    );
    const root = container.firstChild as HTMLElement;
    fireEvent(root, pointer('pointerdown', 50, 10));
    fireEvent(root, pointer('pointermove', 50, 50));
    fireEvent(root, pointer('pointerup', 50, 50));
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
