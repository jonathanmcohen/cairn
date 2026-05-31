// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchPageView } from '@/components/search/search-page-view';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json' with { type: 'json' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const fetchMock = vi.fn(
  async (_input: RequestInfo | URL) =>
    new Response(
      JSON.stringify({
        results: [{ id: 'p1', title: 'Roadmap', snippet: null, rank: 1, breadcrumb: [] }],
        warnings: [],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
);

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderResults(canFederate: boolean) {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <SearchPageView initialQuery="" canFederate={canFederate} />
    </I18nProvider>,
  );
}

describe('SearchPageView mode + federated (#164)', () => {
  it('hides the federated toggle for non-admins', () => {
    renderResults(false);
    expect(
      screen.queryByRole('checkbox', { name: enMessages['search.federated.toggle'] }),
    ).toBeNull();
  });

  it('renders results from /api/search', async () => {
    renderResults(false);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'roadmap' } });
    fireEvent.click(screen.getByRole('button', { name: enMessages['search.page.submit'] }));
    expect(await screen.findByText('Roadmap')).toBeTruthy();
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('q=roadmap') && u.includes('mode=fts'))).toBe(true);
  });

  it('admin federated toggle adds include_all_workspaces=true', async () => {
    renderResults(true);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'roadmap' } });
    fireEvent.click(screen.getByRole('checkbox', { name: enMessages['search.federated.toggle'] }));
    fireEvent.click(screen.getByRole('button', { name: enMessages['search.page.submit'] }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('include_all_workspaces=true'))).toBe(true);
    });
  });
});
