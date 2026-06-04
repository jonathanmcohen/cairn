// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

// Render with i18n.
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

describe('<ViewSwitcher> optimistic add-view (#263)', () => {
  it('a new gallery tab appears before the slow POST resolves; onChange fires immediately', async () => {
    const { ViewSwitcher } = await import('@/components/databases/view-switcher');

    let resolvePost: (v: Response) => void = () => {};
    vi.spyOn(global, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((res) => {
          resolvePost = res;
        }),
    );

    const onChange = vi.fn();
    const onViewsChanged = vi.fn();
    const onAddViewOptimistic = vi.fn();

    renderWithI18n(
      <ViewSwitcher
        databaseId="db1"
        views={[{ id: 'v1', type: 'table', name: 'Table' }]}
        activeId="v1"
        dateProperties={[]}
        selectProperties={[]}
        onChange={onChange}
        onViewsChanged={onViewsChanged}
        onAddViewOptimistic={onAddViewOptimistic}
      />,
    );

    // Open the add-view picker and choose Gallery.
    fireEvent.click(screen.getByRole('combobox', { name: /add view/i }));
    fireEvent.click(await screen.findByRole('option', { name: /gallery/i }));

    // Optimistic: the parent is told to append a temp view, and the active view
    // switches — both BEFORE the POST resolves.
    await waitFor(() => expect(onAddViewOptimistic).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalled();

    // Resolve the POST; reconciliation refetch is requested.
    resolvePost(new Response(JSON.stringify({ id: 'v2' }), { status: 201 }));
    await waitFor(() => expect(onViewsChanged).toHaveBeenCalled());
  });
});
