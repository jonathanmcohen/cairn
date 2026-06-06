// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ROW_HEIGHT_PX, VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json' with { type: 'json' };

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// jsdom computes no layout, so @tanstack/react-virtual sizes the viewport to 0
// and renders an empty window. Pin a realistic sidebar height on the
// overflow-y-auto scroll container (mirrors virtualized-page-tree.test.tsx) so
// rows actually render and the icon assertion has a row to query.
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

const node = (id: string, title: string) => ({
  id,
  title,
  icon: null,
  depth: 0,
  parentId: null,
  spaceId: null,
  status: 'published' as const,
  position: 0,
});

describe('compact sidebar rows (#208)', () => {
  it('estimates rows at 26px (v0.9.13 #130 density)', () => {
    expect(ROW_HEIGHT_PX).toBe(26);
  });
  it('renders 16px (h-4 w-4) page-row icons', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <VirtualizedPageTree initial={[node('p1', 'Alpha'), node('p2', 'Beta')]} />
      </I18nProvider>,
    );
    const row = screen.getByText('Alpha').closest('[data-row-kind="page"]');
    expect(row?.querySelector('.h-4.w-4')).toBeTruthy();
    expect(row?.querySelector('.h-5.w-5')).toBeNull();
  });
});
