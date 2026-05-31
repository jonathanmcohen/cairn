// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ColumnLayoutItem } from '@/components/databases/column-ergonomics';
import type { VisibleNode } from '@/components/databases/row-tree';
import type { RowData } from '@/components/databases/use-database-data';
import { VirtualizedRowBody } from '@/components/databases/virtualized-row-body';

// The body now reads the row-peek aria-label via useT(); render with the
// authoritative English copy instead of wiring a full <I18nProvider>.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

// jsdom doesn't compute layout, so every HTMLElement.offsetWidth/offsetHeight
// returns 0 and every Element.getBoundingClientRect() returns {0,0,0,0}.
// @tanstack/react-virtual reads `offsetWidth`/`offsetHeight` on the scroll
// element to size the viewport (see virtual-core/getRect); without a non-zero
// height it computes a 0-item window and our "windowed subset" assertions
// vacuously pass with `length === 0`. Pin a realistic table viewport on the
// overflow-auto container so the virtualizer can actually compute a window.
// We also polyfill ResizeObserver — jsdom doesn't ship one — so the
// virtualizer's mount path is exercised, even though no resize events fire.
beforeAll(() => {
  const VIEWPORT_HEIGHT = 600;
  const VIEWPORT_WIDTH = 800;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-auto') ? VIEWPORT_HEIGHT : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains?.('overflow-auto') ? VIEWPORT_WIDTH : 0;
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

function col(
  id: string,
  name: string,
  frozen = false,
  inset: number | null = null,
): ColumnLayoutItem {
  return {
    id,
    width: 160,
    frozen,
    insetInlineStart: inset,
    prop: {
      id,
      databaseId: 'db1',
      name,
      type: 'text',
      config: {},
      sortOrder: 0,
    } as ColumnLayoutItem['prop'],
  };
}

function row(id: string, depth = 0, hasChildren = false): VisibleNode {
  return {
    row: { id, parentRowId: null },
    depth,
    hasChildren,
  } as VisibleNode;
}

function rowData(id: string): RowData {
  return {
    row: { id, databaseId: 'db1', parentRowId: null, createdAt: new Date(), updatedAt: new Date() },
    cells: { c1: 'hello', c2: 'world' },
  } as unknown as RowData;
}

const COLUMNS = [col('c1', 'Title'), col('c2', 'Status')];

describe('<VirtualizedRowBody>', () => {
  it('renders an empty body when given zero visible rows', () => {
    const { container } = render(
      <VirtualizedRowBody
        columns={COLUMNS}
        visible={[]}
        rowDataById={new Map()}
        collapsed={new Set()}
        databaseId="db1"
        onToggle={() => {}}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onPeek={() => {}}
      />,
    );
    // The sticky header still renders even when there are zero rows.
    expect(container.querySelectorAll('[role="columnheader"]').length).toBe(COLUMNS.length);
    expect(container.querySelectorAll('[data-virtual-row]').length).toBe(0);
  });

  it('renders ONLY a windowed subset for a large visible list', () => {
    const visible = Array.from({ length: 1000 }, (_, i) => row(`r-${i}`));
    const rowDataById = new Map(visible.map((v) => [v.row.id, rowData(v.row.id)]));
    const { container } = render(
      <VirtualizedRowBody
        columns={COLUMNS}
        visible={visible}
        rowDataById={rowDataById}
        collapsed={new Set()}
        databaseId="db1"
        onToggle={() => {}}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onPeek={() => {}}
      />,
    );
    const rendered = container.querySelectorAll('[data-virtual-row]');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
  });

  it('marks the header row as sticky (top:0, position:sticky)', () => {
    const { container } = render(
      <VirtualizedRowBody
        columns={COLUMNS}
        visible={[]}
        rowDataById={new Map()}
        collapsed={new Set()}
        databaseId="db1"
        onToggle={() => {}}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onPeek={() => {}}
      />,
    );
    const header = container.querySelector('[data-virtual-header]') as HTMLElement;
    expect(header).not.toBeNull();
    // Style is set inline so jsdom can read it (Tailwind utility classes
    // wouldn't survive without a compiled stylesheet).
    expect(header.style.position).toBe('sticky');
    expect(header.style.top).toBe('0px');
  });

  it('calls onToggle when a row with children has its expand/collapse button clicked', () => {
    const onToggle = vi.fn();
    const visible = [row('r1', 0, true)];
    const rowDataById = new Map([[visible[0]!.row.id, rowData('r1')]]);
    const { container } = render(
      <VirtualizedRowBody
        columns={COLUMNS}
        visible={visible}
        rowDataById={rowDataById}
        collapsed={new Set()}
        databaseId="db1"
        onToggle={onToggle}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onPeek={() => {}}
      />,
    );
    const btn = container.querySelector('[aria-label*="ollapse"]') as HTMLButtonElement;
    btn?.click();
    expect(onToggle).toHaveBeenCalledWith('r1');
  });

  it('renders 10,000 visible rows in under 200ms', () => {
    const visible = Array.from({ length: 10_000 }, (_, i) => row(`r-${i}`));
    const rowDataById = new Map(visible.map((v) => [v.row.id, rowData(v.row.id)]));
    const start = performance.now();
    render(
      <VirtualizedRowBody
        columns={COLUMNS}
        visible={visible}
        rowDataById={rowDataById}
        collapsed={new Set()}
        databaseId="db1"
        onToggle={() => {}}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onPeek={() => {}}
      />,
    );
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe('<VirtualizedRowBody> — sticky-header regressions', () => {
  it('keeps the header sticky when the first column is frozen', () => {
    const cols = [col('c1', 'Title', true, 0), col('c2', 'Status')];
    const visible = Array.from({ length: 500 }, (_, i) => row(`r-${i}`));
    const rowDataById = new Map(visible.map((v) => [v.row.id, rowData(v.row.id)]));
    const { container } = render(
      <VirtualizedRowBody
        columns={cols}
        visible={visible}
        rowDataById={rowDataById}
        collapsed={new Set()}
        databaseId="db1"
        onToggle={() => {}}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onPeek={() => {}}
      />,
    );
    const header = container.querySelector('[data-virtual-header]') as HTMLElement;
    expect(header.style.position).toBe('sticky');
    expect(header.style.top).toBe('0px');
    // The frozen column header keeps its own sticky-inline-start (zIndex must
    // outrank the row-body sticky-inline-start so the corner cell wins both axes).
    const frozenColHeader = header.querySelector('[role="columnheader"]') as HTMLElement;
    expect(frozenColHeader.style.position).toBe('sticky');
    expect(Number(frozenColHeader.style.zIndex)).toBeGreaterThan(0);
  });

  it('header stays mounted even when the windowed body re-renders rows', () => {
    const visible = Array.from({ length: 1000 }, (_, i) => row(`r-${i}`));
    const rowDataById = new Map(visible.map((v) => [v.row.id, rowData(v.row.id)]));
    const { container, rerender } = render(
      <VirtualizedRowBody
        columns={COLUMNS}
        visible={visible}
        rowDataById={rowDataById}
        collapsed={new Set()}
        databaseId="db1"
        onToggle={() => {}}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onPeek={() => {}}
      />,
    );
    const firstHeader = container.querySelector('[data-virtual-header]');
    rerender(
      <VirtualizedRowBody
        columns={COLUMNS}
        visible={visible.slice(0, 500)}
        rowDataById={rowDataById}
        collapsed={new Set()}
        databaseId="db1"
        onToggle={() => {}}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onPeek={() => {}}
      />,
    );
    const secondHeader = container.querySelector('[data-virtual-header]');
    // The header element should be the same DOM node (preserved across re-renders).
    expect(secondHeader).toBe(firstHeader);
  });
});
