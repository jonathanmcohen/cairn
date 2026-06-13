// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
import type { FlatPageNode } from '@/lib/pages/tree';

// Page rows consume i18n + next/navigation via usePageRowActions; stub both so
// the tree renders without an <I18nProvider>/router (echo keys). Mirrors
// tests/components/sidebar/virtualized-page-tree.test.tsx.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

// jsdom computes no layout; pin a viewport on the overflow-y-auto scroll
// container so @tanstack/react-virtual renders a non-empty window, and
// polyfill ResizeObserver (mirrors virtualized-page-tree.test.tsx).
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-y-auto') ? 600 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-y-auto') ? 240 : 0;
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

/** Root(2 children: Branch, RootLeaf) → Branch(1 child: Nested). */
const NODES: FlatPageNode[] = [
  { id: 'root', parentId: null, title: 'Root', icon: null, depth: 0, childCount: 2 },
  { id: 'branch', parentId: 'root', title: 'Branch', icon: null, depth: 1, childCount: 1 },
  { id: 'nested', parentId: 'branch', title: 'Nested', icon: null, depth: 2, childCount: 0 },
  { id: 'leaf', parentId: 'root', title: 'RootLeaf', icon: null, depth: 1, childCount: 0 },
];

function rowOf(title: string): HTMLElement {
  const row = screen.getByText(title).closest('[data-row-kind="page"]');
  if (!row) throw new Error(`no page row for ${title}`);
  return row as HTMLElement;
}

describe('<VirtualizedPageTree> chevron + child-count badges (v0.10.2 S8)', () => {
  it('rows with children get a chevron toggle (aria-expanded) + count badge', () => {
    render(<VirtualizedPageTree initial={NODES} />);
    const root = rowOf('Root');
    const chevron = root.querySelector('button[aria-label="sidebar.pages.toggleChildren"]');
    expect(chevron).not.toBeNull();
    expect(chevron?.getAttribute('aria-expanded')).toBe('true');
    const badge = root.querySelector('[data-child-count]');
    expect(badge?.textContent).toBe('2');
    expect(rowOf('Branch').querySelector('[data-child-count]')?.textContent).toBe('1');
  });

  it('rows without children render NO chevron/badge but an equal-width spacer', () => {
    render(<VirtualizedPageTree initial={NODES} />);
    const leaf = rowOf('RootLeaf');
    expect(leaf.querySelector('button[aria-label="sidebar.pages.toggleChildren"]')).toBeNull();
    expect(leaf.querySelector('[data-child-count]')).toBeNull();
    const spacer = leaf.querySelector('[data-chevron-spacer]');
    expect(spacer).not.toBeNull();
    expect((spacer as HTMLElement).className).toContain('h-4');
    expect((spacer as HTMLElement).className).toContain('w-4');
  });

  it('clicking a chevron collapses ALL descendants (children + grandchildren) and back', () => {
    render(<VirtualizedPageTree initial={NODES} />);
    const chevron = rowOf('Root').querySelector(
      'button[aria-label="sidebar.pages.toggleChildren"]',
    ) as HTMLElement;
    fireEvent.click(chevron);
    expect(screen.queryByText('Branch')).toBeNull();
    expect(screen.queryByText('Nested')).toBeNull();
    expect(screen.queryByText('RootLeaf')).toBeNull();
    expect(screen.getByText('Root')).toBeTruthy();
    expect(
      rowOf('Root')
        .querySelector('button[aria-label="sidebar.pages.toggleChildren"]')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
    // Toggle back: everything reappears (default expanded, no persistence).
    fireEvent.click(
      rowOf('Root').querySelector(
        'button[aria-label="sidebar.pages.toggleChildren"]',
      ) as HTMLElement,
    );
    expect(screen.getByText('Branch')).toBeTruthy();
    expect(screen.getByText('Nested')).toBeTruthy();
    expect(screen.getByText('RootLeaf')).toBeTruthy();
  });

  it('collapsing a mid-level page hides only ITS subtree', () => {
    render(<VirtualizedPageTree initial={NODES} />);
    const chevron = rowOf('Branch').querySelector(
      'button[aria-label="sidebar.pages.toggleChildren"]',
    ) as HTMLElement;
    fireEvent.click(chevron);
    expect(screen.queryByText('Nested')).toBeNull();
    expect(screen.getByText('Branch')).toBeTruthy();
    expect(screen.getByText('RootLeaf')).toBeTruthy();
  });

  it('collapseAll SEEDS the per-page collapsed set; flipping it off expands all', () => {
    const { rerender } = render(<VirtualizedPageTree initial={NODES} collapseAll={true} />);
    // Seeded: every page with children is collapsed → only roots remain.
    expect(screen.getByText('Root')).toBeTruthy();
    expect(screen.queryByText('Branch')).toBeNull();
    expect(screen.queryByText('Nested')).toBeNull();
    // Individual chevrons still work against the seeded set (reconciliation).
    fireEvent.click(
      rowOf('Root').querySelector(
        'button[aria-label="sidebar.pages.toggleChildren"]',
      ) as HTMLElement,
    );
    expect(screen.getByText('Branch')).toBeTruthy();
    expect(screen.queryByText('Nested')).toBeNull(); // Branch stays collapsed.
    // Flipping collapseAll off re-seeds to empty → everything expands.
    rerender(<VirtualizedPageTree initial={NODES} collapseAll={false} />);
    expect(screen.getByText('Branch')).toBeTruthy();
    expect(screen.getByText('Nested')).toBeTruthy();
  });

  it("the '+/…' action cluster is persistently dimmed (opacity-30), not hidden", () => {
    render(<VirtualizedPageTree initial={NODES} />);
    const cluster = rowOf('Root').querySelector('[data-row-actions]') as HTMLElement;
    expect(cluster.className).toContain('opacity-30');
    expect(cluster.className).not.toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(cluster.className).toContain('group-hover:opacity-100');
    expect(cluster.className).toContain('group-focus-within:opacity-100');
  });
});
