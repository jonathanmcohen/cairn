// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CellEditor } from '@/components/databases/cell-editor';

// jsdom lacks the layout APIs radix Select/Popover call on mount.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

describe('<CellEditor> themed controls (#38)', () => {
  it('renders a select-type cell as a radix combobox, not a native <select>', () => {
    const { container } = render(
      <CellEditor
        databaseId="db1"
        rowId="r1"
        property={{
          id: 'p1',
          name: 'Status',
          type: 'select',
          config: { options: [{ id: 'o1', name: 'Open' }] },
        }}
        value="o1"
        onSaved={() => {}}
      />,
    );
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy();
  });

  it('saves the chosen option id via PATCH', async () => {
    const onSaved = vi.fn();
    render(
      <CellEditor
        databaseId="db1"
        rowId="r1"
        property={{
          id: 'p1',
          name: 'Status',
          type: 'select',
          config: {
            options: [
              { id: 'o1', name: 'Open' },
              { id: 'o2', name: 'Done' },
            ],
          },
        }}
        value=""
        onSaved={onSaved}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Status' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Done' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].body);
    expect(body.cells.p1).toBe('o2');
  });

  it('renders a date-type cell as a themed DateField button, not <input type=date>', () => {
    const { container } = render(
      <CellEditor
        databaseId="db1"
        rowId="r1"
        property={{ id: 'p1', name: 'Due', type: 'date', config: null }}
        value="2026-01-02"
        onSaved={() => {}}
      />,
    );
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByText('2026-01-02')).toBeTruthy();
  });
});
