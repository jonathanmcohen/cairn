// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The body reads its aria-labels via useT(); render with the authoritative
// English copy instead of wiring a full <I18nProvider>.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

import { VirtualizedRowBody } from '@/components/databases/virtualized-row-body';

afterEach(cleanup);

// jsdom doesn't compute layout; pin a realistic viewport on the overflow-auto
// scroll container so @tanstack/react-virtual can compute a non-empty window
// (same approach as tests/components/databases/virtualized-row-body.test.tsx).
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-auto') ? 600 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-auto') ? 800 : 0;
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

const columns = [
  {
    id: 'p1',
    prop: { id: 'p1', databaseId: 'd1', name: 'Name', type: 'text', config: {}, sortOrder: 0 },
    width: 200,
    frozen: false,
    insetInlineStart: null,
  },
] as never;
const visible = [{ row: { id: 'r1', parentRowId: null }, depth: 0, hasChildren: true }] as never;
const rowDataById = new Map([
  ['r1', { row: { id: 'r1', databaseId: 'd1', parentRowId: null }, cells: {} }],
]) as never;

describe('<VirtualizedRowBody> disclosure icons', () => {
  it('renders a lucide chevron (not ▸/▾) for the collapse toggle', () => {
    const { container } = render(
      <VirtualizedRowBody
        columns={columns}
        visible={visible}
        rowDataById={rowDataById}
        collapsed={new Set()}
        databaseId="d1"
        onToggle={() => {}}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onDeleteRow={() => {}}
        onDuplicateRow={() => {}}
        onOpenDetail={() => {}}
      />,
    );
    const toggle = container.querySelector('[aria-label="Collapse row"]') as HTMLElement;
    expect(toggle).not.toBeNull();
    expect(toggle.querySelector('svg')).toBeTruthy();
    expect(toggle.textContent ?? '').not.toMatch(/▸|▾/);
  });
});
