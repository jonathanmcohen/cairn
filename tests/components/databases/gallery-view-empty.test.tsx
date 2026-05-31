// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GalleryView } from '@/components/databases/gallery-view';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

function renderWithI18n(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>,
  );
}

const meta = {
  properties: [{ id: 'p1', name: 'Title', type: 'text', config: {}, position: 0 }],
} as never;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 201 }));
});

describe('<GalleryView> empty-state CTA (#162)', () => {
  it('renders an Add-row CTA that POSTs a blank row and refreshes', async () => {
    const onChange = vi.fn();
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }));
    renderWithI18n(
      <GalleryView
        databaseId="db1"
        meta={meta}
        rows={[] as never}
        view={{ id: 'v1', type: 'gallery', name: 'G', config: {} } as never}
        onChange={onChange}
      />,
    );
    const cta = screen.getByRole('button', { name: /add your first row/i });
    fireEvent.click(cta);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/databases/db1/rows');
    expect(init.method).toBe('POST');
    expect(onChange).toHaveBeenCalled();
  });
});
