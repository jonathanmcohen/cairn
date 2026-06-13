// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PagesSection } from '@/components/sidebar/pages-section';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json' with { type: 'json' };

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// jsdom computes no layout; pin a viewport height on the tree scroll container
// so @tanstack/react-virtual renders a non-empty window (mirrors
// virtualized-page-tree.test.tsx).
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

const node = (id: string, title: string, spaceId: string | null) => ({
  id,
  title,
  icon: null,
  depth: 0,
  parentId: null,
  spaceId,
  status: 'published' as const,
  position: 0,
  childCount: 0,
});

function renderSection() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <PagesSection
        tree={[node('a', 'Alpha', 's1'), node('b', 'Beta', 's2')]}
        spaces={[
          { id: 's1', name: 'Space One', icon: null, position: 0 },
          { id: 's2', name: 'Space Two', icon: null, position: 1 },
        ]}
      />
    </I18nProvider>,
  );
}

describe('<PagesSection> (#212/#213)', () => {
  it('renders a sticky localized PAGES header', () => {
    renderSection();
    const heading = screen.getByText('Pages');
    expect(heading.closest('[data-pages-header]')?.className).toContain('sticky');
  });

  it('exposes a collapse-all / expand-all toggle that flips label + aria-pressed', () => {
    renderSection();
    const btn = screen.getByRole('button', { name: 'Collapse all' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    const expandBtn = screen.getByRole('button', { name: 'Expand all' });
    expect(expandBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('collapsing all hides page rows, leaving only space headers', () => {
    renderSection();
    expect(screen.getByText('Alpha')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Space One')).toBeTruthy();
  });
});
