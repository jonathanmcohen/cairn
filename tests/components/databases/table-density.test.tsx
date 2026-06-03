// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TableView } from '@/components/databases/table-view';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

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

const meta = {
  database: { id: 'db1', name: 'DB', config: {} },
  properties: [{ id: 'p1', name: 'Name', type: 'text', config: {}, position: 0 }],
  views: [{ id: 'v1', type: 'table', name: 'Table', config: {}, position: 0 }],
};

function renderTable() {
  const rows = [
    { row: { id: 'r1', createdAt: '', parentRowId: null }, cells: {} },
    { row: { id: 'r2', createdAt: '', parentRowId: null }, cells: {} },
    { row: { id: 'r3', createdAt: '', parentRowId: null }, cells: {} },
  ];
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      <TableView
        databaseId="db1"
        meta={meta as never}
        rows={rows as never}
        view={{ id: 'v1', type: 'table', name: 'Table', config: {} }}
        onChange={() => {}}
      />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('<TableView> density + labeled controls (#218/#39)', () => {
  it('does not reserve a fixed h-[600px] body for a short table', () => {
    const { container } = renderTable();
    // The old populated-state wrapper hard-coded h-[600px]; it now sizes to
    // content with a max-h.
    expect(container.querySelector('.h-\\[600px\\]')).toBeNull();
    expect(container.querySelector('.max-h-\\[600px\\]')).toBeTruthy();
  });

  it('bottom add-row control shows the New row label + has an aria-label', () => {
    renderTable();
    const addRow = screen.getByRole('button', { name: /add row/i });
    expect(addRow.textContent ?? '').toMatch(/new row/i);
  });

  it('has no unlabeled icon-only buttons in the row body', () => {
    const { container } = renderTable();
    const buttons = Array.from(container.querySelectorAll('button'));
    for (const b of buttons) {
      const labelled =
        (b.getAttribute('aria-label')?.trim().length ?? 0) > 0 ||
        (b.getAttribute('title')?.trim().length ?? 0) > 0 ||
        (b.textContent?.trim().length ?? 0) > 0;
      expect(labelled).toBe(true);
    }
  });
});
