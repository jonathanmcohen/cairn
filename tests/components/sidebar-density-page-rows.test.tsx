// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json' with { type: 'json' };

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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
  childCount: 0,
});

describe('sidebar page-row density (#130)', () => {
  it('renders page-title rows at the 13px density token, not text-sm', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <VirtualizedPageTree initial={[node('p1', 'Alpha')]} />
      </I18nProvider>,
    );
    const row = screen.getByText('Alpha').closest('[data-row-kind="page"]')?.querySelector('div');
    expect(row?.className).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(row?.className).toContain('leading-[var(--cairn-sidebar-leading)]');
    expect(row?.className).toContain('tracking-[0.1px]');
    expect(row?.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
  });
});
