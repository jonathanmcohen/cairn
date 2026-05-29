// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewSwitcher } from '@/components/databases/view-switcher';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

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
    // Open the "Add view" control and pick Gallery (exact UI built in Task 2;
    // for this task the per-type buttons still exist — target by accessible name).
    fireEvent.click(screen.getByRole('button', { name: /add.*gallery|gallery/i }));
    await waitFor(() => expect(onViewsChanged).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith('view-new');
  });
});
