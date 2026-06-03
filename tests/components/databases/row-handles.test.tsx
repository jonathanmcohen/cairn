// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ColumnLayoutItem } from '@/components/databases/column-ergonomics';
import type { VisibleNode } from '@/components/databases/row-tree';
import type { RowData } from '@/components/databases/use-database-data';
import { VirtualizedRowBody } from '@/components/databases/virtualized-row-body';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

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

function col(id: string, name: string): ColumnLayoutItem {
  return {
    id,
    width: 160,
    frozen: false,
    insetInlineStart: null,
    prop: { id, name, type: 'text', config: null },
  } as ColumnLayoutItem;
}

function rowData(id: string): RowData {
  return { row: { id, createdAt: '', parentRowId: null }, cells: {} };
}

function node(id: string): VisibleNode {
  return { row: { id, parentRowId: null }, depth: 0, hasChildren: false } as VisibleNode;
}

describe('row left-gutter handles (#245)', () => {
  it('renders + and ⋮⋮ handles in a left gutter per row', () => {
    const visible = [node('r1')];
    render(
      <VirtualizedRowBody
        columns={[col('c1', 'Title')]}
        visible={visible}
        rowDataById={new Map([['r1', rowData('r1')]])}
        collapsed={new Set()}
        databaseId="db1"
        onToggle={() => {}}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onOpenDetail={() => {}}
        onDeleteRow={() => {}}
        onDuplicateRow={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /insert row below/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /row actions/i })).toBeTruthy();
    expect(document.querySelector('[data-row-gutter]')).toBeTruthy();
  });

  it('opening the ⋮⋮ menu shows Open, Duplicate, Delete', async () => {
    render(
      <VirtualizedRowBody
        columns={[col('c1', 'Title')]}
        visible={[node('r1')]}
        rowDataById={new Map([['r1', rowData('r1')]])}
        collapsed={new Set()}
        databaseId="db1"
        onToggle={() => {}}
        onChange={() => {}}
        onAddChild={() => {}}
        adding={false}
        onOpenDetail={() => {}}
        onDeleteRow={() => {}}
        onDuplicateRow={() => {}}
      />,
    );
    const menuBtn = screen.getAllByRole('button', { name: /row actions/i })[0];
    if (!menuBtn) throw new Error('no row-actions button');
    fireEvent.pointerDown(menuBtn, { button: 0, ctrlKey: false });
    fireEvent.click(menuBtn);
    expect(await screen.findByRole('menuitem', { name: /open/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /duplicate/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeTruthy();
  });
});
