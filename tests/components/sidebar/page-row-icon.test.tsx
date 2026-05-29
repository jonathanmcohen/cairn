// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VirtualizedPageTree } from '@/components/sidebar/virtualized-page-tree';
import type { FlatPageNode } from '@/lib/pages/tree';

// Page rows now consume i18n + next/navigation via usePageRowActions; stub both
// so the tree renders without an <I18nProvider>/router (echo keys).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList?.contains?.('overflow-y-auto') ? 600 : 0;
    },
  });
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  }
});
afterEach(cleanup);

describe('page row icon rendering', () => {
  it('does NOT leak the emoji:: shortcode prefix into the DOM', () => {
    const pages: FlatPageNode[] = [
      { id: 'p1', parentId: null, title: 'Test', icon: 'emoji::💡', depth: 0 },
    ];
    const { container } = render(<VirtualizedPageTree initial={pages} />);
    expect(container.textContent).toContain('Test');
    expect(container.textContent).not.toContain('emoji::');
    expect(container.textContent).toContain('💡');
  });
});
