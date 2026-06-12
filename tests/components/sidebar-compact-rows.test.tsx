// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySidebarDensity,
  ROW_HEIGHT_BY_DENSITY,
  SIDEBAR_DENSITY_COMPACT_CLASS,
  SIDEBAR_DENSITY_STORAGE_KEY,
  setSidebarDensity,
} from '@/components/sidebar/density-tokens';
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

// v0.10.2 S2 — density is a per-device localStorage preference; reset to the
// comfortable default between tests so cases stay order-independent.
beforeEach(() => {
  localStorage.removeItem(SIDEBAR_DENSITY_STORAGE_KEY);
  document.documentElement.classList.remove(SIDEBAR_DENSITY_COMPACT_CLASS);
});

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

const renderTree = () =>
  render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <VirtualizedPageTree initial={[node('p1', 'Alpha'), node('p2', 'Beta')]} />
    </I18nProvider>,
  );

const rowFor = (title: string) =>
  screen.getByText(title).closest('[data-row-kind="page"]') as HTMLElement;

describe('compact sidebar rows (#208)', () => {
  it('estimates rows at 26px (v0.9.13 #130 density)', () => {
    expect(ROW_HEIGHT_PX).toBe(26);
  });
  it('renders 16px (h-4 w-4) page-row icons', () => {
    renderTree();
    const row = rowFor('Alpha');
    expect(row?.querySelector('.h-4.w-4')).toBeTruthy();
    expect(row?.querySelector('.h-5.w-5')).toBeNull();
  });
});

describe('sidebar density preference (v0.10.2 S2)', () => {
  it('defaults to comfortable: rows render at 26px', async () => {
    renderTree();
    await waitFor(() => {
      expect(rowFor('Alpha').style.height).toBe(`${ROW_HEIGHT_BY_DENSITY.comfortable}px`);
    });
  });

  it('renders 22px rows when compact density is persisted before mount', async () => {
    localStorage.setItem(SIDEBAR_DENSITY_STORAGE_KEY, 'compact');
    renderTree();
    await waitFor(() => {
      expect(rowFor('Alpha').style.height).toBe(`${ROW_HEIGHT_BY_DENSITY.compact}px`);
    });
  });

  it('live-switches mounted rows (26px → 22px, offsets follow) via the density-changed event', async () => {
    renderTree();
    await waitFor(() => {
      expect(rowFor('Beta').style.transform).toBe(
        `translateY(${ROW_HEIGHT_BY_DENSITY.comfortable}px)`,
      );
    });
    act(() => setSidebarDensity('compact')); // persists + dispatches cairn:density-changed
    await waitFor(() => {
      expect(rowFor('Alpha').style.height).toBe(`${ROW_HEIGHT_BY_DENSITY.compact}px`);
      // The second row's offset must re-measure too — no overlap/gap.
      expect(rowFor('Beta').style.transform).toBe(`translateY(${ROW_HEIGHT_BY_DENSITY.compact}px)`);
    });
  });

  it('applySidebarDensity toggles the cairn-sidebar-compact root class', () => {
    applySidebarDensity('compact');
    expect(document.documentElement.classList.contains(SIDEBAR_DENSITY_COMPACT_CLASS)).toBe(true);
    applySidebarDensity('comfortable');
    expect(document.documentElement.classList.contains(SIDEBAR_DENSITY_COMPACT_CLASS)).toBe(false);
  });
});
