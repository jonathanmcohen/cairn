// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { UnsplashTab } from '@/components/pages/cover-picker-unsplash-tab';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) })) as never,
  );
});

describe('<UnsplashTab> empty state', () => {
  it('shows the empty hint after a search returns no photos', async () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <UnsplashTab accessKey="k" onPick={() => {}} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText('Search Unsplash'), {
      target: { value: 'cats' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(screen.getByText('No photos found. Try a different search.')).toBeTruthy(),
    );
  });
});
