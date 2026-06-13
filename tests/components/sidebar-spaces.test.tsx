// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
import type { FlatPageNode } from '@/lib/pages/tree';

// PageTreeRow consumes i18n + next/navigation via usePageRowActions; stub both
// so the tree renders without an <I18nProvider>/router (echo keys). Mirrors
// tests/components/sidebar/virtualized-page-tree.test.tsx. The asserted strings
// (space names, "Unfiled", page titles) are data/literals, not translations.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

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

// Unmount each render before the next test. @tanstack/react-virtual schedules
// work through React 19's concurrent scheduler (setImmediate-backed); without
// an explicit unmount a deferred render task can fire AFTER the jsdom env is
// torn down and throw `ReferenceError: window is not defined`, which Vitest
// counts as an unhandled error and fails the whole run.
afterEach(cleanup);

describe('<VirtualizedPageTree> spaces grouping', () => {
  it('renders a header row per space + an Unfiled group', () => {
    const pages: FlatPageNode[] = [
      {
        id: 'p1',
        parentId: null,
        title: 'In space A',
        icon: null,
        depth: 0,
        childCount: 0,
        spaceId: 'sa',
      },
      {
        id: 'p2',
        parentId: null,
        title: 'Unfiled page',
        icon: null,
        depth: 0,
        childCount: 0,
        spaceId: null,
      },
    ];
    const spaces = [{ id: 'sa', name: 'Space A', icon: null, position: 0 }];
    const { container } = render(<VirtualizedPageTree initial={pages} spaces={spaces} />);
    expect(container.textContent).toContain('Space A');
    expect(container.textContent).toContain('Unfiled');
    expect(container.textContent).toContain('In space A');
    expect(container.textContent).toContain('Unfiled page');
  });

  it('omits Unfiled when every page has a space', () => {
    const pages: FlatPageNode[] = [
      { id: 'p1', parentId: null, title: 'A', icon: null, depth: 0, childCount: 0, spaceId: 'sa' },
    ];
    const spaces = [{ id: 'sa', name: 'Space A', icon: null, position: 0 }];
    const { container } = render(<VirtualizedPageTree initial={pages} spaces={spaces} />);
    expect(container.textContent).not.toContain('Unfiled');
  });

  it('renders flat (legacy) when no spaces prop is given', () => {
    const pages: FlatPageNode[] = [
      { id: 'p1', parentId: null, title: 'Legacy A', icon: null, depth: 0, childCount: 0 },
    ];
    const { container } = render(<VirtualizedPageTree initial={pages} />);
    expect(container.textContent).toContain('Legacy A');
    expect(container.textContent).not.toContain('Unfiled');
  });
});
