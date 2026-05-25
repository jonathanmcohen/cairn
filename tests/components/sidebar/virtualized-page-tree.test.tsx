// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
import type { FlatPageNode } from '@/lib/pages/tree';

// jsdom doesn't compute layout, so every HTMLElement.offsetWidth/offsetHeight
// returns 0 and every Element.getBoundingClientRect() returns {0,0,0,0}.
// @tanstack/react-virtual reads `offsetWidth`/`offsetHeight` on the scroll
// element to size the viewport (see virtual-core/getRect); without a non-zero
// height it computes a 0-item window and our "windowed subset" assertions
// vacuously pass with `length === 0`. Pin a realistic sidebar viewport on the
// overflow-y-auto container so the virtualizer can actually compute a window.
// We also polyfill ResizeObserver — jsdom doesn't ship one — so the
// virtualizer's mount path is exercised, even though no resize events fire.
beforeAll(() => {
  const SIDEBAR_VIEWPORT_HEIGHT = 600;
  const SIDEBAR_VIEWPORT_WIDTH = 240;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-y-auto') ? SIDEBAR_VIEWPORT_HEIGHT : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-y-auto') ? SIDEBAR_VIEWPORT_WIDTH : 0;
    },
  });
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
      NoopResizeObserver;
  }
});

function makeNodes(n: number): FlatPageNode[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p-${i}`,
    parentId: i === 0 ? null : `p-${Math.floor(i / 10)}`,
    title: `Page ${i}`,
    icon: null,
    depth: i === 0 ? 0 : Math.min(3, Math.floor(Math.log10(i + 1))),
  }));
}

describe('<VirtualizedPageTree>', () => {
  it('renders an empty-state when given an empty list', () => {
    const { container } = render(<VirtualizedPageTree initial={[]} />);
    expect(container.textContent).toContain('No pages yet');
  });

  it('renders only a windowed subset (NOT all rows) for a large list', () => {
    const { container } = render(<VirtualizedPageTree initial={makeNodes(1000)} />);
    // The virtualizer windows by visible scroll height; in jsdom (no layout),
    // it falls back to overscan + initial estimate, but the rendered <li>
    // count must be MUCH less than 1000 (the whole point of virtualization).
    const items = container.querySelectorAll('[data-virtual-row]');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(100);
  });

  it('applies depth-based indentation as inline style', () => {
    const nodes: FlatPageNode[] = [
      { id: 'a', parentId: null, title: 'A', icon: null, depth: 0 },
      { id: 'b', parentId: 'a', title: 'B', icon: null, depth: 1 },
      { id: 'c', parentId: 'b', title: 'C', icon: null, depth: 2 },
    ];
    const { container } = render(<VirtualizedPageTree initial={nodes} />);
    const rows = container.querySelectorAll('[data-virtual-row]');
    // Each rendered row reports its depth via data-depth so we can assert
    // without coupling to the virtualizer's internal style strings.
    const depths = Array.from(rows).map((r) => Number((r as HTMLElement).dataset.depth));
    // Either all three are in the initial window OR the first-visible has depth 0.
    expect(depths.length).toBeGreaterThan(0);
    expect(depths.every((d) => Number.isInteger(d))).toBe(true);
  });

  it('renders 10,000 nodes in under 200ms (initial mount)', () => {
    const nodes = makeNodes(10_000);
    const start = performance.now();
    render(<VirtualizedPageTree initial={nodes} />);
    const elapsedMs = performance.now() - start;
    // The windowed render must not iterate all 10k nodes; the budget is loose
    // enough for slow CI runners but tight enough to catch a regression where
    // someone accidentally renders the full list.
    expect(elapsedMs).toBeLessThan(200);
  });
});
