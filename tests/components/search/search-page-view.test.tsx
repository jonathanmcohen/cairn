// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchPageView } from '@/components/search/search-page-view';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(cleanup);

function renderView(initialQuery: string) {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <SearchPageView initialQuery={initialQuery} />
    </I18nProvider>,
  );
}

describe('<SearchPageView>', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              results: [
                { id: 'p1', title: 'Quarterly plan', snippet: null, breadcrumb: [] },
                { id: 'p2', title: 'Hiring', snippet: null, breadcrumb: [] },
              ],
              warnings: [],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
  });

  it('seeds the chip input with the initial query', () => {
    renderView('type:page roadmap');
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('type:page roadmap');
  });

  it('renders results returned by /api/search', async () => {
    renderView('roadmap');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Quarterly plan/ }).getAttribute('href')).toBe(
        '/pages/p1',
      ),
    );
    expect(screen.getByRole('link', { name: /Hiring/ }).getAttribute('href')).toBe('/pages/p2');
  });

  it('shows the empty state when the API returns no results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ results: [], warnings: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    renderView('nothingmatches');
    await waitFor(() =>
      expect(
        screen.getByText('No results. Try a different query or remove a filter.'),
      ).toBeTruthy(),
    );
  });
});
