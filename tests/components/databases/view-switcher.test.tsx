// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewSwitcher } from '@/components/databases/view-switcher';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

// jsdom lacks layout APIs that Radix Select calls when its listbox mounts.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

function renderWithI18n(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<ViewSwitcher> create-then-switch (#115)', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'view-new', type: 'gallery', name: 'Gallery' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('activates the created view via onChange after a successful POST', async () => {
    const onChange = vi.fn();
    const onViewsChanged = vi.fn();
    renderWithI18n(
      <ViewSwitcher
        databaseId="db1"
        views={[{ id: 'view-1', type: 'table', name: 'Table' }]}
        activeId="view-1"
        dateProperties={[]}
        onChange={onChange}
        onViewsChanged={onViewsChanged}
      />,
    );
    // Open the "Add view" picker and choose Gallery. Radix Select opens on
    // keyboard activation (it gates on pointer events in jsdom).
    const trigger = screen.getByRole('combobox', { name: /add view/i });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const gallery = await screen.findByRole('option', { name: /gallery/i });
    fireEvent.click(gallery);
    await waitFor(() => expect(onViewsChanged).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith('view-new');
  });

  it('renders existing view tabs by name with a type icon and no "+" prefix', () => {
    renderWithI18n(
      <ViewSwitcher
        databaseId="db1"
        views={[
          { id: 'view-1', type: 'table', name: 'Table' },
          { id: 'view-2', type: 'gallery', name: 'Photos' },
        ]}
        activeId="view-1"
        dateProperties={[]}
        onChange={() => {}}
        onViewsChanged={() => {}}
      />,
    );
    const photos = screen.getByRole('button', { name: /photos/i });
    expect(photos.textContent).not.toContain('+');
    // exactly one "add view" affordance, not six per-type buttons
    expect(screen.getAllByRole('combobox', { name: /add view/i })).toHaveLength(1);
  });

  it('marks the active tab with aria-current', () => {
    renderWithI18n(
      <ViewSwitcher
        databaseId="db1"
        views={[{ id: 'view-1', type: 'table', name: 'Table' }]}
        activeId="view-1"
        dateProperties={[]}
        onChange={() => {}}
        onViewsChanged={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /table/i }).getAttribute('aria-current')).toBe(
      'true',
    );
  });
});
