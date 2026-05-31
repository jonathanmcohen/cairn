// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewSwitcher } from '@/components/databases/view-switcher';

vi.mock('@/lib/i18n/provider', () => ({
  useT: () => (k: string) => k,
}));

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

const baseProps = {
  databaseId: 'db1',
  views: [{ id: 'v1', type: 'table', name: 'Table' }],
  activeId: 'v1',
  onChange: () => {},
  onViewsChanged: () => {},
};

function openMenu() {
  fireEvent.click(screen.getByRole('combobox', { name: 'database.view.add' }));
}

describe('<ViewSwitcher> add-view dropdown (#142/#143)', () => {
  it('renders an icon for each addable view type', () => {
    render(<ViewSwitcher {...baseProps} dateProperties={[{ id: 'd1', name: 'Due' }]} />);
    openMenu();
    // Each option contains its lucide icon (an <svg>).
    const table = screen.getByRole('option', { name: /database\.view\.type\.table/ });
    expect(table.querySelector('svg')).not.toBeNull();
    const gallery = screen.getByRole('option', { name: /database\.view\.type\.gallery/ });
    expect(gallery.querySelector('svg')).not.toBeNull();
  });

  it('disables calendar/timeline and explains why when there is no date property', () => {
    render(<ViewSwitcher {...baseProps} dateProperties={[]} />);
    openMenu();
    const calendar = screen.getByRole('option', { name: /database\.view\.type\.calendar/ });
    expect(calendar.getAttribute('aria-disabled')).toBe('true');
    expect(calendar.getAttribute('title')).toBe('database.view.disabled.calendar');
    const timeline = screen.getByRole('option', { name: /database\.view\.type\.timeline/ });
    expect(timeline.getAttribute('aria-disabled')).toBe('true');
    expect(timeline.getAttribute('title')).toBe('database.view.disabled.timeline');
  });

  it('does not disable date views when a date property exists', () => {
    render(<ViewSwitcher {...baseProps} dateProperties={[{ id: 'd1', name: 'Due' }]} />);
    openMenu();
    const calendar = screen.getByRole('option', { name: /database\.view\.type\.calendar/ });
    expect(calendar.getAttribute('aria-disabled')).not.toBe('true');
    expect(calendar.getAttribute('title')).toBeNull();
  });
});
