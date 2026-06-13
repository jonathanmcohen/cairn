// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
import type { FlatPageNode } from '@/lib/pages/tree';

// The rows read strings via useT(); render with authoritative English copy.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return {
    useT: () => (key: string, vars?: Record<string, string>) =>
      (en[key] ?? key).replace(/\{(\w+)\}/g, (_m, k) => vars?.[k] ?? ''),
  };
});
// v0.10.2 S8 — the tree itself now consumes useRouter (DnD refresh after a
// drop); stub the router like the sibling tree tests do.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
// The row actions hook + menus pull in client-only deps; stub them to inert.
vi.mock('@/components/sidebar/use-page-row-actions', () => ({
  usePageRowActions: () => ({ renaming: false }),
}));
vi.mock('@/components/sidebar/page-row-actions-menu', () => ({
  PageRowActionsMenu: () => null,
}));
vi.mock('@/components/sidebar/page-row-context-menu', () => ({
  PageRowContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// jsdom computes no layout, so @tanstack/react-virtual reads offsetHeight/Width
// as 0 and renders a 0-row window. Pin a realistic viewport on the scroll
// container (the overflow-y-auto div) so the page row actually mounts, and
// polyfill ResizeObserver — mirrors the setup in virtualized-page-tree.test.tsx.
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

afterEach(cleanup);

const node: FlatPageNode = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Copy of a very long page title that will visually truncate',
  icon: null,
  depth: 0,
  hasChildren: false,
  spaceId: null,
} as unknown as FlatPageNode;

describe('<VirtualizedPageTree> truncated title tooltip', () => {
  it('exposes the full page title via a native title attribute', () => {
    render(<VirtualizedPageTree initial={[node]} />);
    const titleSpan = screen.getByText(node.title);
    expect(titleSpan.getAttribute('title')).toBe(node.title);
  });
});
